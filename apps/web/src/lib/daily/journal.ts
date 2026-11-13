/*
 * Pure helpers of the journal (Tagebuch, Feinschliff Live): what a daily note says, how much was written on a day,
 * the 12-week writing heat map, week labels and the "Frühere Einträge" time labels. The daily notes themselves are
 * `10_Notes/Daily/YYYY-MM-DD.md` (components/home/daily.ts writes them); the journal entry of a day is its
 * "## Mind Dump" section, one thought per line.
 */

import { getLocale, t, tx } from "@/i18n";
import { monthName, monthShort, weekdayShort } from "@/lib/date/words";

const DAY_MS = 86_400_000;

export const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday = 0 … Sunday = 6. */
export const weekdayIndex = (iso: string): number => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;

export const mondayOf = (iso: string): string => addDays(iso, -weekdayIndex(iso));

/** The lines of the "## Mind Dump" section of a daily note (list markers removed), [] when it has none. */
export function mindDumpOf(contentMd: string | null | undefined): string[] {
  if (!contentMd) return [];
  const lines = contentMd.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Mind Dump\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const l = raw.trim();
    if (/^#{1,6}\s/.test(l)) break;
    const text = l.replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "").trim();
    if (text) out.push(text);
  }
  return out;
}

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Writing intensity of a day for the heat map: 0 no daily note, 1 a note without written text (check-in only),
 * 2 a short entry, 3 an entry of 40 words or more.
 */
export function writingLevel(hasNote: boolean, text: string): 0 | 1 | 2 | 3 {
  const words = wordCount(text);
  if (words >= 40) return 3;
  if (words > 0) return 2;
  return hasNote ? 1 : 0;
}

export interface HeatCell {
  date: string;
  level: 0 | 1 | 2 | 3;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * 84 cells, twelve calendar weeks (Monday to Sunday, oldest first; the grid fills column by column, one column per
 * week). The last column is the current week, its days after today are future cells.
 */
export function heatCells(today: string, levelOf: (date: string) => 0 | 1 | 2 | 3): HeatCell[] {
  const start = addDays(mondayOf(today), -77);
  return Array.from({ length: 84 }, (_, i) => {
    const date = addDays(start, i);
    const isFuture = date > today;
    return { date, level: isFuture ? 0 : levelOf(date), isToday: date === today, isFuture };
  });
}

/** ISO 8601 week number. */
export function isoWeekNumber(iso: string): number {
  const d = new Date(iso + "T12:00:00Z");
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY_MS);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
}

/** The journal abbreviates September as "Sept." in German. */
const journalMonthShort = (month: number): string => (month === 8 ? tx("abbr", "Sept") : monthShort(month));
const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return { y, m, d };
};

/** "19. bis 25. Oktober 2026", across months "28. Oktober bis 3. November 2026", across years with both years. */
export function weekRangeLabel(monday: string): string {
  const a = parts(monday);
  const b = parts(addDays(monday, 6));
  const p = { d1: a.d, m1: monthName(a.m - 1), y1: a.y, d2: b.d, m2: monthName(b.m - 1), y2: b.y };
  if (a.y !== b.y) return t("{m1} {d1}, {y1} to {m2} {d2}, {y2}", p);
  if (a.m !== b.m) return t("{m1} {d1} to {m2} {d2}, {y2}", p);
  return t("{m2} {d1} to {d2}, {y2}", p);
}

/** "Heute, 08:12", "Gestern, 21:50", within the last week "Di, 22:10", else "17. Okt., 19:40" (time left out when empty). */
export function entryWhen(date: string, time: string, today: string): string {
  const at = time ? `, ${time}` : "";
  if (date === today) return t("Today") + at;
  if (date === addDays(today, -1)) return t("Yesterday") + at;
  const p = parts(date);
  if (date > addDays(today, -7) && date < today) return weekdayShort(new Date(date + "T12:00:00Z").getUTCDay()) + at;
  const day = t("{month} {day}", { day: p.d, month: journalMonthShort(p.m - 1) });
  return (parts(today).y !== p.y ? t("{date}, {year}", { date: day, year: p.y }) : day) + at;
}

/** Appends a journal prompt as its own line ("Wofür bin ich dankbar? "), so the answer follows on the same line. */
export function appendPrompt(text: string, prompt: string): string {
  const base = text && !text.endsWith("\n") ? text + "\n" : text;
  return `${base}${prompt} `;
}

/** The most used hashtags of the given notes (daily notes' own #daily left out), most used first. */
export function topHashtags(notes: readonly { tags: readonly string[] }[], n = 2): string[] {
  const counts = new Map<string, number>();
  for (const note of notes)
    for (const tag of note.tags) {
      if (/^#?daily$/i.test(tag)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([tag]) => tag);
}

/** Average of the known values with one decimal in the language's notation ("7.4" / "7,4"), null when there is none. */
export function averageLabel(values: readonly (number | null | undefined)[]): string | null {
  const known = values.filter((v): v is number => typeof v === "number");
  if (!known.length) return null;
  const avg = known.reduce((s, v) => s + v, 0) / known.length;
  const text = (Math.round(avg * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return getLocale() === "de" ? text.replace(".", ",") : text;
}
