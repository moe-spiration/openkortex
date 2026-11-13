// Snooze options of the Erinnerung row (S11), local phone time. Kept apart from the UI for the tests.

import { t } from "../i18n";

export interface RemindOption {
  key: "tonight" | "tomorrow" | "next-week";
  label: string;
  /** ISO instant stored as remind_at. */
  iso: string;
}

const at = (base: Date, addDays: number, hour: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** Tonight 18:00 (21:00 once 18:00 has passed, none after 21:00), tomorrow 08:00, next Monday 08:00. */
export function remindOptions(now: Date = new Date()): RemindOption[] {
  const out: RemindOption[] = [];
  for (const hour of [18, 21]) {
    const d = at(now, 0, hour);
    if (d.getTime() > now.getTime()) {
      out.push({ key: "tonight", label: t("This evening"), iso: d.toISOString() });
      break;
    }
  }
  out.push({ key: "tomorrow", label: t("Tomorrow"), iso: at(now, 1, 8).toISOString() });
  out.push({ key: "next-week", label: t("Next week"), iso: at(now, (8 - now.getDay()) % 7 || 7, 8).toISOString() });
  return out;
}
