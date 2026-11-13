import { t } from "@/i18n";
import type { KortexClient } from "@kortex/db";
import {
  cleanName,
  MAX_ACTIVE_TOKENS,
  scopesFor,
  tokenState,
  type ApiTokenRow,
  type TokenScope,
} from "./tokens";
import { generateToken, hashToken, tokenPrefix } from "./secret";

/* Token storage. Resolving uses the service role (the caller has no session yet); managing uses
   the signed-in user's client, so RLS decides (own rows, no hash column, revoke or delete). */

const COLUMNS = "id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at";
/** last_used_at is written at most this often per token. */
const TOUCH_EVERY_MS = 60_000;

export interface ResolvedToken {
  id: string;
  userId: string;
  name: string;
}

export type ResolveFailure = "unknown" | "revoked" | "expired" | "scope";

export async function resolveToken(
  service: KortexClient,
  raw: string,
  scope: TokenScope,
  now: Date,
): Promise<{ ok: true; token: ResolvedToken } | { ok: false; reason: ResolveFailure }> {
  const { data, error } = await service
    .from("api_tokens")
    .select("id, user_id, name, scopes, last_used_at, expires_at, revoked_at")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: "unknown" };
  const state = tokenState(data, now);
  if (state !== "active") return { ok: false, reason: state };
  if (!data.scopes.includes(scope)) return { ok: false, reason: "scope" };

  const last = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (now.getTime() - last >= TOUCH_EVERY_MS) {
    // Bookkeeping only: a failed touch must not fail the capture.
    await service.from("api_tokens").update({ last_used_at: now.toISOString() }).eq("id", data.id);
  }
  return { ok: true, token: { id: data.id, userId: data.user_id, name: data.name } };
}

export async function listTokens(client: KortexClient, userId: string): Promise<ApiTokenRow[]> {
  const { data, error } = await client
    .from("api_tokens")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApiTokenRow[];
}

/** Creates a token and returns the raw value exactly once. */
export async function createToken(
  client: KortexClient,
  userId: string,
  nameInput: string,
  now: Date,
  options: { expiresInDays?: number | null; search?: boolean; ask?: boolean; sync?: boolean } = {},
): Promise<{ token: string; row: ApiTokenRow }> {
  const name = cleanName(nameInput);
  const existing = await listTokens(client, userId);
  if (existing.filter((t) => tokenState(t, now) === "active").length >= MAX_ACTIVE_TOKENS) {
    throw new Error(t("At most {max} active tokens. Please revoke one first.", { max: MAX_ACTIVE_TOKENS }));
  }
  const raw = generateToken();
  const expires_at = options.expiresInDays
    ? new Date(now.getTime() + options.expiresInDays * 86_400_000).toISOString()
    : null;
  const { data, error } = await client
    .from("api_tokens")
    .insert({
      user_id: userId,
      name,
      token_hash: hashToken(raw),
      token_prefix: tokenPrefix(raw),
      scopes: scopesFor({ search: options.search, ask: options.ask, sync: options.sync }),
      expires_at,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return { token: raw, row: data as ApiTokenRow };
}

export async function revokeToken(client: KortexClient, userId: string, id: string, now: Date): Promise<void> {
  const { data, error } = await client
    .from("api_tokens")
    .update({ revoked_at: now.toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new Error(t("Token not found or already revoked."));
}

/**
 * Deletes a token for good (any state). The hash is gone with the row, so the token stops resolving at once
 * ("unknown"), exactly like a revoked one. Needs the delete policy of 20261101200000_api_tokens_delete.sql.
 */
export async function deleteToken(client: KortexClient, userId: string, id: string): Promise<void> {
  const { data, error } = await client.from("api_tokens").delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error(t("Token not found or already deleted."));
}
