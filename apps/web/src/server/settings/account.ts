"use server";

import { t } from "@/i18n";
import { AccountPatchSchema, accountFrom, metadataFor, type AccountInfo } from "@/lib/settings/account";
import { runAction, type ActionCtx, type ActionResult } from "./run";

/*
 * Account card (Settings > Profil): auth user + user_settings.subscription_tier + vault counts.
 * Name, timezone and avatar URL are written to the auth user's user_metadata as the user.
 */

async function load({ client, userId, user }: ActionCtx): Promise<AccountInfo> {
  const [settings, items, files] = await Promise.all([
    client.from("user_settings").select("subscription_tier").eq("user_id", userId).maybeSingle(),
    client.from("knowledge_items").select("id", { count: "exact", head: true }).eq("user_id", userId),
    client.from("knowledge_items").select("file_size_bytes").eq("user_id", userId).not("file_size_bytes", "is", null),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  if (items.error) throw new Error(items.error.message);
  const storageBytes = files.error
    ? null
    : (files.data ?? []).reduce((sum, r) => sum + (Number((r as { file_size_bytes: number | null }).file_size_bytes) || 0), 0);
  return accountFrom(user, {
    entries: items.count ?? 0,
    storageBytes,
    tier: (settings.data as { subscription_tier?: string | null } | null)?.subscription_tier,
  });
}

/** The signed-in user's account card. */
export async function getAccount(): Promise<ActionResult<AccountInfo>> {
  return runAction("getAccount", load);
}

/** Changes display name, timezone or avatar URL (user_metadata) and returns the new card. */
export async function updateAccount(raw: unknown): Promise<ActionResult<AccountInfo>> {
  const parsed = AccountPatchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: (parsed.error.issues[0] ? t(parsed.error.issues[0].message) : t("Invalid input")) };
  return runAction("updateAccount", async (ctx) => {
    const { data, error } = await ctx.client.auth.updateUser({ data: metadataFor(parsed.data) });
    if (error) throw new Error(error.message);
    return load({ ...ctx, user: data.user ?? ctx.user });
  });
}
