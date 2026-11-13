import { t } from "@/i18n";
import { createServerClient } from "@supabase/ssr";
import { createKortexClient, KORTEX_SCHEMA, type Database, type KortexClient } from "@kortex/db";
import { supabaseServerFetch } from "@/lib/supabase/config";
import { ApiError } from "./api-error";
import type { ServerEnv } from "./env";

/** Cookies Supabase wants to set (token refresh); the route wrapper copies them onto the response. */
export type CookieJar = Array<{ name: string; value: string; options?: Record<string, unknown> }>;

export interface SupabaseClients {
  /** Cookie session of the signed-in web user (RLS as that user). */
  session(request: Request, jar: CookieJar): KortexClient;
  /** Supabase access token sent as `Authorization: Bearer <jwt>` (RLS as that user). */
  jwt(token: string): KortexClient;
  /** Service role (bypasses RLS). Only for the personal API token; every query filters user_id. */
  service(): KortexClient;
}

const need = (value: string | undefined, name: string): string => {
  if (!value) throw new ApiError("not_configured", t("{name} is not set", { name }));
  return value;
};

export function parseCookieHeader(header: string | null): Array<{ name: string; value: string }> {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => {
      const i = part.indexOf("=");
      if (i < 0) return null;
      const name = part.slice(0, i).trim();
      const raw = part.slice(i + 1).trim();
      let value = raw;
      try {
        value = decodeURIComponent(raw);
      } catch {
        /* keep raw */
      }
      return name ? { name, value } : null;
    })
    .filter((c): c is { name: string; value: string } => c !== null);
}

export function serializeCookie(c: CookieJar[number]): string {
  const o = (c.options ?? {}) as {
    path?: string;
    maxAge?: number;
    domain?: string;
    sameSite?: string | boolean;
    secure?: boolean;
    httpOnly?: boolean;
    expires?: Date;
  };
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${o.path ?? "/"}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`);
  if (o.domain) parts.push(`Domain=${o.domain}`);
  if (o.sameSite) parts.push(`SameSite=${o.sameSite === true ? "Strict" : o.sameSite}`);
  if (o.secure) parts.push("Secure");
  if (o.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

export function createSupabaseClients(env: ServerEnv): SupabaseClients {
  // Self-hosting: the transport may go over an internal address (SUPABASE_INTERNAL_URL).
  const internal = supabaseServerFetch(env.raw);
  const transport = internal ? { fetch: internal } : {};
  return {
    session(request, jar) {
      const url = need(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL");
      const key = need(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
      return createServerClient<Database, "kortex">(url, key, {
        ...(internal ? { global: transport } : {}),
        db: { schema: KORTEX_SCHEMA },
        cookies: {
          getAll: () => parseCookieHeader(request.headers.get("cookie")),
          setAll: (cookies) => {
            jar.push(...cookies.map((c) => ({ name: c.name, value: c.value, options: c.options })));
          },
        },
      }) as unknown as KortexClient;
    },
    jwt(token) {
      const url = need(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL");
      const key = need(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
      return createKortexClient(url, key, {
        global: { ...transport, headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    },
    service() {
      const url = need(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL");
      const key = need(env.supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY");
      return createKortexClient(url, key, {
        ...(internal ? { global: transport } : {}),
        auth: { persistSession: false, autoRefreshToken: false },
      });
    },
  };
}
