import { getLocale, t, tx } from "@/i18n";

// Plain calendar helpers on ISO dates ("YYYY-MM-DD"), computed in UTC so they never drift with
// the server's own zone. Local dates come from `localDate(iso, timeZone)`.

const DAY_MS = 86_400_000;

/** The calendar date of an instant in `timeZone` ("YYYY-MM-DD"). */
export function localDate(at: string | Date, timeZone: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  return (new Date(utc(date)).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** ISO 8601 week: `{ year, week }` (the year of the week's Thursday). */
export function isoWeek(date: string): { year: number; week: number } {
  const thursday = addDays(mondayOf(date), 3);
  const year = Number(thursday.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week = 1 + Math.round(daysBetween(mondayOf(jan4), mondayOf(date)) / 7);
  return { year, week };
}

/** "2026-W43" */
export function isoWeekKey(date: string): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const monthsShort = () => [
  tx("month short", "Jan"),
  tx("month short", "Feb"),
  tx("month short", "Mar"),
  tx("month short", "Apr"),
  tx("month short", "May"),
  tx("month short", "Jun"),
  tx("month short", "Jul"),
  tx("month short", "Aug"),
  tx("month short", "Sep"),
  tx("month short", "Oct"),
  tx("month short", "Nov"),
  tx("month short", "Dec"),
];
const monthsLong = () => [
  t("January"),
  t("February"),
  t("March"),
  t("April"),
  tx("month long", "May"),
  t("June"),
  t("July"),
  t("August"),
  t("September"),
  t("October"),
  t("November"),
  t("December"),
];
const weekdaysLong = () => [
  t("Monday"),
  t("Tuesday"),
  t("Wednesday"),
  t("Thursday"),
  t("Friday"),
  t("Saturday"),
  t("Sunday"),
];

/** "Oct 22" / "22. Okt" */
export const shortDay = (date: string) =>
  t("{month} {day}", { day: Number(date.slice(8, 10)), month: monthsShort()[Number(date.slice(5, 7)) - 1] ?? "" });
/** "Dec" / "Dez" */
export const monthShort = (date: string) => monthsShort()[Number(date.slice(5, 7)) - 1] ?? "";
/** "Sunday, October 25" / "Sonntag, 25. Oktober" */
export const longDay = (date: string) =>
  t("{weekday}, {month} {day}", {
    weekday: weekdaysLong()[weekdayIndex(date)] ?? "",
    day: Number(date.slice(8, 10)),
    month: monthsLong()[Number(date.slice(5, 7)) - 1] ?? "",
  });

/** Decimal with one digit in the current language: 7.64 → "7.6" / "7,6". */
export const deDecimal = (n: number, digits = 1) =>
  getLocale() === "de" ? n.toFixed(digits).replace(".", ",") : n.toFixed(digits);

/** Calendar week as shown to the user: "Week 43" / "KW 43". */
export const weekLabel = (week: number) => t("Week {week}", { week });
/** Week with its year as digests store it (`metadata.iso_week`): "Week 43/2026" / "KW 43/2026". */
export const weekYearLabel = (week: number, year: number) => t("Week {week}/{year}", { week, year });
/** Both stored forms of a week label; readers accept either (older digests are German). */
export const weekYearLabels = (week: number, year: number): string[] => [`KW ${week}/${year}`, `Week ${week}/${year}`];
