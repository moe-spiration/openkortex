import { t } from "@/i18n";
import { monthShort, weekdayShort } from "@/lib/date/words";

/** "Heute" / "Gestern" / "Mo, 20. Okt." relative to today (prototype dayOf). */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return t("Today");
  const y = new Date(today + "T12:00:00Z");
  y.setUTCDate(y.getUTCDate() - 1);
  if (iso === y.toISOString().slice(0, 10)) return t("Yesterday");
  const d = new Date(iso + "T12:00:00Z");
  return t("{weekday}, {month} {day}", { weekday: weekdayShort(d.getUTCDay()), month: monthShort(d.getUTCMonth()), day: d.getUTCDate() });
}
