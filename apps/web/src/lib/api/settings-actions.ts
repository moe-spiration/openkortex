"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import type { KortexClient } from "@kortex/db";
import { dataSource } from "@/lib/supabase/config";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import { newMcpTokenRecord } from "@/lib/settings/mcp-token";
import { checkUserSettingsPatch } from "@/lib/settings/patch";
import type { ClientUserSettings, McpTokenInfo } from "@/lib/settings/types";

/*
 * Server actions behind the settings store (lib/settings/store.tsx) in live mode. They run as the
 * signed-in user (RLS) and also filter by user_id. Never throw to the client: `{ ok: false, error }`,
 * the store rolls its optimistic change back.
 *
 * The browser never sees mcp_token_hash: reads select every column except it.
 */

export type SettingsResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Ctx = { client: KortexClient; userId: string };

/** Every user_settings column the client may read (all but mcp_token_hash). */
const CLIENT_COLUMNS =
  "user_id,preferred_chat_model,preferred_fast_model,embedding_model,auto_tag_enabled,auto_cluster_enabled," +
  "weekly_digest_day,custom_taxonomy,enabled_connectors,subscription_tier,ai_routing_config,embedding_lock," +
  "mcp_token_hint,mcp_token_created_at,locale,habits,daily_ai_budget_eur,auto_place_threshold,theme_pack,accent,updated_at";

async function run<T>(what: string, fn: (ctx: Ctx) => Promise<T>): Promise<SettingsResult<T>> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock")
    return { ok: false, error: t("Mock mode: settings stay on this device") };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    return { ok: true, data: await fn({ client: session.client, userId: session.user.id }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kortex] ${what} failed:`, message);
    return { ok: false, error: message };
  }
}

async function readRow({ client, userId }: Ctx): Promise<ClientUserSettings> {
  const { data, error } = await client
    .from("user_settings")
    .select(CLIENT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(t("No settings found"));
  return data as unknown as ClientUserSettings;
}

/** The signed-in user's user_settings row (without the token hash). */
export async function getUserSettings(): Promise<SettingsResult<ClientUserSettings>> {
  return run("getUserSettings", readRow);
}

/** Saves whitelisted columns (lib/settings/patch.ts) and returns the saved row. */
export async function updateUserSettings(
  patch: unknown,
): Promise<SettingsResult<ClientUserSettings>> {
  const check = checkUserSettingsPatch(patch);
  if (!check.ok) return { ok: false, error: check.error };
  return run("updateUserSettings", async (ctx) => {
    if (!Object.keys(check.patch).length) return readRow(ctx);
    const { data, error } = await ctx.client
      .from("user_settings")
      .update(check.patch)
      .eq("user_id", ctx.userId)
      .select(CLIENT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(t("No settings found"));
    return data as unknown as ClientUserSettings;
  });
}

/**
 * New MCP bearer token: generated here, stored as SHA-256 hash + hint, returned exactly once.
 * The previous token stops working immediately.
 */
export async function rotateMcpToken(): Promise<SettingsResult<McpTokenInfo & { token: string }>> {
  return run("rotateMcpToken", async ({ client, userId }) => {
    const { token, columns } = newMcpTokenRecord();
    const { data, error } = await client
      .from("user_settings")
      .update(columns)
      .eq("user_id", userId)
      .select("user_id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error(t("No settings found"));
    return { token, hint: columns.mcp_token_hint, createdAt: columns.mcp_token_created_at };
  });
}

/** Revokes the MCP bearer token (clears hash, hint and timestamp). */
export async function revokeMcpToken(): Promise<SettingsResult<null>> {
  return run("revokeMcpToken", async ({ client, userId }) => {
    const { error } = await client
      .from("user_settings")
      .update({ mcp_token_hash: null, mcp_token_hint: null, mcp_token_created_at: null })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return null;
  });
}
