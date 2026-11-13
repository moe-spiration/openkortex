// Snooze options of the clipper popup (S11): "Erinnere mich daran" after a clip was saved. Browser-local time:
// the popup runs on the user's own machine, so local wall-clock times are the user's times.
import { t } from "../i18n";

export interface RemindOption {
  key: "tonight" | "tomorrow" | "next-week";
  label: string;
  /** ISO instant sent as `remind_at`. */
  iso: string;
}

const at = (base: Date, addDays: number, hour: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** "Heute Abend" (18:00, 21:00 once 18:00 has passed, hidden after 21:00), "Morgen" 08:00, "Nächste Woche" Monday 08:00. */
export function remindOptions(now: Date = new Date()): RemindOption[] {
  const out: RemindOption[] = [];
  for (const hour of [18, 21]) {
    const d = at(now, 0, hour);
    if (d.getTime() > now.getTime()) {
      out.push({ key: "tonight", label: t("Tonight"), iso: d.toISOString() });
      break;
    }
  }
  out.push({ key: "tomorrow", label: t("Tomorrow"), iso: at(now, 1, 8).toISOString() });
  const toMonday = (8 - now.getDay()) % 7 || 7;
  out.push({ key: "next-week", label: t("Next week"), iso: at(now, toMonday, 8).toISOString() });
  return out;
}
