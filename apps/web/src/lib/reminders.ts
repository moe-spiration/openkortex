/*
 * Reminders / snooze (S11). `knowledge_items.remind_at` (timestamptz) is the single source: a reminder
 * is "due" once it lies at or before the end of the user's current day, and it stays due until it is
 * cleared (done) or moved (snoozed again). Client-safe, no server imports.
 */

import { intlLocale, t } from "@/i18n";

export const DEFAULT_TIME_ZONE = "Europe/Berlin";


/** Offset (ms) of `timeZone` from UTC at the instant `at` (positive east of Greenwich). */
function tzOffsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock of `timeZone` shows `day` (YYYY-MM-DD) at `hhmm`. */
export function zonedInstant(day: string, hhmm: string, timeZone = DEFAULT_TIME_ZONE): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - tzOffsetMs(new Date(first), timeZone));
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Last millisecond of `day` in `timeZone` (ISO): reminders at or before it are due today. */
export function endOfDayIso(day: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Date(zonedInstant(addDays(day, 1), "00:00", timeZone).getTime() - 1).toISOString();
}

/** Is the reminder due on `day` (today, or overdue)? No reminder is never due. */
export function isDueOn(remindAt: string | null | undefined, day: string, timeZone = DEFAULT_TIME_ZONE): boolean {
  if (!remindAt) return false;
  const ms = Date.parse(remindAt);
  return !Number.isNaN(ms) && ms <= Date.parse(endOfDayIso(day, timeZone));
}

export interface SnoozePreset {
  key: "tonight" | "tomorrow" | "next-week";
  label: string;
  /** ISO instant to store in remind_at. */
  iso: string;
}

/** Local weekday (0 = Sunday) of a YYYY-MM-DD day. */
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/**
 * Quick options: "Heute Abend" (18:00, or 21:00 once 18:00 has passed; hidden after 21:00), "Morgen"
 * (08:00) and "Nächste Woche" (Monday 08:00). `day` is the user's local today.
 */
export function snoozePresets(now: Date, day: string, timeZone = DEFAULT_TIME_ZONE): SnoozePreset[] {
  const out: SnoozePreset[] = [];
  for (const hhmm of ["18:00", "21:00"]) {
    const at = zonedInstant(day, hhmm, timeZone);
    if (at.getTime() > now.getTime()) {
      out.push({ key: "tonight", label: t("This evening"), iso: at.toISOString() });
      break;
    }
  }
  out.push({ key: "tomorrow", label: t("Tomorrow"), iso: zonedInstant(addDays(day, 1), "08:00", timeZone).toISOString() });
  const toMonday = ((8 - weekdayOf(day)) % 7) || 7;
  out.push({ key: "next-week", label: t("Next week"), iso: zonedInstant(addDays(day, toMonday), "08:00", timeZone).toISOString() });
  return out;
}

/** A picked calendar day (`<input type="date">`) as the reminder instant: 08:00 local. null = invalid. */
export function dateToRemindIso(value: string, timeZone = DEFAULT_TIME_ZONE): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? zonedInstant(value, "08:00", timeZone).toISOString()
    : null;
}

/** Local YYYY-MM-DD of an instant. */
export function localDay(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "heute 18:00", "morgen", "überfällig seit 3 Tagen", "05.11." for the reminder, seen from `day`. */
export function remindLabel(iso: string, day: string, timeZone = DEFAULT_TIME_ZONE): string {
  const d = localDay(iso, timeZone);
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  const time = new Intl.DateTimeFormat(intlLocale(), { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  if (diff < 0) return diff === -1 ? t("due yesterday") : t("due for {n} days", { n: -diff });
  if (diff === 0) return t("today {time}", { time });
  if (diff === 1) return t("tomorrow {time}", { time });
  const [, m, dd] = d.split("-");
  return t("{month}/{day} {time}", { month: m!, day: dd!, time });
}

/** Value for `<input type="date">` from an instant, "" without one. */
export const dateInputValue = (iso: string | null | undefined, timeZone = DEFAULT_TIME_ZONE) =>
  iso ? localDay(iso, timeZone) : "";

