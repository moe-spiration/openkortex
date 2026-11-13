"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { dataSource } from "@/lib/supabase/config";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import { getServerDeps } from "../deps";
import { budgetStatus } from "./usage";

/** Today's AI spend vs. the daily budget of the signed-in user (Settings → KI-Modelle & Routing). */
export async function getAiBudget(): Promise<
  { ok: true; data: { day: string; spentEur: number; budgetEur: number; remainingEur: number; exceeded: boolean } } | { ok: false; error: string }
> {
  enterRequestLocale(await requestLocale());
  if (dataSource() === "mock") return { ok: false, error: t("Mock mode") };
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    const s = await budgetStatus(getServerDeps(), session.user.id);
    if (!s) return { ok: false, error: t("Usage is not metered (SUPABASE_SERVICE_ROLE_KEY is missing)") };
    return { ok: true, data: s };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
