/*
 * The seven days (Monday to Sunday) of the week around `today`, each with its daily note
 * (`10_Notes/Daily/<date>.md`) when there is one. The journal's week tab shows them above the weekly review,
 * so the review visibly builds on the days.
 */

import { weekdayShort } from "@/lib/date/words";

export interface WeekDay {
  date: string;
  /** "Mon" … "Sun" ("Mo" … "So"). */
  short: string;
  /** Day of the month, "26". */
  day: string;
  /** Id of the daily note, null when the day has none. */
  noteId: string | null;
  /** True when the day has an entry (a note, or a local/mock entry date). */
  done: boolean;
  isToday: boolean;
  isFuture: boolean;
}

/** `Date.getUTCDay()` numbers, Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function weekDays(today: string, notes: readonly { id: string; date: string }[], extraDates: readonly string[] = []): WeekDay[] {
  const byDate = new Map(notes.map((n) => [n.date, n.id]));
  const extra = new Set(extraDates);
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
  return WEEK.map((wd, i) => {
    const date = addDays(today, i - dow);
    const noteId = byDate.get(date) ?? null;
    return {
      date,
      short: weekdayShort(wd),
      day: String(Number(date.slice(8, 10))),
      noteId,
      done: !!noteId || extra.has(date),
      isToday: date === today,
      isFuture: date > today,
    };
  });
}
