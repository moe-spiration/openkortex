import { msg, t, tx } from "@/i18n";

/*
 * Calendar words in the current language. The tables hold the English source texts (`msg`), the
 * functions translate when they run, so nothing keeps the language of import time.
 */

const MONTHS = [
  msg("January"),
  msg("February"),
  msg("March"),
  msg("April"),
  msg("May"),
  msg("June"),
  msg("July"),
  msg("August"),
  msg("September"),
  msg("October"),
  msg("November"),
  msg("December"),
] as const;

/** With the abbreviation dot in German ("Okt."), hence their own context. */
const MONTHS_SHORT: readonly (() => string)[] = [
  () => tx("abbr", "Jan"),
  () => tx("abbr", "Feb"),
  () => tx("abbr", "Mar"),
  () => tx("abbr", "Apr"),
  () => tx("abbr", "May"),
  () => tx("abbr", "Jun"),
  () => tx("abbr", "Jul"),
  () => tx("abbr", "Aug"),
  () => tx("abbr", "Sep"),
  () => tx("abbr", "Oct"),
  () => tx("abbr", "Nov"),
  () => tx("abbr", "Dec"),
];

/** Sunday first, like `Date.getUTCDay()`. */
const WEEKDAYS_SHORT = [msg("Sun"), msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat")] as const;

/** Month name for a 0-based month ("October" / "Oktober"). */
export const monthName = (month: number): string => t(MONTHS[month] ?? "");

/** Short month for a 0-based month ("Oct" / "Okt."). */
export const monthShort = (month: number): string => MONTHS_SHORT[month]?.() ?? "";

/** Short weekday for `Date.getUTCDay()` (0 = Sunday): "Mon" / "Mo". */
export const weekdayShort = (day: number): string => t(WEEKDAYS_SHORT[day] ?? "");
