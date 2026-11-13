import { t } from "@/i18n";
import type { ReviewDue } from "@kortex/db/daily";

/*
 * Sidebar badges (W4, acceptance A-06): a badge exists only for a value above zero. No "0", no dash
 * placeholder, no badge while the value is unknown.
 */

/** Count badge text, or null when there is nothing to show. */
export function badgeValue(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? String(Math.round(n)) : null;
}

/** Life area percentage (quick overview): null for 0 %, empty areas or unknown scores. */
export function percentValue(score: number | null | undefined, empty = false): string | null {
  if (empty) return null;
  const v = badgeValue(score);
  return v === null ? null : `${v}%`;
}

/** Wochen-Review badge tooltip, e.g. "Fällig am Fr, 30.10." or "Heute fällig (So, 25.10.)". */
export function reviewTooltip(due: ReviewDue): string {
  const [, m, d] = due.date.split("-");
  const day = t("{weekday}, {month}/{day}", { weekday: due.weekdayShort, month: m!, day: d! });
  return due.daysUntil === 0 ? t("Due today ({day})", { day }) : t("Due on {day}", { day });
}
