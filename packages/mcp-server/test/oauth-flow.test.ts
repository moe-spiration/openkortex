import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { mintUserJwt } from "../src/config";
import { createSupabasePasswordLogin } from "../src/oauth/auth";
import { loadOAuthConfig, type OAuthConfig } from "../src/oauth/config";
import { signJwt } from "../src/oauth/jwt";
import { createLogger } from "../src/oauth/ops";
import { createOAuthProvider } from "../src/oauth/provider";
import { InMemoryBrainRepository } from "../src/memory-repository";
import { startHttpServer, type RunningHttpServer } from "../src/http";
import { callTool } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Test-only: the responses are our own JSON, asserted field by field.
declare global {
  interface Response {
    json(): Promise<any>;
  }
}

// End to end: a mocked Supabase Auth (GoTrue password grant), the real HTTP server, and the MCP
// SDK client running its own discovery / dynamic registration / PKCE flow, like claude.ai does.

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_APP_USER = "99999999-9999-4999-8999-999999999999";
const SECOND_USER = "22222222-2222-4222-8222-222222222222";
const PASSWORDS: Record<string, { id: string; password: string }> = {
  "max@example.com": { id: OWNER, password: "correct-horse" },
  "stranger@other-app.example": { id: OTHER_APP_USER, password: "hunter2hunter2" },
  "second@example.com": { id: SECOND_USER, password: "second-password" },
};
const JWT_SECRET = "supabase-jwt-secret-for-tests-0123456789";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const LOOPBACK = "http://127.0.0.1:8123/callback";

let fakeAuth: Server;
let fakeAuthUrl: string;
let authCalls = 0;
let authDown = false;

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

beforeAll(async () => {
  fakeAuth = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      authCalls++;
      if (authDown) {
        res.writeHead(503);
        return res.end();
      }
      const body = raw ? JSON.parse(raw) : {};
      const hit = PASSWORDS[body.email];
      if (req.url?.startsWith("/auth/v1/token?grant_type=password") && req.headers.apikey === "anon-key" && hit?.password === body.password) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ access_token: "supabase-access-token", user: { id: hit!.id } }));
      }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }));
    });
  });
  await new Promise<void>((r) => fakeAuth.listen(0, "127.0.0.1", r));
  fakeAuthUrl = `http://127.0.0.1:${(fakeAuth.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => fakeAuth.close(r)));

interface Setup {
  http: RunningHttpServer;
  cfg: OAuthConfig;
  base: string;
  repos: Map<string, InMemoryBrainRepository>;
  logs: string[];
  clock: { ms: number };
}
let s: Setup;
const servers: RunningHttpServer[] = [];

async function setup(env: Record<string, string> = {}, opts: { bearerToken?: string; rateLimits?: { perUser?: number } } = {}): Promise<Setup> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const cfg = loadOAuthConfig({
    MCP_PUBLIC_URL: base,
    MCP_OAUTH_SECRET: "o".repeat(48),
    KORTEX_USER_ID: OWNER,
    SUPABASE_URL: fakeAuthUrl,
    SUPABASE_ANON_KEY: "anon-key",
    ...env,
  })!;
  const logs: string[] = [];
  const clock = { ms: Date.now() };
  const log = createLogger((l) => logs.push(l));
  const provider = createOAuthProvider(cfg, { login: createSupabasePasswordLogin(cfg), log, nowMs: () => clock.ms });
  const repos = new Map<string, InMemoryBrainRepository>();
  const http = await startHttpServer({
    oauth: { cfg, provider },
    bearerToken: opts.bearerToken,
    staticUserId: OWNER,
    resolveContext: async (auth) => {
      const id = auth.kind === "static" ? OWNER : auth.userId;
      if (!repos.has(id)) repos.set(id, new InMemoryBrainRepository());
      return { repo: repos.get(id)! };
    },
    port,
    log,
    rateLimits: opts.rateLimits,
    ready: async () => !authDown,
  });
  servers.push(http);
  return { http, cfg, base, repos, logs, clock };
}

beforeEach(async () => {
  authCalls = 0;
  authDown = false;
  s = await setup();
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((x) => x.close()));
});

// ---- helpers ---------------------------------------------------------------------------

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function register(redirect = LOOPBACK, name = "Claude") {
  const res = await fetch(`${s.base}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none" }),
  });
  return { res, body: await res.json() };
}

