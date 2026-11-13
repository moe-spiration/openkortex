// Daily-note streak and weekly-review date: ONE implementation for Home, Journal, Insights and
// the sidebar badge (spec W6, acceptance A-07/A-08). Pure, no I/O, no UI.
//
// Rules
// - Day boundary: midnight in the user's time zone (`user_settings`/env `KORTEX_TIMEZONE`);
//   invalid or missing zone → Europe/Berlin. Calendar days are "YYYY-MM-DD" strings.
// - A day counts when a daily note exists for it (`10_Notes/Daily/YYYY-MM-DD.md`); how many
//   entries a day has does not matter.
// - The current streak ends today, or yesterday when today has no entry yet (the day is not
//   over). One day without an entry before that ends it.
// - Week starts Monday. The review is due on `weekly_digest_day` (0 = Sunday … 6 = Saturday,
//   JS `getDay` order, the column's convention): on that weekday itself (today) or the next one.

import { getLocale, intlLocale, t } from "@kortex/i18n";
import "./i18n";

/** Fallback when a time zone is missing or not known to Intl. */
export const DEFAULT_TIME_ZONE = "Europe/Berlin";

/** Weekday abbreviations, index = 0 Sunday … 6 Saturday (weekly_digest_day order). */
export const WEEKDAY_SHORT_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
export const WEEKDAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type WeekdayShort = (typeof WEEKDAY_SHORT_DE)[number] | (typeof WEEKDAY_SHORT_EN)[number];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Epoch ms of noon UTC on an ISO day (noon keeps day arithmetic clear of any offset). */
const noonUtc = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

/** `iso` plus `n` calendar days. */
export function addDays(iso: string, n: number): string {
  return new Date(noonUtc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((noonUtc(b) - noonUtc(a)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday for an ISO day. */
export function weekdayOf(iso: string): number {
  return new Date(noonUtc(iso)).getUTCDay();
}

/** Monday of the week that contains `iso` (weeks start Monday). */
export function weekStart(iso: string): string {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7));
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** `tz` when Intl knows it, else Europe/Berlin. */
export function resolveTimeZone(tz: string | null | undefined): string {
  const zone = tz?.trim();
  if (!zone) return DEFAULT_TIME_ZONE;
  if (formatters.has(zone)) return zone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Calendar day ("YYYY-MM-DD") of `now` in time zone `tz` (fallback Europe/Berlin). */
export function todayIn(tz: string | null | undefined, now: Date = new Date()): string {
  const zone = resolveTimeZone(tz);
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(zone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Distinct valid ISO days. */
const daySet = (dates: Iterable<string>) => {
  const set = new Set<string>();
  for (const d of dates) if (typeof d === "string" && ISO_DAY.test(d)) set.add(d);
  return set;
};

/**
 * Consecutive days with a daily note, ending `today` or, when today has no entry yet, yesterday.
 * `dates`: days with a daily note (duplicates and order do not matter).
 */
export function currentStreak(dates: Iterable<string>, today: string): number {
  const set = daySet(dates);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** Longest run of consecutive days with a daily note (all of `dates`). */
export function streakRecord(dates: Iterable<string>): number {
  let record = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...daySet(dates)].sort()) {
    run = prev !== null && daysBetween(prev, d) === 1 ? run + 1 : 1;
    if (run > record) record = run;
    prev = d;
  }
  return record;
}

export interface ReviewDue {
  /** Day the weekly review is due ("YYYY-MM-DD", user's time zone): today or the next review weekday. */
  date: string;
  /** Badge text in the current language, e.g. "Fri" / "Fr". */
  weekdayShort: WeekdayShort;
  /** 0 = due today. */
  daysUntil: number;
  /** Monday of the week the review is due in. */
  weekStart: string;
}

/**
 * When the weekly review is due. `digestDay` = user_settings.weekly_digest_day (0 = Sunday).
 * Returns null for a missing or invalid day: show no badge rather than a guess (the Fr/So flicker
 * came from a fallback while the settings were loading).
 */
export function reviewDue(
  now: Date,
  tz: string | null | undefined,
  digestDay: number | null | undefined,
): ReviewDue | null {
  if (typeof digestDay !== "number" || !Number.isInteger(digestDay) || digestDay < 0 || digestDay > 6)
    return null;
  const today = todayIn(tz, now);
  const daysUntil = (digestDay - weekdayOf(today) + 7) % 7;
  const date = addDays(today, daysUntil);
  return {
    date,
    weekdayShort: (getLocale() === "de" ? WEEKDAY_SHORT_DE : WEEKDAY_SHORT_EN)[digestDay]!,
    daysUntil,
    weekStart: weekStart(date),
  };
}

/**
 * Badge tooltip, e.g. "Weekly review due: Fri, Oct 30, 2026" or "… due today (Sun, Oct 25, 2026)";
 * German: "Wochen-Review fällig: Fr, 30.10.2026" / "… heute fällig (So, 25.10.2026)".
 */
export function reviewDueTooltip(due: ReviewDue): string {
  const [y, m, d] = due.date.split("-");
  const day =
    getLocale() === "de"
      ? `${WEEKDAY_SHORT_DE[weekdayOf(due.date)]}, ${d}.${m}.${y}`
      : new Intl.DateTimeFormat(intlLocale(), { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
          new Date(noonUtc(due.date)),
        );
  return due.daysUntil === 0 ? t("Weekly review due today ({day})", { day }) : t("Weekly review due: {day}", { day });
}

// Energy evaluation (Home picker, Insights metric, Tactile Craft decision 11): daily-energy.ts.
export * from "./daily-energy";
