import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuthConfig } from "./oauth/config";
import { createBearerAuthenticator } from "./oauth/auth";
import { createRateLimiter, silentLogger, type Logger } from "./oauth/ops";
import type { AuthInfo, OAuthProvider, Reply } from "./oauth/provider";
import { localeOfAcceptLanguage, runWithLocale } from "./i18n";
import { createMcpServer } from "./server";
import type { ToolContext } from "./tools";

export const MIN_TOKEN_LENGTH = 16;
const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;
const MAX_OAUTH_BODY_BYTES = 64 * 1024;

/** Constant-time string comparison: both sides are hashed first so length does not leak. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function isAuthorized(header: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  // Always run the comparison so a missing header costs the same as a wrong one.
  const ok = safeEqual(match?.[1]?.trim() ?? "", token);
  return match !== null && ok;
}

export interface OAuthRuntime {
  cfg: OAuthConfig;
  provider: OAuthProvider;
}

export interface HttpOptions extends Partial<ToolContext> {
  /** Static bearer token (local use). Optional when `oauth` is given. */
  bearerToken?: string;
  /** User the static token acts as (informational: the context is chosen by `resolveContext`). */
  staticUserId?: string;
  /** Remote mode: OAuth 2.1 protected resource + embedded authorization server. */
  oauth?: OAuthRuntime;
  /** Tool context for an authenticated caller; defaults to the `repo`/`embedder` given here. */
  resolveContext?: (auth: AuthInfo) => Promise<ToolContext>;
  /** 0 picks a free port (tests). */
  port?: number;
  /** Default 127.0.0.1: the server is not reachable from the network unless you opt in. */
  host?: string;
  path?: string;
  log?: Logger;
  /** Readiness probe for /readyz (e.g. Supabase reachable). */
  ready?: () => Promise<boolean>;
  /** Origins allowed to call /mcp from a browser; defaults to the OAuth config's list, else none. */
  corsOrigins?: string[];
  /** Calls per minute and user (default 240) and per IP before authentication (default 600). */
  rateLimits?: { perUser?: number; perIp?: number };
}

export interface RunningHttpServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

