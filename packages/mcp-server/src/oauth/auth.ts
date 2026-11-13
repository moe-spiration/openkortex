import { timingSafeEqual, createHash } from "node:crypto";
import type { OAuthConfig } from "./config";
import { audienceIncludes, verifyJwt } from "./jwt";
import type { AuthInfo, OAuthProvider, PasswordLogin } from "./provider";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Email/password sign-in against Supabase Auth (GoTrue `grant_type=password`, anon key). Returns the
 * user id; the Supabase session itself is discarded, this server issues its own tokens.
 */
export function createSupabasePasswordLogin(
  cfg: Pick<OAuthConfig, "supabaseUrl" | "supabaseAnonKey">,
  fetchImpl: typeof fetch = fetch,
): PasswordLogin {
  return async (email, password) => {
    const res = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 400 || res.status === 401 || res.status === 422) return null;
    if (!res.ok) throw new Error(`Supabase Auth answered HTTP ${res.status}`);
    const body = (await res.json()) as { user?: { id?: string } };
    const id = body.user?.id;
    if (!id || !UUID.test(id)) throw new Error("Supabase Auth returned no user id");
    return { userId: id };
  };
}

const sha = (s: string) => createHash("sha256").update(s).digest();

export interface BearerAuthOptions {
  oauth?: { cfg: OAuthConfig; provider: OAuthProvider };
  /** Fixed token for local use; acts as `staticUserId` (no scopes, no expiry). */
  staticToken?: string;
  staticUserId?: string;
}

/**
 * Turns an `Authorization` header into who is calling, trying in order: a token issued by this
 * server's authorization server, a Supabase user JWT (only when MCP_ACCEPT_SUPABASE_TOKENS=1), and the
 * static MCP_BEARER_TOKEN. Null for anything else.
 */
export function createBearerAuthenticator(opts: BearerAuthOptions) {
  return (header: string | undefined): AuthInfo | null => {
    const raw = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "")?.[1];
    if (!raw) return null;

    if (opts.oauth) {
      const own = opts.oauth.provider.verifyAccessToken(raw);
      if (own) return own;
      const { cfg } = opts.oauth;
      if (cfg.supabaseJwtSecret) {
        const v = verifyJwt(cfg.supabaseJwtSecret, raw);
        const c = v.ok ? v.claims : null;
        if (
          c &&
          c.role === "authenticated" &&
          audienceIncludes(c.aud, "authenticated") &&
          typeof c.sub === "string" &&
          UUID.test(c.sub) &&
          cfg.allowedUserIds.includes(c.sub)
        ) {
          return { kind: "supabase", userId: c.sub, scopes: [] };
        }
      }
    }

    // Constant time, and always evaluated so a wrong token costs the same as a missing one.
    if (opts.staticToken && opts.staticUserId) {
      const match = timingSafeEqual(sha(raw), sha(opts.staticToken));
      if (match) return { kind: "static", userId: opts.staticUserId, scopes: [] };
    }
    return null;
  };
}
