import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { bootstrapUser, KORTEX_SCHEMA, type Database, type KortexClient } from "@kortex/db";
import type { User } from "@supabase/supabase-js";
import { LOCALE_COOKIE, t } from "@/i18n";
import { enterRequestLocale, localeOfRequest } from "@/i18n/server";
import { supabasePublicConfig, supabaseServerGlobal } from "./config";

/**
 * Supabase client bound to the request's auth cookies (server components, server actions, route
 * handlers). RLS runs as the signed-in user. Cookie writes are ignored in server components (they
 * can't set cookies); the middleware refreshes the session before they run.
 */
export async function createSupabaseServerClient(): Promise<KortexClient> {
  const cfg = supabasePublicConfig();
  if (!cfg) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  const store = await cookies();
  // Every server component, server action and session route passes through here: the rest of the
  // request answers in the user's language.
  enterRequestLocale(localeOfRequest(await headers(), store.get(LOCALE_COOKIE)?.value));
  return createServerClient<Database, "kortex">(cfg.url, cfg.anonKey, {
    ...supabaseServerGlobal(),
    db: { schema: KORTEX_SCHEMA },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // Called from a server component: the middleware already refreshed the session.
        }
      },
    },
  }) as unknown as KortexClient;
}

export interface SessionContext {
  client: KortexClient;
  user: User;
}

/** Signed-in user of this request (validated with the auth server), or null. Cached per request. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { client, user: data.user };
});

const bootstrapped = new Set<string>();

/** Signed in, but not on the Kortex allowlist (S2a: Supabase signups stay open). */
export class NoAccessError extends Error {
  constructor() {
    super(t("No access: this account is not enabled for Kortex."));
    this.name = "NoAccessError";
  }
}

const ACCESS_TTL_MS = 60_000;
const access = new Map<string, { allowed: boolean; at: number }>();

/** kortex.is_allowed() for the session user, cached per user for a minute. */
export async function isAllowed(ctx: SessionContext): Promise<boolean> {
  const hit = access.get(ctx.user.id);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.allowed;
  const { data, error } = await ctx.client.rpc("is_allowed");
  if (error) throw new Error(`is_allowed: ${error.message}`);
  const allowed = data === true;
  access.set(ctx.user.id, { allowed, at: Date.now() });
  return allowed;
}

/**
 * Throws NoAccessError for accounts that are not allowlisted, then runs `kortex.bootstrap_user()`
 * (idempotent: user_settings + system folders) once per user per server process. Bootstrap
 * failures are logged, not thrown: a bootstrapped user keeps working.
 */
export async function ensureBootstrapped(ctx: SessionContext): Promise<void> {
  if (!(await isAllowed(ctx))) throw new NoAccessError();
  if (bootstrapped.has(ctx.user.id)) return;
  try {
    await bootstrapUser(ctx.client);
    bootstrapped.add(ctx.user.id);
  } catch (err) {
    console.error("[kortex] bootstrap_user failed", err instanceof Error ? err.message : err);
  }
}