const HEADERS_JSON = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const rpcError = (code: number, message: string) => ({
  jsonrpc: "2.0",
  error: { code, message },
  id: null,
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
};

/** OAuth endpoints take form-encoded bodies (RFC 6749); JSON is accepted as a courtesy. */
function parseParams(raw: string, contentType: string | undefined): URLSearchParams {
  if (contentType?.includes("application/json")) {
    const body = parseJson(raw);
    const p = new URLSearchParams();
    if (typeof body === "object" && body !== null) {
      for (const [k, v] of Object.entries(body)) if (typeof v === "string") p.set(k, v);
    }
    return p;
  }
  return new URLSearchParams(raw);
}

function write(res: ServerResponse, reply: Reply, extra: Record<string, string> = {}) {
  const headers = { ...extra, ...reply.headers };
  if (reply.redirect) {
    res.writeHead(reply.status, { ...headers, Location: reply.redirect });
    return res.end();
  }
  if (reply.html !== undefined) {
    res.writeHead(reply.status, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    return res.end(reply.html);
  }
  res.writeHead(reply.status, { ...HEADERS_JSON, ...headers });
  res.end(reply.json === undefined ? "" : JSON.stringify(reply.json));
}

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => write(res, { status, json: body, headers });

/**
 * Streamable HTTP endpoint at POST /mcp, stateless (a fresh server + transport per request, JSON
 * responses): no session table to leak or expire, and every request is authenticated on its own.
 *
 * Two ways in, at least one required:
 * - `bearerToken`: a fixed token, for local use (Claude Code `--header`, mcp-remote).
 * - `oauth`: OAuth 2.1 for claude.ai custom connectors: protected-resource and authorization-server
 *   metadata, dynamic client registration, authorization with Supabase sign-in, token and revoke.
 */
export async function startHttpServer(opts: HttpOptions): Promise<RunningHttpServer> {
  if (opts.bearerToken !== undefined && opts.bearerToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_BEARER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (!opts.bearerToken && !opts.oauth) {
    throw new Error("HTTP mode needs MCP_BEARER_TOKEN and/or MCP_PUBLIC_URL (OAuth)");
  }
  if (!opts.resolveContext && !opts.repo) {
    throw new Error("startHttpServer needs a repo or resolveContext");
  }

  const oauth = opts.oauth;
  const path = oauth ? "/mcp" : (opts.path ?? "/mcp");
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? silentLogger;
  const corsOrigins = opts.corsOrigins ?? oauth?.cfg.corsOrigins ?? [];
  const trustProxy = oauth?.cfg.trustProxy ?? false;
  const resolveContext =
    opts.resolveContext ??
    (async (): Promise<ToolContext> => ({
      repo: opts.repo!,
      embedder: opts.embedder,
      enricher: opts.enricher,
      now: opts.now,
    }));
  const authenticate = createBearerAuthenticator({
    oauth,
    staticToken: opts.bearerToken,
    staticUserId: opts.staticUserId ?? "static",
  });
  const ipLimit = createRateLimiter({ limit: opts.rateLimits?.perIp ?? 600, windowMs: 60_000 });
  const userLimit = createRateLimiter({ limit: opts.rateLimits?.perUser ?? 240, windowMs: 60_000 });
  const metadataUrl = oauth
    ? `${oauth.cfg.publicUrl}/.well-known/oauth-protected-resource`
    : undefined;

  const clientIp = (req: IncomingMessage): string => {
    if (trustProxy) {
      // The proxy appends the peer it saw to X-Forwarded-For: the last entry is the one we can trust.
      const xff = String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (xff.length) return xff[xff.length - 1]!;
    }
    return req.socket.remoteAddress ?? "unknown";
  };

  function applyCors(req: IncomingMessage, res: ServerResponse, kind: "open" | "mcp"): boolean {
    const origin = req.headers.origin;
    if (kind === "open") {
      // Discovery, registration and token endpoints carry no cookies: any origin may call them.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
      res.setHeader("Access-Control-Max-Age", "600");
      return true;
    }
    if (!origin) return true; // not a browser
    res.setHeader("Vary", "Origin");
    if (!corsOrigins.includes(origin)) return false;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
    );
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
    res.setHeader("Access-Control-Max-Age", "600");
    return true;
  }

  const challenge = (invalid: boolean) => {
    if (!oauth) return 'Bearer realm="kortex-mcp"';
    const parts = [`resource_metadata="${metadataUrl}"`, 'scope="kortex"'];
    if (invalid) {
      parts.unshift('error="invalid_token"', 'error_description="The access token is invalid or expired"');
    }
    return `Bearer ${parts.join(", ")}`;
  };

  async function handleMcp(
    req: IncomingMessage,
    res: ServerResponse,
    meta: Record<string, unknown>,
    ip: string,
  ) {
    // Browsers send Origin; anything not on the list is refused (DNS-rebinding protection).
    if (!applyCors(req, res, "mcp")) return json(res, 403, { error: "Origin not allowed" });
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (!ipLimit.take(ip)) {
      return json(res, 429, rpcError(-32000, "Too many requests"), {
        "Retry-After": String(ipLimit.retryAfter(ip)),
      });
    }
    const header = req.headers.authorization;
    const auth = authenticate(header);
    if (!auth) {
      return json(res, 401, { error: "Unauthorized" }, { "WWW-Authenticate": challenge(!!header) });
    }
    meta.user = auth.userId.slice(0, 8);
    meta.auth = auth.kind;
    if (auth.clientId) meta.client_id = auth.clientId.slice(0, 12);
    if (!userLimit.take(auth.userId)) {
      return json(res, 429, rpcError(-32000, "Too many requests"), {
        "Retry-After": String(userLimit.retryAfter(auth.userId)),
      });
    }
    if (req.method !== "POST") {
      return json(res, 405, rpcError(-32000, "Method not allowed (stateless server: POST only)"), {
        Allow: "POST",
      });
    }

    const body = parseJson(await readBody(req, MAX_MCP_BODY_BYTES));
    const ctx = await resolveContext(auth);
    const mcp = createMcpServer(ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    // Tool results and messages in the language of the authenticated user (several users share
    // this process, so the language is bound to the request, not set process-wide).
    await runWithLocale(ctx.locale, async () => {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    });
  }

  /** Returns true when the request belonged to the OAuth surface and was answered. */
  async function handleOAuth(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    ip: string,
    meta: Record<string, unknown>,
  ): Promise<boolean> {
    if (!oauth) return false;
    const { provider } = oauth;
    const method = req.method ?? "GET";
    const isResourceMeta =
      pathname === "/.well-known/oauth-protected-resource" ||
      pathname.startsWith("/.well-known/oauth-protected-resource/");
    const isServerMeta =
      pathname === "/.well-known/oauth-authorization-server" ||
      pathname.startsWith("/.well-known/oauth-authorization-server/");
    const isEndpoint = ["/oauth/register", "/oauth/token", "/oauth/revoke"].includes(pathname);
    const isAuthorize = pathname === "/oauth/authorize";
    if (!isResourceMeta && !isServerMeta && !isEndpoint && !isAuthorize) return false;

    if (!isAuthorize) {
      applyCors(req, res, "open");
      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return true;
      }
    }

    if ((isResourceMeta || isServerMeta) && method === "GET") {
      write(res, isResourceMeta ? provider.protectedResourceMetadata() : provider.authorizationServerMetadata());
    } else if (pathname === "/oauth/register" && method === "POST") {
      write(res, provider.register(parseJson(await readBody(req, MAX_OAUTH_BODY_BYTES)), ip));
    } else if (isAuthorize && method === "GET") {
      write(res, provider.authorize(new URL(req.url ?? "/", "http://localhost").searchParams));
    } else if (isAuthorize && method === "POST") {
      const form = parseParams(await readBody(req, MAX_OAUTH_BODY_BYTES), req.headers["content-type"]);
      write(res, await provider.authorizeSubmit(form, ip));
    } else if (pathname === "/oauth/token" && method === "POST") {
      const form = parseParams(await readBody(req, MAX_OAUTH_BODY_BYTES), req.headers["content-type"]);
      meta.grant = form.get("grant_type") ?? undefined;
      write(res, provider.token(form, ip));
    } else if (pathname === "/oauth/revoke" && method === "POST") {
      write(res, provider.revoke(parseParams(await readBody(req, MAX_OAUTH_BODY_BYTES), req.headers["content-type"])));
    } else {
      json(res, 405, { error: "method_not_allowed" }, { Allow: "GET, POST, OPTIONS" });
    }
    return true;
  }

  const server = createServer(async (req, res) => {
    const started = Date.now();
    const reqId = randomUUID().slice(0, 8);
    const meta: Record<string, unknown> = {};
    const ip = clientIp(req);
    res.setHeader("X-Request-Id", reqId);
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    res.on("finish", () => {
      if (pathname === "/healthz") return; // probes would drown the log
      log.info("request", {
        reqId,
        method: req.method,
        path: pathname,
        status: res.statusCode,
        ms: Date.now() - started,
        ip,
        ...meta,
      });
    });
    try {
      if (pathname === "/healthz" && req.method === "GET") return json(res, 200, { ok: true });
      if (pathname === "/readyz" && req.method === "GET") {
        const ready = opts.ready ? await opts.ready().catch(() => false) : true;
        return json(res, ready ? 200 : 503, { ok: ready, mode: oauth ? "oauth" : "bearer" });
      }
      // Consent/sign-in pages and OAuth errors: nobody is signed in yet, the browser's language decides.
      const browserLocale = localeOfAcceptLanguage(req.headers["accept-language"]);
      if (await runWithLocale(browserLocale, () => handleOAuth(req, res, pathname, ip, meta))) return;
      if (pathname === path) return await handleMcp(req, res, meta, ip);
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) {
        log.error("unhandled error", { reqId, error: e instanceof Error ? e.message : String(e) });
      }
      if (!res.headersSent) {
        json(
          res,
          status,
          rpcError(status === 500 ? -32603 : -32700, status === 500 ? "Internal server error" : (e as Error).message),
        );
      } else {
        res.end();
      }
    }
  });
  // Slow clients must not hold sockets open indefinitely.
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 3333, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const shownHost = host.includes(":") ? `[${host}]` : host;
  return {
    server,
    url: `http://${shownHost}:${port}${path}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
