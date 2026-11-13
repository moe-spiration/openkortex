import { t } from "@/i18n";
import { runInRequestLocale } from "@/i18n/server";
import { ConfigError } from "@kortex/ai-core";
import { ApiError, errorResponse, toApiError } from "./api-error";
import { authenticate, type AuthContext } from "./auth";
import { corsHeaders, withHeaders } from "./cors";
import type { ServerDeps } from "./deps";
import { checkAccess } from "./limits/access";
import { withUsageContext } from "./limits/usage";
import { serializeCookie, type CookieJar } from "./supabase";

export interface RouteContext {
  request: Request;
  auth: AuthContext;
  deps: ServerDeps;
}

export type RouteHandler = (ctx: RouteContext) => Promise<Response>;
export type DepsProvider = () => ServerDeps;

/**
 * Wraps a handler with: auth (cookie session, Supabase JWT or API token) → one-time
 * bootstrap_user → handler → consistent `{ ok: false, error }` responses, CORS for the
 * extension and refreshed Supabase auth cookies.
 */
export function route(getDeps: DepsProvider, handler: RouteHandler) {
  // The whole request, error texts included, runs in the caller's language.
  return (request: Request): Promise<Response> => runInRequestLocale(request.headers, async () => {
    const jar: CookieJar = [];
    let extra = new Headers();
    let deps: ServerDeps | undefined;
    const finish = (res: Response) => {
      for (const c of jar) extra.append("set-cookie", serializeCookie(c));
      return withHeaders(res, extra);
    };
    try {
      deps = getDeps();
      extra = corsHeaders(request, deps.env.allowedOrigins);
      const auth = await authenticate(request, deps.env, deps.clients, jar);
      // S2a: signups are open, so only allowlisted accounts get past this point.
      await checkAccess(auth, deps);
      await deps.bootstrap.ensure(auth);
      const ctx = { request, auth, deps };
      // AI calls made while handling the request are metered to this user (server/limits).
      return finish(await withUsageContext({ userId: auth.userId }, () => handler(ctx)));
    } catch (err) {
      const apiErr =
        err instanceof ConfigError ? new ApiError("not_configured", err.message) : toApiError(err);
      if (apiErr.code === "server_error")
        deps?.log.error(`${request.method} ${new URL(request.url).pathname}`, err);
      const retry = (apiErr.details as { retry_after_sec?: number } | undefined)?.retry_after_sec;
      return finish(errorResponse(apiErr, apiErr.code === "rate_limited" && retry ? { "retry-after": String(retry) } : undefined));
    }
  });
}

/** `OPTIONS` handler for CORS preflight from the extension. */
export function preflight(getDeps: DepsProvider) {
  return async (request: Request): Promise<Response> => {
    let headers = new Headers();
    try {
      headers = corsHeaders(request, getDeps().env.allowedOrigins);
    } catch {
      /* no CORS headers */
    }
    return new Response(null, { status: 204, headers });
  };
}

/** Reads and parses a JSON body; a broken body becomes `invalid_request`. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("invalid_request", t("Body must be valid JSON"));
  }
}