function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}, redirect = LOOPBACK) {
  const u = new URL(`${s.base}/oauth/authorize`);
  const p = { client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "st-123", resource: s.cfg.resource, scope: "kortex offline_access", ...extra };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return u.toString();
}

async function consent(url: string) {
  const res = await fetch(url);
  const html = await res.text();
  return { res, html, request: /name="request" value="([^"]+)"/.exec(html)?.[1] };
}

const submit = (request: string, who: { email: string; password: string }, decision = "approve") =>
  fetch(`${s.base}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request, decision, ...who }),
  });

const MOE_LOGIN = { email: "max@example.com", password: "correct-horse" };

async function getCode(clientId = "", redirect = LOOPBACK) {
  const reg = clientId ? { body: { client_id: clientId } } : await register(redirect);
  const { verifier, challenge } = pkce();
  const c = await consent(authorizeUrl(reg.body.client_id, challenge, {}, redirect));
  const res = await submit(c.request!, MOE_LOGIN);
  const loc = new URL(res.headers.get("location")!);
  return { code: loc.searchParams.get("code")!, clientId: reg.body.client_id as string, verifier, redirect, res, loc };
}

const token = (params: Record<string, string>) =>
  fetch(`${s.base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

async function fullGrant() {
  const g = await getCode();
  const res = await token({ grant_type: "authorization_code", code: g.code, redirect_uri: g.redirect, client_id: g.clientId, code_verifier: g.verifier, resource: s.cfg.resource });
  return { ...g, tokens: await res.json(), status: res.status };
}

const rpc = (bearer: string | undefined, extra: Record<string, string> = {}) =>
  fetch(s.http.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

// ---- discovery -------------------------------------------------------------------------

describe("discovery", () => {
  it("answers an unauthenticated /mcp call with 401 and a resource_metadata pointer (what Claude needs to start)", async () => {
    const res = await rpc(undefined);
    expect(res.status).toBe(401);
    const h = res.headers.get("www-authenticate")!;
    expect(h).toContain(`resource_metadata="${s.base}/.well-known/oauth-protected-resource"`);
    expect(h).toContain('scope="kortex"');
    expect(h).not.toContain("invalid_token");
  });

  it("flags a presented but invalid token as invalid_token", async () => {
    const res = await rpc("garbage");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("serves protected resource metadata whose resource equals the MCP URL and lists one issuer", async () => {
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await fetch(`${s.base}${p}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toEqual({
        resource: `${s.base}/mcp`,
        authorization_servers: [s.base],
        scopes_supported: ["kortex", "offline_access"],
        bearer_methods_supported: ["header"],
        resource_name: "Kortex Second Brain",
      });
    }
    expect(s.http.url).toBe(`${s.base}/mcp`);
  });

  it("serves authorization server metadata with S256 PKCE, public clients and registration", async () => {
    const m = await (await fetch(`${s.base}/.well-known/oauth-authorization-server`)).json();
    expect(m).toMatchObject({
      issuer: s.base,
      authorization_endpoint: `${s.base}/oauth/authorize`,
      token_endpoint: `${s.base}/oauth/token`,
      registration_endpoint: `${s.base}/oauth/register`,
      revocation_endpoint: `${s.base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(m.client_id_metadata_document_supported).toBeUndefined(); // Claude then uses DCR
  });

  it("has liveness and readiness endpoints that need no auth", async () => {
    expect((await fetch(`${s.base}/healthz`)).status).toBe(200);
    expect(await (await fetch(`${s.base}/readyz`)).json()).toEqual({ ok: true, mode: "oauth" });
    authDown = true;
    expect((await fetch(`${s.base}/readyz`)).status).toBe(503);
  });
});

// ---- dynamic client registration -------------------------------------------------------

describe("dynamic client registration", () => {
  it("registers Claude's callback and loopback clients as public clients", async () => {
    for (const uri of [CLAUDE_CALLBACK, LOOPBACK]) {
      const { res, body } = await register(uri);
      expect(res.status).toBe(201);
      expect(body).toMatchObject({ redirect_uris: [uri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
      expect(body.client_id.split(".")).toHaveLength(3);
      expect(body.client_secret).toBeUndefined();
    }
  });

  it("refuses foreign redirect URIs, confidential clients and malformed bodies", async () => {
    for (const uri of ["https://evil.example/cb", "http://claude.ai/api/mcp/auth_callback", "javascript:alert(1)"]) {
      const { res, body } = await register(uri);
      expect(res.status, uri).toBe(400);
      expect(body.error).toBe("invalid_redirect_uri");
    }
    const conf = await fetch(`${s.base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [LOOPBACK], token_endpoint_auth_method: "client_secret_basic" }) });
    expect((await conf.json()).error).toBe("invalid_client_metadata");
    const none = await fetch(`${s.base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect((await none.json()).error).toBe("invalid_redirect_uri");
    expect((await fetch(`${s.base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" })).status).toBe(400);
  });

  it("rate limits registration per IP", async () => {
    let last = 201;
    for (let i = 0; i < 21; i++) last = (await register()).res.status;
    expect(last).toBe(429);
  });
});

// ---- authorization endpoint -------------------------------------------------------------

describe("authorization endpoint", () => {
  it("shows the sign-in page with the client name and where the user returns to", async () => {
    const { body } = await register(CLAUDE_CALLBACK, "Claude");
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge, {}, CLAUDE_CALLBACK));
    expect(c.res.status).toBe(200);
    expect(c.html).toContain("Claude");
    expect(c.html).toContain("claude.ai");
    expect(c.html).toContain('name="password"');
    expect(c.request).toBeTruthy();
    const csp = c.res.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://claude.ai");
    expect(csp).not.toContain("script-src");
    expect(c.res.headers.get("cache-control")).toBe("no-store");
    expect(c.html).not.toContain("<script");
  });

  it("never reflects markup from the client name", async () => {
    const { body } = await register(LOOPBACK, `<img src=x onerror=alert(1)>"'`);
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge));
    expect(c.html).not.toContain("<img");
    expect(c.html).not.toContain('onerror=alert(1)>');
  });

  it("does not redirect to an unregistered redirect_uri or an unknown client (error page instead)", async () => {
    const { body } = await register(LOOPBACK);
    const wrongUri = await fetch(authorizeUrl(body.client_id, pkce().challenge, {}, "https://evil.example/cb"), { redirect: "manual" });
    expect(wrongUri.status).toBe(400);
    expect(wrongUri.headers.get("location")).toBeNull();
    const unknown = await fetch(authorizeUrl("not-a-client", pkce().challenge), { redirect: "manual" });
    expect(unknown.status).toBe(400);
    const forged = await fetch(authorizeUrl(signJwt("x".repeat(48), { exp: Math.floor(Date.now() / 1000) + 99, redirect_uris: [LOOPBACK], iss: s.base }, { typ: "client" }), pkce().challenge), { redirect: "manual" });
    expect(forged.status).toBe(400);
  });

  it("reports protocol errors to the registered redirect_uri", async () => {
    const { body } = await register(LOOPBACK);
    const errorOf = async (extra: Record<string, string>, challenge = pkce().challenge) => {
      const res = await fetch(authorizeUrl(body.client_id, challenge, extra), { redirect: "manual" });
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin + loc.pathname).toBe(LOOPBACK);
      expect(loc.searchParams.get("state")).toBe("st-123");
      expect(loc.searchParams.get("iss")).toBe(s.base);
      return loc.searchParams.get("error");
    };
    expect(await errorOf({ response_type: "token" })).toBe("unsupported_response_type");
    expect(await errorOf({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({}, "short")).toBe("invalid_request");
    expect(await errorOf({ resource: "https://other.example/mcp" })).toBe("invalid_target");
  });

  it("accepts a loopback redirect on another port (native clients)", async () => {
    const { body } = await register("http://127.0.0.1:1000/callback");
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge, {}, "http://127.0.0.1:54321/callback"));
    expect(c.res.status).toBe(200);
  });

  it("issues a code after a correct sign-in and echoes state and iss", async () => {
    const g = await getCode();
    expect(g.res.status).toBe(302);
    expect(g.loc.origin + g.loc.pathname).toBe(LOOPBACK);
    expect(g.loc.searchParams.get("state")).toBe("st-123");
    expect(g.loc.searchParams.get("iss")).toBe(s.base);
    expect(g.code.split(".")).toHaveLength(3);
  });

  it("re-shows the page with 401 on a wrong password and never issues a code", async () => {
    const { body } = await register();
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge));
    const res = await submit(c.request!, { email: "max@example.com", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("E-Mail oder Passwort stimmen nicht");
  });

  it("refuses valid accounts of other apps on the shared Supabase (allowlist)", async () => {
    const { body } = await register();
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge));
    const res = await submit(c.request!, { email: "stranger@other-app.example", password: "hunter2hunter2" });
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("nicht freigegeben");
  });

  it("sends access_denied back when the user declines, without contacting Supabase", async () => {
    const { body } = await register();
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge));
    const res = await submit(c.request!, MOE_LOGIN, "deny");
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    expect(authCalls).toBe(0);
  });

  it("handles Supabase Auth being down with a 503 page", async () => {
    const { body } = await register();
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge));
    authDown = true;
    const res = await submit(c.request!, MOE_LOGIN);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("nicht möglich");
  });

  it("rejects a tampered, expired or missing request blob", async () => {
    const { body } = await register();
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge));
    const tampered = c.request!.slice(0, -3) + "AAA";
    expect((await submit(tampered, MOE_LOGIN)).status).toBe(400);
    expect((await submit("", MOE_LOGIN)).status).toBe(400);
    s.clock.ms += 11 * 60_000;
    expect((await submit(c.request!, MOE_LOGIN)).status).toBe(400);
    expect(authCalls).toBe(0);
  });

  it("throttles repeated wrong passwords for the same account", async () => {
    const { body } = await register();
    const c = await consent(authorizeUrl(body.client_id, pkce().challenge));
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await submit(c.request!, { email: "max@example.com", password: `wrong-${i}` })).status);
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(401));
    expect(statuses.slice(8)).toEqual([429, 429]);
    // even the right password is refused while throttled, so guessing cannot continue
    expect((await submit(c.request!, MOE_LOGIN)).status).toBe(429);
  });
});

// ---- token endpoint ---------------------------------------------------------------------

describe("token endpoint", () => {
  it("exchanges a code for audience-bound tokens", async () => {
    const g = await fullGrant();
    expect(g.status).toBe(200);
    expect(g.tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "kortex offline_access" });
    const claims = JSON.parse(Buffer.from(g.tokens.access_token.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ iss: s.base, aud: `${s.base}/mcp`, sub: OWNER, client_id: g.clientId, scope: "kortex offline_access" });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(g.tokens.refresh_token).toBeTruthy();
    const res = await token({ grant_type: "authorization_code", code: g.code, redirect_uri: g.redirect, client_id: g.clientId, code_verifier: g.verifier });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects wrong PKCE verifiers, replayed codes, mismatching redirect/client/resource", async () => {
    const g = await getCode();
    const base = { grant_type: "authorization_code", code: g.code, redirect_uri: g.redirect, client_id: g.clientId, code_verifier: g.verifier };
    const err = async (over: Record<string, string>) => {
      const res = await token({ ...base, ...over });
      return { status: res.status, ...(await res.json()) };
    };
    expect(await err({ code_verifier: pkce().verifier })).toMatchObject({ status: 400, error: "invalid_grant" });
    expect(await err({ code_verifier: "short" })).toMatchObject({ error: "invalid_grant" });
    expect(await err({ redirect_uri: "http://127.0.0.1:9/other" })).toMatchObject({ error: "invalid_grant" });
    expect(await err({ resource: "https://other.example/mcp" })).toMatchObject({ error: "invalid_target" });
    const other = (await register()).body.client_id;
    expect(await err({ client_id: other })).toMatchObject({ error: "invalid_grant" });
    expect(await err({ code: "a.b.c" })).toMatchObject({ error: "invalid_grant" });
    // the failed attempts above did not burn the code: the genuine exchange still works exactly once
    expect((await token(base)).status).toBe(200);
    expect(await err({})).toMatchObject({ error: "invalid_grant", error_description: "Code wurde bereits verwendet" });
  });

  it("answers an unknown client with 401 invalid_client (Claude re-registers on this)", async () => {
    const res = await token({ grant_type: "authorization_code", client_id: "nope", code: "x" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_client");
  });

  it("refuses unsupported grants, including client_credentials", async () => {
    const { body } = await register();
    for (const grant_type of ["client_credentials", "password", ""]) {
      const res = await token({ grant_type, client_id: body.client_id });
      expect((await res.json()).error, grant_type).toBe("unsupported_grant_type");
    }
  });

  it("refuses an expired code", async () => {
    const g = await getCode();
    s.clock.ms += 3 * 60_000;
    const res = await token({ grant_type: "authorization_code", code: g.code, redirect_uri: g.redirect, client_id: g.clientId, code_verifier: g.verifier });
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("accepts form bodies and JSON bodies, and answers CORS preflight for browser clients", async () => {
    const pre = await fetch(`${s.base}/oauth/token`, { method: "OPTIONS", headers: { Origin: "http://localhost:6274", "Access-Control-Request-Method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    const res = await fetch(`${s.base}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "refresh_token", client_id: "nope" }) });
    expect(res.status).toBe(401);
  });

  it("rate limits the token endpoint per IP", async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await token({ grant_type: "x", client_id: "nope" })).status;
    expect(last).toBe(429);
  });
});

describe("refresh tokens", () => {
  const refresh = (g: { clientId: string; tokens: { refresh_token: string } }, rt = g.tokens.refresh_token) =>
    token({ grant_type: "refresh_token", refresh_token: rt, client_id: g.clientId, resource: s.cfg.resource });

  it("rotates: each refresh token works once and yields a new pair", async () => {
    const g = await fullGrant();
    const r1 = await refresh(g);
    expect(r1.status).toBe(200);
    const t1 = await r1.json();
    expect(t1.refresh_token).not.toBe(g.tokens.refresh_token);
    expect((await rpc(t1.access_token)).status).toBe(200);
    const r2 = await refresh({ clientId: g.clientId, tokens: t1 });
    expect(r2.status).toBe(200);
  });

  it("treats a replayed refresh token as theft and revokes the whole grant", async () => {
    const g = await fullGrant();
    const t1 = await (await refresh(g)).json();
    expect((await rpc(t1.access_token)).status).toBe(200);
    const replay = await refresh(g); // the old token again
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    // the legitimate descendants are dead too
    expect((await rpc(t1.access_token)).status).toBe(401);
    expect((await refresh({ clientId: g.clientId, tokens: t1 })).status).toBe(400);
    expect(s.logs.join("\n")).toContain("refresh token reuse");
  });

  it("refuses refresh tokens of another client, access tokens and expired tokens", async () => {
    const g = await fullGrant();
    const other = (await register()).body.client_id;
    expect((await token({ grant_type: "refresh_token", refresh_token: g.tokens.refresh_token, client_id: other })).status).toBe(400);
    expect((await refresh(g, g.tokens.access_token)).status).toBe(400);
    s.clock.ms += 31 * 86400_000;
    expect((await refresh(g)).status).toBe(400);
  });

  it("revokes a grant on request (always 200)", async () => {
    const g = await fullGrant();
    expect((await rpc(g.tokens.access_token)).status).toBe(200);
    const res = await fetch(`${s.base}/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: g.tokens.refresh_token }) });
    expect(res.status).toBe(200);
    expect((await rpc(g.tokens.access_token)).status).toBe(401);
    expect((await refresh(g)).status).toBe(400);
    const junk = await fetch(`${s.base}/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: "junk" }) });
    expect(junk.status).toBe(200);
  });
});

// ---- resource server --------------------------------------------------------------------

describe("protected /mcp", () => {
  it("accepts an issued token, expires it, and rejects tokens for other audiences or issuers", async () => {
    const g = await fullGrant();
    expect((await rpc(g.tokens.access_token)).status).toBe(200);

    const secret = "o".repeat(48);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const mint = (claims: Record<string, unknown>, typ = "at+jwt") =>
      signJwt(secret, { iss: s.base, aud: s.cfg.resource, sub: OWNER, scope: "kortex", fam: "f", jti: "j", exp, ...claims }, { typ });
    expect((await rpc(mint({}))).status).toBe(200);
    expect((await rpc(mint({ aud: "https://other.example/mcp" }))).status).toBe(401);
    expect((await rpc(mint({ iss: "https://other.example" }))).status).toBe(401);
    expect((await rpc(mint({ sub: OTHER_APP_USER }))).status).toBe(401);
    expect((await rpc(mint({}, "rt"))).status).toBe(401); // a refresh token is not an access token
    expect((await rpc(mint({ exp: exp - 3600 }))).status).toBe(401);
    expect((await rpc(signJwt("x".repeat(48), { iss: s.base, aud: s.cfg.resource, sub: OWNER, exp }, { typ: "at+jwt" }))).status).toBe(401);

    s.clock.ms += 2 * 3600_000;
    expect((await rpc(g.tokens.access_token)).status).toBe(401);
  });

  it("serves the SDK client through the full OAuth flow, then runs tools as that user only", async () => {
    let authUrl: URL | undefined;
    const store: { info?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string } = {};
    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return LOOPBACK;
      },
      get clientMetadata(): OAuthClientMetadata {
        return { client_name: "SDK test client", redirect_uris: [LOOPBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
      },
      clientInformation: () => store.info,
      saveClientInformation: (i) => void (store.info = i),
      tokens: () => store.tokens,
      saveTokens: (t) => void (store.tokens = t),
      redirectToAuthorization: (u) => void (authUrl = u),
      saveCodeVerifier: (v) => void (store.verifier = v),
      codeVerifier: () => store.verifier!,
    };

    const connect = async () => {
      const transport = new StreamableHTTPClientTransport(new URL(s.http.url), { authProvider: provider });
      const client = new Client({ name: "sdk", version: "1" });
      await client.connect(transport);
      return { client, transport };
    };

    // 1) first attempt: 401 -> discovery -> DCR -> PKCE authorization request
    const first = new StreamableHTTPClientTransport(new URL(s.http.url), { authProvider: provider });
    await expect(new Client({ name: "sdk", version: "1" }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(authUrl).toBeDefined();
    expect(authUrl!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl!.searchParams.get("resource")).toBe(s.cfg.resource);
    expect(store.info?.client_id).toBeTruthy();

    // 2) the "browser": sign in, approve
    const c = await consent(authUrl!.toString());
    const res = await submit(c.request!, MOE_LOGIN);
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;

    // 3) back in the client: code -> tokens, then a real MCP session
    await first.finishAuth(code);
    expect(store.tokens?.access_token).toBeTruthy();
    const { client } = await connect();
    expect((await client.listTools()).tools).toHaveLength(6);
    const saved = await callTool(client, "brain_save_item", { title: "Remote note", content_md: "via OAuth" });
    expect(saved.isError).toBe(false);
    expect(s.repos.get(OWNER)?.items.size).toBe(1);
    await client.close();
  });

  it("gives every user their own repository (no cross-talk)", async () => {
    await s.http.close();
    servers.pop();
    s = await setup({ MCP_OAUTH_ALLOWED_USER_IDS: `${OWNER},${SECOND_USER}` });
    const grant = async (who: { email: string; password: string }) => {
      const reg = await register();
      const { verifier, challenge } = pkce();
      const c = await consent(authorizeUrl(reg.body.client_id, challenge));
      const code = new URL((await submit(c.request!, who)).headers.get("location")!).searchParams.get("code")!;
      return (await (await token({ grant_type: "authorization_code", code, redirect_uri: LOOPBACK, client_id: reg.body.client_id, code_verifier: verifier })).json()).access_token as string;
    };
    const call = async (bearer: string, name: string, args: Record<string, unknown>) => {
      const transport = new StreamableHTTPClientTransport(new URL(s.http.url), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
      const client = new Client({ name: "t", version: "1" });
      await client.connect(transport);
      const r = await callTool(client, name, args);
      await client.close();
      return r;
    };
    const a = await grant(MOE_LOGIN);
    const b = await grant({ email: "second@example.com", password: "second-password" });
    await call(a, "brain_save_item", { title: "Only for Max", content_md: "secret" });
    const bSearch = await call(b, "brain_search", { query: "secret" });
    expect(bSearch.json.count).toBe(0);
    expect((await call(a, "brain_search", { query: "secret" })).json.count).toBe(1);
    expect([...s.repos.keys()].sort()).toEqual([OWNER, SECOND_USER]);
  });

  it("enforces browser origins: preflight for allowed origins, 403 for others", async () => {
    const ok = await fetch(s.http.url, { method: "OPTIONS", headers: { Origin: "https://claude.ai", "Access-Control-Request-Method": "POST" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(ok.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    const bad = await fetch(s.http.url, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const withToken = await rpc((await fullGrant()).tokens.access_token, { Origin: "https://evil.example" });
    expect(withToken.status).toBe(403);
    expect((await rpc(undefined, { Origin: "https://claude.ai" })).headers.get("access-control-allow-origin")).toBe("https://claude.ai");
  });

  it("rate limits per user and per IP", async () => {
    await s.http.close();
    servers.pop();
    s = await setup({}, { rateLimits: { perUser: 3 } });
    const g = await fullGrant();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await rpc(g.tokens.access_token)).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect((await rpc(g.tokens.access_token)).headers.get("retry-after")).toBeTruthy();
  });

  it("still serves GET/DELETE as 405 after authentication and 404 for unknown paths", async () => {
    const g = await fullGrant();
    const auth = { Authorization: `Bearer ${g.tokens.access_token}` };
    expect((await fetch(s.http.url, { headers: auth })).status).toBe(405);
    expect((await fetch(s.http.url, { method: "DELETE", headers: auth })).status).toBe(405);
    expect((await fetch(`${s.base}/nope`)).status).toBe(404);
    expect((await fetch(`${s.base}/oauth/token`)).status).toBe(405);
  });
});

// ---- other credentials and logging ------------------------------------------------------

describe("static and Supabase bearer tokens", () => {
  it("static MCP_BEARER_TOKEN is off unless configured, and acts as the configured user when on", async () => {
    expect((await rpc("static-token-0123456789abcdef")).status).toBe(401);
    await s.http.close();
    servers.pop();
    s = await setup({}, { bearerToken: "static-token-0123456789abcdef" });
    expect((await rpc("static-token-0123456789abcdef")).status).toBe(200);
    expect((await rpc("static-token-0123456789abcdeX")).status).toBe(401);
    expect(s.repos.has(OWNER)).toBe(true);
  });

  it("accepts Supabase user JWTs only with MCP_ACCEPT_SUPABASE_TOKENS=1, and only for allowed users", async () => {
    const mine = mintUserJwt(JWT_SECRET, OWNER).token;
    const theirs = mintUserJwt(JWT_SECRET, OTHER_APP_USER).token;
    expect((await rpc(mine)).status).toBe(401); // off by default
    await s.http.close();
    servers.pop();
    s = await setup({ MCP_ACCEPT_SUPABASE_TOKENS: "1", SUPABASE_JWT_SECRET: JWT_SECRET });
    expect((await rpc(mine)).status).toBe(200);
    expect((await rpc(theirs)).status).toBe(401);
    expect((await rpc(mintUserJwt("wrong-secret-wrong-secret-wrong-secret", OWNER).token)).status).toBe(401);
  });
});

describe("logging", () => {
  it("logs structured request lines and never passwords, codes or tokens", async () => {
    const g = await fullGrant();
    await rpc(g.tokens.access_token);
    await submit((await consent(authorizeUrl(g.clientId, pkce().challenge))).request!, { email: "max@example.com", password: "wrong-password-xyz" });
    const text = s.logs.join("\n");
    const lines = s.logs.map((l) => JSON.parse(l));
    expect(lines.every((l) => typeof l.ts === "string" && typeof l.level === "string")).toBe(true);
    expect(lines.some((l) => l.msg === "request" && l.path === "/mcp" && l.status === 200 && l.user === OWNER.slice(0, 8))).toBe(true);
    for (const secret of [g.tokens.access_token, g.tokens.refresh_token, g.code, g.verifier, "correct-horse", "wrong-password-xyz", "o".repeat(48)]) {
      expect(text, secret.slice(0, 12)).not.toContain(secret);
    }
    expect(text).not.toContain("Bearer ");
    expect(lines.every((l) => !("healthz" === l.path))).toBe(true);
  });
});
