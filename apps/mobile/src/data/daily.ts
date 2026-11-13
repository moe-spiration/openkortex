import { currentStreak } from "@kortex/db/daily";

/*
 * Daily check-in, the same file the web app writes: `10_Notes/Daily/<YYYY-MM-DD>.md`
 * (type daily_note, slug = date) with the Markdown body and the structured check-in in
 * `metadata.checkin`. Ported from apps/web/src/components/home/daily.ts; keep both in step.
 */

/**
 * Habits are no longer tracked in Kortex (they live in Griply, 2026-11-12). Old notes keep their habit lines:
 * a stored check-in's habits are carried through unchanged, a new day gets none.
 */
export interface DailyHabit {
  key: string;
  label: string;
  done: boolean;
}
export interface DailyFocus {
  key: string;
  text: string;
  done: boolean;
}
export interface DailyCheckin {
  date: string;
  /** Energy 1..10, null until picked. */
  energy: number | null;
  streak: number;
  habits: DailyHabit[];
  focus: DailyFocus[];
  mindDump: string[];
  voice: { at: string; seconds: number }[];
}
export const DAILY_FOLDER = "10_Notes/Daily";

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
type TaskLike = { id: string; title: string; status: string; due_date: string | null; priority: keyof typeof PRIORITY_RANK };

/** Up to 3 open tasks: overdue and due today first, then priority, then due date (as on the web). */
export function topTasks(date: string, tasks: readonly TaskLike[]): DailyFocus[] {
  const urgent = (due: string | null) => (due && due.slice(0, 10) <= date ? 0 : 1);
  return tasks
    .filter((t) => t.status !== "done" && t.status !== "cancelled")
    .sort((a, b) => urgent(a.due_date) - urgent(b.due_date) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .slice(0, 3)
    .map((t) => ({ key: t.id, text: t.title, done: false }));
}

export function seedCheckin(date: string, tasks: readonly TaskLike[], streak: number): DailyCheckin {
  return { date, energy: null, streak, habits: [], focus: topTasks(date, tasks), mindDump: [], voice: [] };
}

/** A stored check-in (metadata.checkin) merged onto the seed; null when it is not that day's. */
export function parseCheckin(date: string, raw: unknown, seed: DailyCheckin): DailyCheckin | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<DailyCheckin>;
  if (c.date !== date || !Array.isArray(c.focus)) return null;
  const habits = (Array.isArray(c.habits) ? c.habits : []).filter((h): h is DailyHabit => !!h && typeof h.key === "string" && typeof h.label === "string").map((h) => ({ key: h.key, label: h.label, done: !!h.done }));
  return { ...seed, ...c, habits };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const box = (done: boolean) => (done ? "[x]" : "[ ]");

/** Same Markdown as the web's toDailyMarkdown. The stored format stays German in every app language (it is read back, see dailyMerge.ts). */
export function toDailyMarkdown(c: DailyCheckin): string {
  const fm = [
    "---",
    "type: daily",
    `date: ${c.date}`,
    ...(c.energy != null ? [`energy: ${c.energy}`] : []),
    `streak: ${c.streak}`,
    ...(c.habits.length ? ["habits:", ...c.habits.map((h) => `  ${h.key}: ${h.done}`)] : []),
    `focus_done: ${c.focus.filter((f) => f.done).length}`,
    "tags: [daily]",
    "---",
  ];
  const body = [
    `# Daily Journal ${c.date}`,
    "",
    "## Check-in",
    ...(c.energy != null ? [`- Energie: ${c.energy}/10`] : []),
    ...c.habits.map((h) => `- ${box(h.done)} ${oneLine(h.label)}`),
    "",
    "## Top-3-Prioritäten",
    ...c.focus.map((f) => `- ${box(f.done)} ${oneLine(f.text)}`),
  ];
  if (c.mindDump.length) body.push("", "## Mind Dump", ...c.mindDump.map((line) => `- ${oneLine(line)}`));
  if (c.voice.length) body.push("", "## Voice Check-ins", ...c.voice.map((v) => `- ${v.at} · ${Math.floor(v.seconds / 60)}:${pad(v.seconds % 60)}`));
  return [...fm, ...body, ""].join("\n");
}

/**
 * Days in a row with a check-in, counted back from today (or yesterday while today has none yet):
 * the shared rule of @kortex/db/daily, as on the web. `days` are the dates (YYYY-MM-DD).
 */
export const streakOf = (days: readonly string[], today: string): number => currentStreak(days, today);
