import type { EnergyDayFacts, EnergyPoint } from "@kortex/db/daily";
import type { InsightsData } from "@/lib/mock/insights";

/*
 * Energy as an Insights day metric (Tactile Craft decision 11). The evaluation itself (series, stats,
 * correlations) is `@kortex/db/daily`; this file only assembles the day facts from what the view has:
 *
 * - `InsightsData.energy`: energy and the main habit of the last 14 days (live: server/insights from the
 *   daily notes' check-ins; mock: the prototype series),
 * - `InsightsData.activity`: new entries per day (output),
 * - the check-ins stored on this device (`components/home/daily.ts` storedCheckin): all habits and the
 *   finished Top 3 of a day, and energy for days the 14-day window does not cover.
 *
 * Mock mode adds a deterministic 90-day history so the 30- and 90-day ranges have something to show.
 */

/** The subset of a stored check-in the evaluation reads (components/home/daily.ts DailyCheckin). */
export interface StoredDay {
  date: string;
  energy: number | null;
  habits: { key: string; label: string; done: boolean }[];
  focus: { done: boolean }[];
}

const DAY_MS = 86_400_000;
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Last day of the view: the newest activity or energy date. */
export function insightsToday(d: Pick<InsightsData, "activity" | "energy">): string | null {
  return d.activity.at(-1)?.date ?? d.energy.at(-1)?.date ?? null;
}

/** Habit key -> label of the days, plus the main habit of the energy chart. */
export function habitLabelsOf(d: Pick<InsightsData, "habitLabel">, stored: readonly StoredDay[]): { labels: Record<string, string>; mainKey: string } {
  const labels: Record<string, string> = {};
  for (const s of stored) for (const h of s.habits) labels[h.key] ??= h.label;
  const mainKey = (d.habitLabel && Object.keys(labels).find((k) => labels[k] === d.habitLabel)) || "main";
  if (d.habitLabel) labels[mainKey] = d.habitLabel;
  return { labels, mainKey };
}

/**
 * One fact per day of `days` days ending `today`. Server energy wins over the stored copy; habits and the
 * Top 3 come from the stored check-in when there is one, else only the main habit of the 14-day window.
 */
export function energyFacts(
  d: Pick<InsightsData, "energy" | "activity" | "habitLabel">,
  today: string,
  days: number,
  stored: readonly StoredDay[] = [],
): EnergyDayFacts[] {
  const { mainKey } = habitLabelsOf(d, stored);
  const server = new Map(d.energy.map((e) => [e.date, e]));
  const local = new Map(stored.map((s) => [s.date, s]));
  const output = new Map(d.activity.map((a) => [a.date, a.v]));
  return Array.from({ length: Math.max(0, days) }, (_, i) => {
    const date = plusDays(today, i - (days - 1));
    const e = server.get(date);
    const s = local.get(date);
    const habits: Record<string, boolean> = s ? Object.fromEntries(s.habits.map((h) => [h.key, h.done])) : {};
    if (e && d.habitLabel && !(mainKey in habits)) habits[mainKey] = e.habit;
    return {
      date,
      energy: e?.v ?? s?.energy ?? null,
      habits,
      focusDone: s && s.focus.length ? s.focus.filter((f) => f.done).length : null,
      output: output.get(date) ?? null,
    };
  });
}

/**
 * Mock history (90 days ending `today`): the prototype's 14 known days at the end, earlier days from a
 * fixed pseudo-random walk; Morning Mobility and finished Top 3 nudge the value, so the correlations
 * show a plausible but modest effect. Deterministic (no Math.random).
 */
export function mockEnergyDays(d: Pick<InsightsData, "energy" | "habitLabel">, today: string, days = 90): StoredDay[] {
  let seed = 7;
  const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const known = new Map(d.energy.map((e) => [e.date, e]));
  const label = d.habitLabel ?? "Morning Mobility";
  return Array.from({ length: days }, (_, i) => {
    const date = plusDays(today, i - (days - 1));
    const mob = r() > 0.35;
    const carb = r() > 0.45;
    const focusDone = Math.floor(r() * 4);
    const skip = r() < 0.12;
    const k = known.get(date);
    const base = 5.4 + (mob ? 1.2 : 0) + (focusDone >= 2 ? 0.6 : 0) + (r() - 0.5) * 2.4;
    const energy = k ? k.v : skip ? null : Math.max(1, Math.min(10, Math.round(base)));
    return {
      date,
      energy,
      habits: [
        { key: "mob", label, done: k ? k.habit : mob },
        { key: "carb", label: "Low-Carb Fokus", done: carb },
      ],
      focus: [0, 1, 2].map((j) => ({ done: j < focusDone })),
    };
  });
}

const yOf = (v: number) => 160 - (v / 10) * 160;

/** SVG path of the known points; a day without a check-in breaks the line. */
export function sparkPath(series: readonly EnergyPoint[]): { line: string; area: string } {
  const n = series.length;
  const x = (i: number) => (n <= 1 ? 500 : (i / (n - 1)) * 1000);
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  series.forEach((p, i) => {
    if (p.energy === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push([x(i), yOf(p.energy)]);
  });
  if (cur.length) runs.push(cur);
  const line = runs.map((r) => r.map(([a, b], j) => `${j ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ")).join(" ");
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `${r.map(([a, b], j) => `${j ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ")} L${r.at(-1)![0].toFixed(1)} 160 L${r[0]![0].toFixed(1)} 160 Z`)
    .join(" ");
  return { line, area };
}

