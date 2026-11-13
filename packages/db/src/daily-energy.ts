// Energy 1..10 of the daily check-in (`10_Notes/Daily/YYYY-MM-DD.md`, frontmatter `energy`): the one
// evaluation for Home ("Heute im Überblick") and Insights (Tactile Craft decision 11). Pure, no I/O.
// Re-exported by `@kortex/db/daily`.
//
// Rules
// - A day without a check-in has `energy: null`; it is never counted as 0.
// - Correlations are plain mean comparisons (with vs. without, above vs. below the median). No
//   regression, no significance test: with a few weeks of check-ins any model would overfit.
// - Below MIN_ENERGY_DAYS days with energy (or MIN_GROUP_DAYS on a side of a comparison) a result is
//   marked `enough: false`; the UI then says "Noch zu wenige Tage".

import { getLocale, intlLocale, t, tx } from "@kortex/i18n";
import { lazyList } from "./i18n";

/** Words for the energy scale in the current language, index = value (0 unused). Read through getters. */
export const ENERGY_LABELS: readonly string[] = lazyList([
  () => "",
  () => tx("energy", "Empty"),
  () => t("Very tired"),
  () => t("Tired"),
  () => t("Sluggish"),
  () => t("Okay"),
  () => t("Solid"),
  () => t("Good"),
  () => t("Very good"),
  () => t("Strong"),
  () => t("Full of energy"),
]);

/** Days with energy needed before an average or a correlation is shown. */
export const MIN_ENERGY_DAYS = 5;
/** Days needed on each side of a comparison. */
export const MIN_GROUP_DAYS = 2;

const DAY_MS = 86_400_000;
const plusDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Label of an energy value, "" for null or out of range. */
export function energyLabel(v: number | null | undefined): string {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? (ENERGY_LABELS[v] ?? "") : "";
}

/** A picked or stored value as 1..10 (rounded), null for anything else. */
export function normalizeEnergy(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 10 ? r : null;
}

/** One day of the evaluation. Missing fields mean "unknown", not "no". */
export interface EnergyDayFacts {
  /** "YYYY-MM-DD" */
  date: string;
  energy: number | null;
  /** Habit key -> done (keys of `user_settings.habits`). */
  habits?: Record<string, boolean>;
  /** Finished top-3 priorities (frontmatter `focus_done`). */
  focusDone?: number | null;
  /** New entries that day (output). */
  output?: number | null;
}

export interface EnergyPoint {
  date: string;
  energy: number | null;
}

/**
 * `days` calendar days ending `today`, oldest first; each day carries its energy or null. A later
 * entry for the same date wins (today's live check-in over the stored one).
 */
