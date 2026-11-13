"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { z } from "zod";
import { bootstrapUser, type Json } from "@kortex/db";
import { dataSource } from "@/lib/supabase/config";
import { getSession } from "@/lib/supabase/server";
import { lifeAreas, mergeLifeAreas } from "@/lib/settings/patch";

/*
 * Onboarding ("Erststart") in live mode: bootstraps the workspace (kortex.bootstrap_user(),
 * idempotent: user_settings row + 17 system folders) and stores the chosen life areas in
 * user_settings.custom_taxonomy as `{ kind: "life_area", label }` entries. Existing entries are
 * kept (merge). Theme and accent stay device-local. Never throws: `{ ok: false, error }`.
 */

export type OnboardingResult =
  { ok: true; data: { lifeAreas: string[] } } | { ok: false; error: string };

const InputSchema = z.object({
  areas: z.array(z.string().trim().min(1).max(120)).max(50),
});

export async function completeOnboarding(input: { areas: string[] }): Promise<OnboardingResult> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock")
    return { ok: false, error: t("Mock mode: setup stays on this device") };
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("Invalid life areas") };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    const { client, user } = session;
    await bootstrapUser(client);

    const { data: row, error } = await client
      .from("user_settings")
      .select("custom_taxonomy")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(t("No settings found"));
    const next = mergeLifeAreas(row.custom_taxonomy, parsed.data.areas);
    const { error: upErr } = await client
      .from("user_settings")
      .update({ custom_taxonomy: next as Json })
      .eq("user_id", user.id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true, data: { lifeAreas: lifeAreas(next) } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kortex] completeOnboarding failed:", message);
    return { ok: false, error: message };
  }
}
