import { DAILY_SEED } from "./home";

/*
 * Mock content of /journal, taken from design/reference/WebApp.dc.html (viewJournal).
 * One Markdown file per day in 10_Notes/Daily/YYYY-MM-DD.md; the Home check-in widget writes the same files.
 */

/** Daily notes listed on the page (lib/mock/notes.ts ids: 2026-10-22 and 2026-10-21). */
export const JOURNAL_NOTE_IDS = ["n1", "n19"];

/** Mock mode: days with a daily entry before today (Mo..Mi of the prototype week); the week strip is computed from dates, as in live mode. */
export const MOCK_ENTRY_DATES = ["2026-10-19", "2026-10-20", "2026-10-21"];

/** Activity of the last 12 weeks as 84 heat-map cells (percent, 0 = no entry). */
export const HEAT: number[] = Array.from({ length: 84 }, (_, i) => ((i * 37 + 11) % 100 > 38 ? ((i * 53) % 70) + 30 : 0));

export const JOURNAL_STREAK = DAILY_SEED.streak;
