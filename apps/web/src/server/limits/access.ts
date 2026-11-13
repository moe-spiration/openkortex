import { t } from "@/i18n";
import { ApiError } from "../api-error";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";

/*
 * Kortex allowlist (S2a): Supabase signups are open on the shared instance, so every request
 * checks kortex.allowed_users. Cached per user for ACCESS_TTL_MS so a removal applies within a
 * minute without a query per request.
 */

export const ACCESS_TTL_MS = 60_000;

export const noAccessMessage = (): string =>
  t("No access: this account is not enabled for Kortex. Please ask the operator for an invitation.");

const cache = new Map<string, { allowed: boolean; at: number }>();

/** True when the account is on the allowlist (RPC as the user, or service-role lookup for the API token). */
export async function isAllowed(auth: AuthContext, deps: Pick<ServerDeps, "now">): Promise<boolean> {
  const hit = cache.get(auth.userId);
  const t = deps.now().getTime();
  if (hit && t - hit.at < ACCESS_TTL_MS) return hit.allowed;
  let allowed: boolean;
  if (auth.mode === "api_token") {
    const { data, error } = await auth.client.from("allowed_users").select("user_id").eq("user_id", auth.userId).maybeSingle();
    if (error) throw new Error(`load allowlist: ${error.message}`);
    allowed = !!data;
  } else {
    const { data, error } = await auth.client.rpc("is_allowed");
    if (error) throw new Error(`is_allowed: ${error.message}`);
    allowed = data === true;
  }
  cache.set(auth.userId, { allowed, at: t });
  return allowed;
}

/** Throws `no_access` (403) for accounts that are not on the allowlist. */
export async function checkAccess(auth: AuthContext, deps: Pick<ServerDeps, "now">): Promise<void> {
  if (!(await isAllowed(auth, deps))) throw new ApiError("no_access", noAccessMessage());
}

/** Tests / admin tooling: forget cached decisions. */
export const resetAccessCache = () => cache.clear();
