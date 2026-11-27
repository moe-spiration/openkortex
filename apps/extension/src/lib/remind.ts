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

export interface RemindChoice {
  key: "tonight" | "tomorrow" | "weekend" | "next-week";
  label: string;
  /** Short local time shown at the right ("19:00", "Sa 10:00"). */
  when: string;
  iso: string;
}

/**
 * The popup's four fixed snooze points after a save (keys 1 to 4): tonight 19:00 (21:00 once 19:00 has passed,
 * the next evening after 21:00), tomorrow 08:00, the weekend (Saturday 10:00; next Saturday on a weekend) and
 * next Monday 08:00.
 */
export function remindChoices(now: Date = new Date(), locale?: string): RemindChoice[] {
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const dayTime = (d: Date) => `${d.toLocaleDateString(locale, { weekday: "short" })} ${time(d)}`;
  let tonight = at(now, 0, 19);
  if (tonight.getTime() <= now.getTime()) tonight = at(now, 0, 21);
  if (tonight.getTime() <= now.getTime()) tonight = at(now, 1, 19);
  const tomorrow = at(now, 1, 8);
  const day = now.getDay();
  const toSat = day === 6 || day === 0 ? (6 - day + 7) % 7 || 7 : 6 - day;
  const weekend = at(now, toSat, 10);
  const toMonday = (8 - day) % 7 || 7;
  const monday = at(now, toMonday, 8);
  return [
    { key: "tonight", label: t("Tonight"), when: tonight.getDate() === now.getDate() ? time(tonight) : dayTime(tonight), iso: tonight.toISOString() },
    { key: "tomorrow", label: t("Tomorrow morning"), when: dayTime(tomorrow), iso: tomorrow.toISOString() },
    { key: "weekend", label: t("At the weekend"), when: dayTime(weekend), iso: weekend.toISOString() },
    { key: "next-week", label: t("Next week"), when: dayTime(monday), iso: monday.toISOString() },
  ];
}
