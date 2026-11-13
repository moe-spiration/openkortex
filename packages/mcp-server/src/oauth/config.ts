type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SCOPES = ["kortex", "offline_access"] as const;
export const DEFAULT_SCOPE = "kortex offline_access";

/** The hosted Claude apps (web, desktop, mobile) use these callbacks; claude.com is announced as the future one. */
export const CLAUDE_CALLBACKS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
] as const;

export interface OAuthConfig {
  /** Public origin the server is reached at, no trailing slash. */
  publicUrl: string;
  /** Canonical resource identifier = the MCP endpoint URL users enter in Claude. Tokens are bound to it. */
  resource: string;
  /** Issuer of the embedded authorization server (= publicUrl). */
  issuer: string;
  /** Signs codes, tokens and client ids. Rotating it revokes every grant. */
  secret: string;
  /** Only these Supabase users may sign in (the instance is shared with other apps). */
  allowedUserIds: string[];
  /** Redirect URIs accepted in addition to the Claude callbacks and loopback addresses. */
  extraRedirectUris: string[];
  /** Origins that may call /mcp from a browser (MCP Inspector, claude.ai). */
  corsOrigins: string[];
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  codeTtlSeconds: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Also accept Supabase user access tokens (HS256) as bearer tokens. */
  supabaseJwtSecret?: string;
  /** Read the client IP from X-Forwarded-For (only behind a trusted proxy such as Traefik/Coolify). */
  trustProxy: boolean;
}

const flag = (v: string | undefined) => ["1", "true", "on", "yes"].includes((v ?? "").trim().toLowerCase());
const list = (v: string | undefined) =>
  (v ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const int = (v: string | undefined, fallback: number, min: number, name: string) => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
};

/** http is only acceptable for local testing; OAuth 2.1 requires https redirect/endpoints otherwise. */
export const isLoopbackHost = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");

/**
 * Remote mode is on when MCP_PUBLIC_URL is set. Throws with a precise message for anything that
 * would make the deployment insecure instead of starting half-configured.
 */
export function loadOAuthConfig(env: Env = process.env): OAuthConfig | null {
  const raw = env.MCP_PUBLIC_URL?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MCP_PUBLIC_URL must be an absolute URL, e.g. https://mcp.example.com");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("MCP_PUBLIC_URL must use https (http only for localhost)");
  }
  if (url.search || url.hash) throw new Error("MCP_PUBLIC_URL must not contain a query or fragment");
  // OAuth discovery lives under /.well-known at the origin root, so the server needs its own (sub)domain.
  if (url.pathname.replace(/\/+$/, "") !== "") {
    throw new Error("MCP_PUBLIC_URL must be an origin without a path (use a dedicated domain)");
  }
  const publicUrl = url.origin;

  const secret = env.MCP_OAUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error(
      "MCP_OAUTH_SECRET must be at least 32 characters (generate: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\")",
    );
  }

  const allowedUserIds = list(env.MCP_OAUTH_ALLOWED_USER_IDS ?? env.KORTEX_USER_ID);
  if (allowedUserIds.length === 0) {
    throw new Error("MCP_OAUTH_ALLOWED_USER_IDS (or KORTEX_USER_ID) must list who may sign in");
  }
  for (const id of allowedUserIds) {
    if (!UUID.test(id)) throw new Error(`MCP_OAUTH_ALLOWED_USER_IDS: "${id}" is not a UUID`);
  }

  const supabaseUrl = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for sign-in (remote mode)");
  }

  const extraRedirectUris = list(env.MCP_OAUTH_REDIRECT_URIS);
  for (const u of extraRedirectUris) {
    if (!isAllowedRedirectShape(u)) throw new Error(`MCP_OAUTH_REDIRECT_URIS: "${u}" must be https (or loopback)`);
  }

  return {
    publicUrl,
    resource: `${publicUrl}/mcp`,
    issuer: publicUrl,
    secret,
    allowedUserIds,
    extraRedirectUris,
    corsOrigins: env.MCP_CORS_ORIGINS
      ? list(env.MCP_CORS_ORIGINS)
      : ["https://claude.ai", "https://claude.com", "http://localhost:6274", "http://127.0.0.1:6274"],
    accessTtlSeconds: int(env.MCP_OAUTH_ACCESS_TTL_SECONDS, 3600, 60, "MCP_OAUTH_ACCESS_TTL_SECONDS"),
    refreshTtlSeconds: int(env.MCP_OAUTH_REFRESH_TTL_SECONDS, 30 * 86400, 3600, "MCP_OAUTH_REFRESH_TTL_SECONDS"),
    codeTtlSeconds: 120,
    supabaseUrl,
    supabaseAnonKey,
    supabaseJwtSecret: flag(env.MCP_ACCEPT_SUPABASE_TOKENS) ? env.SUPABASE_JWT_SECRET : undefined,
    trustProxy: flag(env.MCP_TRUST_PROXY),
  };
}

function isAllowedRedirectShape(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

const sameLoopbackIgnoringPort = (a: URL, b: URL) =>
  a.protocol === "http:" && b.protocol === "http:" && isLoopbackHost(a.hostname) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;

/**
 * Redirect URIs a client may register: the Claude callbacks (exact), any configured extra (exact),
 * and loopback http URIs of native clients such as Claude Code or the MCP Inspector (RFC 8252:
 * any port). Everything else is refused, so an attacker cannot register their own callback.
 */
export function isAllowedRedirectUri(cfg: Pick<OAuthConfig, "extraRedirectUris">, uri: string): boolean {
  if (!isAllowedRedirectShape(uri)) return false;
  if ((CLAUDE_CALLBACKS as readonly string[]).includes(uri)) return true;
  if (cfg.extraRedirectUris.includes(uri)) return true;
  const u = new URL(uri);
  return u.protocol === "http:" && isLoopbackHost(u.hostname);
}

/** `registered` already passed `isAllowedRedirectUri`; loopback URIs compare without the port. */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  try {
    const want = new URL(requested);
    return registered.some((r) => sameLoopbackIgnoringPort(new URL(r), want));
  } catch {
    return false;
  }
}
