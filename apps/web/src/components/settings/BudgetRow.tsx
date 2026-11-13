"use client";

import { useEffect, useState } from "react";
import { ValueRow } from "@/app/(workspace)/settings/rows";
import { useSettings } from "@/lib/settings/store";
import { isLiveData } from "@/lib/workspace-data";
import { getAiBudget } from "@/server/limits/actions";
import { intlLocale, t } from "@/i18n";

/** Budget presets offered in the row (EUR per day). */
const PRESETS = [1, 2, 5, 10, 20];

const eur = (n: number) =>
  new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * S2a: the daily AI budget (user_settings.daily_ai_budget_eur) and today's spend. Calls stop with a
 * clear message once the budget is used up; it resets at midnight (Kortex time zone).
 */
export function BudgetRow() {
  const { user, updateUserSettings } = useSettings();
  const budget = Number(user.daily_ai_budget_eur ?? 2);
  const [spent, setSpent] = useState<number | null>(null);

  useEffect(() => {
    if (!isLiveData()) return;
    let alive = true;
    void getAiBudget().then((r) => {
      if (alive && r.ok) setSpent(r.data.spentEur);
    });
    return () => {
      alive = false;
    };
  }, [budget]);

  const options = [...new Set([...PRESETS, budget])].sort((a, b) => a - b).map((v) => ({ value: String(v), label: t("{amount} per day", { amount: eur(v) }) }));
  const help =
    spent === null
      ? t("Upper limit for AI costs per day; after that AI features stop until midnight")
      : spent >= budget
        ? t("Used up today: {spent} of {budget}. AI features pause until midnight.", { spent: eur(spent), budget: eur(budget) })
        : t("Spent today: {spent} of {budget} (estimate by token prices)", { spent: eur(spent), budget: eur(budget) });

  return (
    <ValueRow
      label={t("Daily AI budget")}
      help={help}
      icon="sparkles"
      value={eur(budget)}
      options={options}
      selected={String(budget)}
      onSelect={(v) => updateUserSettings({ daily_ai_budget_eur: Number(v) })}
    />
  );
}
