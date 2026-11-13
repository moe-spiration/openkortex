import { addDays, mondayOf } from "./weekSignals";

/*
 * Journal (Tagebuch) helpers on the phone, same rules as apps/web/src/lib/daily/journal.ts. Pure, covered by tests.
 */

/** Appends a journal prompt as its own line ("Wofür bin ich dankbar? "), so the answer follows on the same line. */
export function appendPrompt(text: string, prompt: string): string {
  const base = text && !text.endsWith("\n") ? `${text}\n` : text;
  return `${base}${prompt} `;
}

/** The daily notes (10_Notes/Daily/<date>.md) among the entries, newest first, with their date from the title. */
export function dailyNotes<E extends { id: string; title: string; folder?: string; day: number }>(entries: readonly E[]): (E & { date: string })[] {
  return entries
    .filter((e) => e.folder === "10_Notes/Daily" || !!e.folder?.startsWith("10_Notes/Daily/"))
    .flatMap((e) => {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(e.title);
      return m ? [{ ...e, date: m[1]! }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Writing intensity of a day for the heat map (web: writingLevel): 0 no daily note, 1 a note without written text
 * (check-in only), 2 a short entry, 3 an entry of 40 words or more.
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

/** 84 cells, twelve calendar weeks Monday to Sunday, oldest first (web: heatCells); one column per week. */
export function heatCells(today: string, levelOf: (date: string) => 0 | 1 | 2 | 3): HeatCell[] {
  const start = addDays(mondayOf(today), -77);
  return Array.from({ length: 84 }, (_, i) => {
    const date = addDays(start, i);
    const isFuture = date > today;
    return { date, level: isFuture ? 0 : levelOf(date), isToday: date === today, isFuture };
  });
}
