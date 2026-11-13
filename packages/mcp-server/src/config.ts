import { createKortexClient, type KortexClient } from "@kortex/db";
import { mintUserJwt } from "./jwt";
import type { BrainRepository } from "./repository";
import { SupabaseBrainRepository } from "./supabase-repository";

export { mintUserJwt };

type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function required(env: Env, ...names: string[]): string {
  for (const n of names) if (env[n]) return env[n] as string;
  throw new Error(`Missing environment variable ${names.join(" or ")}`);
}

export interface SupabaseConnection {
  client: KortexClient;
  userId: string;
  /** True in JWT mode (RLS applies), false with the service-role key. */
  userScoped: boolean;
}

/**
 * Supabase client for KORTEX_USER_ID from the environment. Two auth modes:
 *
 * - `SUPABASE_JWT_SECRET` (+ anon key): tokens for KORTEX_USER_ID are minted locally, so RLS
 *   applies (hybrid search via the `auth.uid()`-scoped RPC). Preferred.
 * - `SUPABASE_SERVICE_ROLE_KEY`: bypasses RLS; scoping relies on the explicit `user_id` filters in
 *   the repository (hybrid search via the service-role-only `match_knowledge_hybrid_for_user`).
 *
 * Both secrets can act as any user, so keep them out of shared config; see the README.
 */
export function createSupabaseConnectionFromEnv(env: Env = process.env): SupabaseConnection {
  return createSupabaseConnectionForUser(env, required(env, "KORTEX_USER_ID"));
}

/**
 * Same as `createSupabaseConnectionFromEnv` for an arbitrary user (remote mode: the user comes from
 * the OAuth token). `requireRls` refuses the service-role fallback, so a remote caller can never
 * reach data through a client that bypasses row level security.
 */
export function createSupabaseConnectionForUser(
  env: Env,
  userId: string,
  opts: { requireRls?: boolean } = {},
): SupabaseConnection {
  const url = required(env, "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  if (!UUID.test(userId))
    throw new Error("KORTEX_USER_ID must be a UUID (the Supabase auth user id)");
  if (opts.requireRls && !env.SUPABASE_JWT_SECRET) {
    throw new Error("Remote mode needs SUPABASE_JWT_SECRET (per-user RLS); the service role is never used for user data");
  }

  const jwtSecret = env.SUPABASE_JWT_SECRET;
  if (jwtSecret) {
    const anonKey = required(env, "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
    let cached: { token: string; expiresAtMs: number } | null = null;
    const client = createKortexClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      accessToken: async () => {
        if (!cached || cached.expiresAtMs - Date.now() < 60_000)
          cached = mintUserJwt(jwtSecret, userId);
        return cached.token;
      },
    });
    return { client, userId, userScoped: true };
  }

  const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  const client = createKortexClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, userId, userScoped: false };
}

/** The Supabase repository for KORTEX_USER_ID (see `createSupabaseConnectionFromEnv`). */
export function createSupabaseRepositoryFromEnv(env: Env = process.env): BrainRepository {
  return new SupabaseBrainRepository(createSupabaseConnectionFromEnv(env));
}

export interface HttpConfig {
  port: number;
  host: string;
  bearerToken: string;
}

export function loadHttpConfig(env: Env | undefined, opts: { bearerOptional: true }): Omit<HttpConfig, "bearerToken"> & { bearerToken?: string };
export function loadHttpConfig(env?: Env): HttpConfig;
export function loadHttpConfig(env: Env = process.env, opts: { bearerOptional?: boolean } = {}): Omit<HttpConfig, "bearerToken"> & { bearerToken?: string } {
  const port = Number(env.MCP_HTTP_PORT ?? 3333);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("MCP_HTTP_PORT must be a valid port");
  return {
    port,
    host: env.MCP_HTTP_HOST ?? "127.0.0.1",
    bearerToken: opts.bearerOptional ? env.MCP_BEARER_TOKEN || undefined : required(env, "MCP_BEARER_TOKEN"),
  };
}
