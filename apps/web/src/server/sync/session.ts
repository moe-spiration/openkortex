import { t } from "@/i18n";
import { mintUserJwt } from "@kortex/mcp-server/jwt";
import { ApiError, forbidden, json } from "../api-error";
import { preflight, route, type DepsProvider } from "../route";

/*
 * POST /api/sync/session — vault sync on the user's PC (md-sync as the desktop sidecar).
 *
 * The desktop only holds the personal `kx_` token from "Mit Windows-App verbinden" (scope `sync`).
 * This route trades it for a short-lived Supabase access token of the token's owner, so md-sync
 * reads and writes the vault under RLS like the web app does, and no service-role key ever reaches
 * the PC. The sidecar calls it again shortly before `expires_at`; a revoked token ends the sync at
 * the next refresh (401).
 *
 *   { ok, access_token, expires_at (epoch ms), user_id, supabase_url, anon_key }
 */

/** Lifetime of a sync session. Short, so a revoked token stops the sync within the hour. */
export const SYNC_SESSION_TTL_SECONDS = 3600;

export interface SyncSessionBody {
  ok: true;
  access_token: string;
  expires_at: number;
  user_id: string;
  supabase_url: string;
  anon_key: string;
}

export function createSyncSessionHandlers(getDeps: DepsProvider) {
  return {
    POST: route(getDeps, async ({ auth, deps }) => {
      // Session and JWT callers already have a Supabase token; this is for API tokens only.
      if (auth.mode !== "api_token") throw forbidden(t("Only for API tokens of the Windows app"));
      const { supabaseJwtSecret, supabaseUrl, supabaseAnonKey } = deps.env;
      if (!supabaseJwtSecret || !supabaseUrl || !supabaseAnonKey)
        throw new ApiError("not_configured", t("Vault sync is not set up on the server (SUPABASE_JWT_SECRET is missing)"));
      const { token, expiresAtMs } = mintUserJwt(supabaseJwtSecret, auth.userId, SYNC_SESSION_TTL_SECONDS, deps.now().getTime());
      const body: SyncSessionBody = {
        ok: true,
        access_token: token,
        expires_at: expiresAtMs,
        user_id: auth.userId,
        supabase_url: supabaseUrl,
        anon_key: supabaseAnonKey,
      };
      return json(body); // no-store
    }),
    OPTIONS: preflight(getDeps),
  };
}