export function energySeries(facts: readonly EnergyDayFacts[], today: string, days: number): EnergyPoint[] {
  const by = new Map<string, number | null>();
  for (const f of facts) by.set(f.date, normalizeEnergy(f.energy));
  const n = Math.max(0, Math.floor(days));
  return Array.from({ length: n }, (_, i) => {
    const date = plusDays(today, i - (n - 1));
    return { date, energy: by.get(date) ?? null };
  });
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const known = (ps: readonly EnergyPoint[]) => ps.flatMap((p) => (p.energy === null ? [] : [p.energy]));

export interface EnergyStats {
  /** Days with a value. */
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  /** Last day with a value. */
  last: EnergyPoint | null;
  /** Average of the second half of the series minus the first half (null with too few days). */
  trend: number | null;
  enough: boolean;
}

export function energyStats(series: readonly EnergyPoint[]): EnergyStats {
  const vals = known(series);
  const half = Math.floor(series.length / 2);
  const first = known(series.slice(0, half));
  const second = known(series.slice(half));
  const a = mean(first);
  const b = mean(second);
  const last = [...series].reverse().find((p) => p.energy !== null) ?? null;
  return {
    count: vals.length,
    avg: mean(vals),
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    last,
    trend:
      a !== null && b !== null && first.length >= MIN_GROUP_DAYS && second.length >= MIN_GROUP_DAYS
        ? b - a
        : null,
    enough: vals.length >= MIN_ENERGY_DAYS,
  };
}

/** A mean comparison: average energy on days that match vs. days that do not. */
export interface EnergyComparison {
  key: string;
  /** Short label in the current language, e.g. "Morning Mobility" or "Top 3 done". */
  label: string;
  /** Wording of the two sides, e.g. "with" / "without". */
  withLabel: string;
  withoutLabel: string;
  withAvg: number | null;
  withoutAvg: number | null;
  /** withAvg - withoutAvg; null when a side has too few days. */
  delta: number | null;
  nWith: number;
  nWithout: number;
  enough: boolean;
}

function compare(
  key: string,
  label: string,
  sides: [string, string],
  days: readonly EnergyDayFacts[],
  test: (d: EnergyDayFacts) => boolean | null,
): EnergyComparison {
  const yes: number[] = [];
  const no: number[] = [];
  for (const d of days) {
    const e = normalizeEnergy(d.energy);
    if (e === null) continue;
    const hit = test(d);
    if (hit === true) yes.push(e);
    else if (hit === false) no.push(e);
  }
  const withAvg = mean(yes);
  const withoutAvg = mean(no);
  const enough = yes.length >= MIN_GROUP_DAYS && no.length >= MIN_GROUP_DAYS;
  return {
    key,
    label,
    withLabel: sides[0],
    withoutLabel: sides[1],
    withAvg,
    withoutAvg,
    delta: enough && withAvg !== null && withoutAvg !== null ? withAvg - withoutAvg : null,
    nWith: yes.length,
    nWithout: no.length,
    enough,
  };
}

/** Median of the values (the lower middle for an even count). */
function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

export interface EnergyCorrelations {
  /** Days with energy in the window. */
  days: number;
  enough: boolean;
  /** One comparison per tracked habit, the clearest difference first. */
  habits: EnergyComparison[];
  focus: EnergyComparison;
  output: EnergyComparison;
}

/**
 * Energy against habits, focus and output over `facts` (one window, e.g. the Insights range).
 * - Habits: per habit, days it was done vs. days it was tracked and not done.
 * - Focus: days with at least 2 of the top 3 done vs. fewer.
 * - Output: days with more new entries than the window's median vs. at or below it.
 */
export function energyCorrelations(
  facts: readonly EnergyDayFacts[],
  habitLabels: Readonly<Record<string, string>> = {},
): EnergyCorrelations {
  const withEnergy = facts.filter((f) => normalizeEnergy(f.energy) !== null);
  const keys = new Set<string>();
  for (const f of withEnergy) for (const k of Object.keys(f.habits ?? {})) keys.add(k);
  const habits = [...keys]
    .map((k) =>
      compare(`habit:${k}`, habitLabels[k] ?? k, [t("with"), t("without")], withEnergy, (d) =>
        d.habits && k in d.habits ? d.habits[k] === true : null,
      ),
    )
    .sort(
      (a, b) =>
        Number(b.enough) - Number(a.enough) ||
        Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
        a.label.localeCompare(b.label, intlLocale()),
    );
  const focus = compare("focus", t("Top 3 done"), [t("2 to 3 done"), t("0 to 1 done")], withEnergy, (d) =>
    typeof d.focusDone === "number" ? d.focusDone >= 2 : null,
  );
  const med = median(withEnergy.flatMap((d) => (typeof d.output === "number" ? [d.output] : [])));
  const output = compare(
    "output",
    t("New entries"),
    [t("more than {n}", { n: med ?? 0 }), t("{n} or fewer", { n: med ?? 0 })],
    withEnergy,
    (d) => (typeof d.output === "number" && med !== null ? d.output > med : null),
  );
  return { days: withEnergy.length, enough: withEnergy.length >= MIN_ENERGY_DAYS, habits, focus, output };
}

/** Decimal with one digit in the current language, e.g. "8.1" (German "8,1"). */
export const energyDecimal = (v: number) => (getLocale() === "de" ? v.toFixed(1).replace(".", ",") : v.toFixed(1));

/** Signed difference of a comparison: "+1.6", "−0.4" or "±0.0" (German with a decimal comma). */
export function energyDelta(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return `±${energyDecimal(0)}`;
  return `${r > 0 ? "+" : "−"}${energyDecimal(Math.abs(r))}`;
}
