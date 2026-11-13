import { LOCALE_COOKIE, t } from "@/i18n";
import { timingSafeEqual } from "node:crypto";
import { bootstrapUser, type KortexClient } from "@kortex/db";
import { enterRequestLocale, localeOfRequest } from "@/i18n/server";
import { forbidden, unauthorized } from "./api-error";
import { resolveToken } from "./auth/api-tokens/store";
import { looksLikePersonalToken, scopeForPath } from "./auth/api-tokens/tokens";
import type { ServerEnv } from "./env";
import type { CookieJar, SupabaseClients } from "./supabase";

/**
 * How the caller proved who they are:
 * - `session`: Supabase auth cookie from the web app (RLS as the user)
 * - `jwt`: Supabase access token as bearer (mobile, desktop, MCP with a user token; RLS as the user)
 * - `api_token`: the owner-wide `KORTEX_API_TOKEN` or a personal `kx_…` token (extension); service
 *   role scoped by user_id
 */
export type AuthMode = "session" | "jwt" | "api_token";

export interface AuthContext {
  userId: string;
  mode: AuthMode;
  client: KortexClient;
  /** Set when a personal token authenticated the request. */
  token?: { id: string; name: string };
}

const bearerOf = (request: Request): string | undefined =>
  request.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];

const looksLikeJwt = (token: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Personal token (`kx_…`, Settings → Persönliche API-Tokens): acts as its owner with the service
 * role, like the owner-wide token, but only where its scope allows (`ingest`: /api/ingest,
 * /api/chat/transcribe and POST /api/meeting/live; `search`: /api/search and POST
 * /api/meeting/coach; `ask`: POST /api/chat) and only until revoked or expired.
 */
async function authenticatePersonalToken(
  request: Request,
  bearer: string,
  clients: SupabaseClients,
): Promise<AuthContext> {
  const scope = scopeForPath(new URL(request.url).pathname, request.method);
  if (!scope)
    throw forbidden(
      t("Personal API tokens only work for /api/ingest, /api/chat/transcribe, /api/reminder, /api/highlight, /api/search, /api/chat and live meetings from the desktop app"),
    );
  const client = clients.service();
  const result = await resolveToken(client, bearer, scope, new Date());
  if (!result.ok) {
    const why = {
      unknown: t("Invalid API token"),
      revoked: t("API token was revoked"),
      expired: t("API token has expired"),
      scope: t("API token may not be used here"),
    }[result.reason];
    throw unauthorized(why);
  }
  const { id, name, userId } = result.token;
  return { userId, mode: "api_token", client, token: { id, name } };
}

export async function authenticate(
  request: Request,
  env: ServerEnv,
  clients: SupabaseClients,
  jar: CookieJar,
): Promise<AuthContext> {
  // Errors and generated text of this request are in the caller's language. A request that states
  // none (no X-Kortex-Locale, language cookie or Accept-Language) keeps the process language, which
  // is English on the server and German in the test suite.
  const h = request.headers;
  if (h.get("x-kortex-locale") || h.get("accept-language") || h.get("cookie")?.includes(`${LOCALE_COOKIE}=`))
    enterRequestLocale(localeOfRequest(h));
  const bearer = bearerOf(request);
  if (bearer) {
    if (env.apiToken && safeEqual(bearer, env.apiToken)) {
      if (!env.apiTokenUserId) throw unauthorized(t("{name} is not set", { name: "KORTEX_API_TOKEN_USER_ID" }));
      return { userId: env.apiTokenUserId, mode: "api_token", client: clients.service() };
    }
    if (looksLikePersonalToken(bearer)) return authenticatePersonalToken(request, bearer, clients);
    if (looksLikeJwt(bearer)) {
      const client = clients.jwt(bearer);
      const { data, error } = await client.auth.getUser(bearer);
      if (!error && data.user) return { userId: data.user.id, mode: "jwt", client };
    }
    throw unauthorized(t("Invalid API token"));
  }

  const client = clients.session(request, jar);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw unauthorized();
  return { userId: data.user.id, mode: "session", client };
}

/**
 * `kortex.bootstrap_user()` is idempotent but costs a round trip, so it runs once per
 * user per server process (first authenticated request), not on every call.
 */
export function createBootstrapper(log: (msg: string, meta?: unknown) => void = () => {}) {
  const done = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  return {
    async ensure(ctx: AuthContext): Promise<void> {
      if (done.has(ctx.userId)) return;
      let p = inflight.get(ctx.userId);
      if (!p) {
        p = (async () => {
          try {
            if (ctx.mode === "api_token") {
              const { error } = await ctx.client.rpc("_bootstrap_user", { p_user_id: ctx.userId });
              if (error) throw error;
            } else {
              await bootstrapUser(ctx.client);
            }
            done.add(ctx.userId);
          } catch (err) {
            // Not fatal: the request can still work if the user was bootstrapped before.
            log("bootstrap_user failed", err);
          } finally {
            inflight.delete(ctx.userId);
          }
        })();
        inflight.set(ctx.userId, p);
      }
      await p;
    },
    reset: () => done.clear(),
  };
}
export type Bootstrapper = ReturnType<typeof createBootstrapper>;
