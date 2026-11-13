import { t, tn } from "@/i18n";
import {
  LIFE_DEFAULT_RANGE,
  LIFE_RANGES,
  type LifeAreaDetail,
  type LifeGoal,
  type LifePick,
  type LifeRange,
  type LifeRangeScore,
  type LifeRoutine,
  type LifeSignal,
} from "@/lib/mock/life";
import {
  activeAreaKeys,
  areaDef,
  areaOf,
  habitArea,
  LIFE_AREA_DEFS,
  type LifeAreaDef,
} from "./areas";
import {
  addDays,
  daysBetween,
  deDecimal,
  localDate,
  mondayOf,
  monthShort,
  weekdayIndex,
} from "./dates";
import type { DailyEntry, LifeSource, SourceItem, SourceTask } from "./source";

/*
 * Life areas from real data. Everything here is deterministic (no model call): scores, goals,
 * routines, metrics, the reflection sentence and the overview signals.
 *
 * Area score (0–100; `score` and `ranges`, see areaScoreWindow) = mean of the parts an area has
 * data for, over a window of 7, 30 or 90 days (the 30-day one is the area's `score`):
 *   goals     mean progress of its goal/project objects
 *   tasks     done in the window / (done in the window + still open) for tasks of its items
 *   activity  entries created in the window; 5 per 14 days = full
 *   habits    check-in habits of the area done / days in the window (growth: days with a journal entry)
 * An area with none of these has score 0 and `empty: true`. Each range also carries the score of the
 * window before it (`prev`) for the trend. `areaScore` is the older 14-day/this-week score the weekly
 * review compares week over week.
 */

export interface LifeData {
  areas: LifeAreaDetail[];
  signals: LifeSignal[];
  /** Weekday index of today (0 = Mo) for the routine grid. */
  today: number;
}

const PROJECT_PCT: Record<string, number> = {
  Idee: 5,
  Geplant: 15,
  "In Arbeit": 50,
  Review: 80,
  Pausiert: 30,
  Fertig: 100,
};
const GOAL_STATUS_PCT: Record<string, number> = { Erreicht: 100 };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

interface AreaParts {
  def: LifeAreaDef;
  items: SourceItem[];
  goals: SourceItem[];
  tasks: SourceTask[];
}

/** Items, goals and tasks per area. Tasks follow their source item's area. */
export function partition(src: LifeSource): Map<string, AreaParts> {
  const parts = new Map<string, AreaParts>(
    LIFE_AREA_DEFS.map((d) => [d.key, { def: d, items: [], goals: [], tasks: [] }]),
  );
  const areaById = new Map<string, string>();
  for (const it of src.items) {
    const k = areaOf(it);
    if (!k) continue;
    parts.get(k)!.items.push(it);
    areaById.set(it.id, k);
  }
  for (const g of src.goals) {
    const k = areaOf(g);
    if (!k) continue;
    parts.get(k)!.goals.push(g);
    areaById.set(g.id, k);
  }
  for (const t of src.tasks) {
    const k = t.sourceItemId ? areaById.get(t.sourceItemId) : undefined;
    if (k) parts.get(k)!.tasks.push(t);
  }
  return parts;
}

function goalOf(g: SourceItem, tasks: SourceTask[], today: string): LifeGoal {
  const m = g.metadata;
  const own = tasks.filter((t) => t.sourceItemId === g.id);
  let pct: number;
  if (g.type === "goal") {
    pct = num(m.progress_pct) ?? GOAL_STATUS_PCT[str(m.status) ?? ""] ?? 0;
  } else {
    const status = str(m.project_status);
    pct = own.length
      ? (own.filter((t) => t.done).length / own.length) * 100
      : (PROJECT_PCT[status ?? ""] ?? 0);
  }
  const target = str(m.target_date);
  const due =
    str(m.goal_timeframe) ??
    (target && /^\d{4}-\d{2}-\d{2}/.test(target) ? monthShort(target) : null) ??
    t("ongoing");
  const nextTask = own
    .filter((t) => !t.done)
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))[0];
  const status = str(m.status) ?? str(m.project_status);
  const next = nextTask
    ? nextTask.due && nextTask.due < today
      ? t("Next step: {title} (overdue)", { title: nextTask.title })
      : t("Next step: {title}", { title: nextTask.title })
    : str(m.target_metric)
      ? t("Goal: {goal}", { goal: str(m.target_metric) ?? "" })
      : status
        ? t("Status: {status}", { status })
        : t("No next step yet");
  return { t: g.title, due, pct: clamp(pct), next };
}

function routinesFor(def: LifeAreaDef, dailies: DailyEntry[], today: string): LifeRoutine[] {
  const monday = mondayOf(today);
  const week = dailies.filter((d) => d.date >= monday && d.date <= addDays(monday, 6));
  const labels = new Map<string, string>();
  for (const d of dailies.slice(-28))
    for (const h of d.habits) if (habitArea(h.label) === def.key) labels.set(h.key, h.label);
  const out: LifeRoutine[] = [...labels].map(([key, label]) => {
    const d: (0 | 1)[] = [0, 0, 0, 0, 0, 0, 0];
    for (const e of week)
      if (e.habits.some((h) => h.key === key && h.done)) d[weekdayIndex(e.date)] = 1;
    return { t: label, d };
  });
  // Writing the daily journal is the growth area's routine.
  if (def.key === "growth" && dailies.some((d) => daysBetween(d.date, today) <= 28)) {
    const d: (0 | 1)[] = [0, 0, 0, 0, 0, 0, 0];
    for (const e of week) d[weekdayIndex(e.date)] = 1;
    out.unshift({ t: t("Daily Journal"), d });
  }
  return out;
}

const lastActivity = (p: AreaParts) =>
  [...p.items, ...p.goals].reduce<string | null>(
    (m, i) => (!m || i.updated > m ? i.updated : m),
    null,
  );

/** Score of one area as of `asOf` (local date). Null when the area has no data at all. */
export function areaScore(p: AreaParts, src: LifeSource, asOf: string): number | null {
  const parts: number[] = [];
  const day = (iso: string) => localDate(iso, src.timeZone);
  const goals = p.goals.filter((g) => day(g.created) <= asOf);
  if (goals.length)
    parts.push(goals.reduce((t, g) => t + goalOf(g, p.tasks, asOf).pct, 0) / goals.length / 100);
  const from = addDays(asOf, -13);
  const done = p.tasks.filter(
    (t) => t.done && t.completed && day(t.completed) >= from && day(t.completed) <= asOf,
  ).length;
  const open = p.tasks.filter(
    (t) => day(t.created) <= asOf && (!t.done || (t.completed && day(t.completed) > asOf)),
  ).length;
  if (done + open) parts.push(done / (done + open));
  const recent = p.items.filter((i) => day(i.created) >= from && day(i.created) <= asOf).length;
  const known = p.items.some((i) => day(i.created) <= asOf);
  if (known || recent) parts.push(Math.min(1, recent / 5));
  const routines = routinesFor(
    p.def,
    src.dailies.filter((d) => d.date <= asOf),
    asOf,
  );
  if (routines.length) {
    const daysSoFar = weekdayIndex(asOf) + 1;
    parts.push(
      routines.reduce((t, r) => t + r.d.slice(0, daysSoFar).filter(Boolean).length / daysSoFar, 0) /
        routines.length,
    );
  }
  if (!parts.length) return null;
  return clamp((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

/**
 * Score of one area over the `days` days ending `asOf` (local date). Null when the area has no data
 * in or before the window. The prototype's "Habits, Ziele, Tagebuch und erledigte Tasks".
 */
export function areaScoreWindow(
  p: AreaParts,
  src: LifeSource,
  asOf: string,
  days: number,
): number | null {
  const parts: number[] = [];
  const day = (iso: string) => localDate(iso, src.timeZone);
  const from = addDays(asOf, -(days - 1));
  const goals = p.goals.filter((g) => day(g.created) <= asOf);
  if (goals.length)
    parts.push(goals.reduce((t, g) => t + goalOf(g, p.tasks, asOf).pct, 0) / goals.length / 100);
  const done = p.tasks.filter(
    (t) => t.done && t.completed && day(t.completed) >= from && day(t.completed) <= asOf,
  ).length;
  const open = p.tasks.filter(
    (t) => day(t.created) <= asOf && (!t.done || (t.completed && day(t.completed) > asOf)),
  ).length;
  if (done + open) parts.push(done / (done + open));
  const recent = p.items.filter((i) => day(i.created) >= from && day(i.created) <= asOf).length;
  const known = p.items.some((i) => day(i.created) <= asOf);
  if (known || recent) parts.push(Math.min(1, recent / Math.max(3, Math.round((days * 5) / 14))));
  // Habits and journal: only the days since the first check-in count, so a new user is not
  // measured against the days before Kortex.
  const inWindow = src.dailies.filter((d) => d.date >= from && d.date <= asOf);
  const first = src.dailies.find((d) => d.date <= asOf)?.date;
  if (inWindow.length && first) {
    const span = Math.max(1, Math.min(days, daysBetween(first > from ? first : from, asOf) + 1));
    const habits = new Map<string, number>();
    for (const d of inWindow)
      for (const h of d.habits)
        if (habitArea(h.label) === p.def.key)
          habits.set(h.key, (habits.get(h.key) ?? 0) + (h.done ? 1 : 0));
    const rates = [...habits.values()].map((n) => Math.min(1, n / span));
    if (p.def.key === "growth") rates.push(Math.min(1, inWindow.length / span));
    if (rates.length) parts.push(rates.reduce((a, b) => a + b, 0) / rates.length);
  }
  if (!parts.length) return null;
  return clamp((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

/** Scores of all three ranges, each with the window before it (trend). */
function rangesOf(p: AreaParts, src: LifeSource): Record<LifeRange, LifeRangeScore> {
  const out = {} as Record<LifeRange, LifeRangeScore>;
  for (const r of LIFE_RANGES)
    out[r] = {
      score: areaScoreWindow(p, src, src.today, r),
      prev: areaScoreWindow(p, src, addDays(src.today, -r), r),
    };
  return out;
}

/** Up to three things of an area to open from the overview: open goals/projects, then the newest entries. */
function picksOf(p: AreaParts, today: string): LifePick[] {
  const open = p.goals
    .filter((g) => goalOf(g, p.tasks, today).pct < 100)
    .sort((a, b) => b.updated.localeCompare(a.updated));
  const recent = [...p.items].sort((a, b) => b.updated.localeCompare(a.updated));
  return [...open, ...recent].slice(0, 3).map((i) => ({ id: i.id, title: i.title, type: i.type }));
}

function energyCorrelation(def: LifeAreaDef, dailies: DailyEntry[]): string | null {
  const recent = dailies.slice(-28).filter((d) => d.energy !== null);
  const habits = new Map<string, string>();
  for (const d of recent)
    for (const h of d.habits) if (habitArea(h.label) === def.key) habits.set(h.key, h.label);
  for (const [key, label] of habits) {
    const on = recent
      .filter((d) => d.habits.some((h) => h.key === key && h.done))
      .map((d) => d.energy!);
    const off = recent
      .filter((d) => !d.habits.some((h) => h.key === key && h.done))
      .map((d) => d.energy!);
    if (on.length < 3 || off.length < 3) continue;
    const diff =
      on.reduce((a, b) => a + b, 0) / on.length - off.reduce((a, b) => a + b, 0) / off.length;
    if (Math.abs(diff) < 0.5) continue;
    return diff > 0
      ? t("On days with {habit} your energy is {points} points higher on average.", { habit: label, points: deDecimal(Math.abs(diff)) })
      : t("On days with {habit} your energy is {points} points lower on average.", { habit: label, points: deDecimal(Math.abs(diff)) });
  }
  return null;
}

function topTag(items: SourceItem[]): string | null {
  const count = new Map<string, number>();
  for (const i of items)
    for (const t of i.tags)
      if (!/^(life|area|daily)\b/i.test(t)) count.set(t, (count.get(t) ?? 0) + 1);
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

function reflection(p: AreaParts, src: LifeSource, overdue: SourceTask[]): string {
  const { def } = p;
  const last = lastActivity(p);
  if (!last) {
    return t("No entries in {area} yet. Tag notes with #life/{key} or create a goal object, then this page fills up.", { area: def.name, key: def.key });
  }
  const sentences: string[] = [];
  const corr = energyCorrelation(def, src.dailies);
  if (corr) sentences.push(corr);
  const quiet = daysBetween(localDate(last, src.timeZone), src.today);
  const week = p.items.filter((i) => localDate(i.created, src.timeZone) >= mondayOf(src.today));
  if (quiet >= 7) sentences.push(t("There has been no new entry for {n} days.", { n: quiet }));
  else if (week.length) {
    const tag = topTag(week);
    sentences.push(
      tag
        ? tn(week.length, "{n} entry this week, most of them on #{tag}.", "{n} entries this week, most of them on #{tag}.", { tag })
        : tn(week.length, "{n} entry this week.", "{n} entries this week."),
    );
  }
  if (overdue.length)
    sentences.push(
      tn(overdue.length, "One task is overdue, first “{title}”.", "{n} tasks are overdue, first “{title}”.", { title: overdue[0]!.title }),
    );
  return sentences.slice(0, 2).join(" ") || t("Quiet week in this area, everything on track.");
}

function focusOf(goals: LifeGoal[], items: SourceItem[]): string {
  const open = goals.filter((g) => g.pct < 100).sort((a, b) => a.pct - b.pct)[0];
  const text = open?.t ?? (topTag(items) ? `#${topTag(items)}` : null);
  if (!text) return t("No focus yet");
  return text.length > 26 ? `${text.slice(0, 25).trimEnd()}…` : text;
}

function metricsFor(p: AreaParts, src: LifeSource): { v: string; l: string }[] {
  const monday = mondayOf(src.today);
  const week = p.items.filter((i) => localDate(i.created, src.timeZone) >= monday).length;
  const open = p.tasks.filter((t) => !t.done).length;
  const last = lastActivity(p);
  const quiet = last ? String(daysBetween(localDate(last, src.timeZone), src.today)) : "–";
  if (p.def.key === "health") {
    const e = src.dailies
      .filter((d) => daysBetween(d.date, src.today) < 7 && d.energy !== null)
      .map((d) => d.energy!);
    // No routine days: habits are not tracked in Kortex (Griply, 2026-11-12).
    return [
      {
        v: e.length ? deDecimal(e.reduce((a, b) => a + b, 0) / e.length) : "–",
        l: t("Energy, 7-day avg"),
      },
      { v: String(week), l: week === 1 ? t("Entry this week") : t("Entries this week") },
      { v: String(open), l: t("Open tasks") },
    ];
  }
  return [
    { v: String(week), l: week === 1 ? t("Entry this week") : t("Entries this week") },
    { v: String(open), l: t("Open tasks") },
    { v: quiet, l: t("Days since last entry") },
  ];
}

export function computeLife(src: LifeSource): LifeData {
  const parts = partition(src);
  const active = activeAreaKeys(src.areaLabels);
  const areas: LifeAreaDetail[] = [];
  const signals: LifeSignal[] = [];
  for (const def of LIFE_AREA_DEFS) {
    const p = parts.get(def.key)!;
    const goals = p.goals
      .map((g) => goalOf(g, p.tasks, src.today))
      .sort((a, b) => Number(a.pct >= 100) - Number(b.pct >= 100) || b.pct - a.pct)
      .slice(0, 6);
    const routines = routinesFor(def, src.dailies, src.today);
    const overdue = p.tasks
      .filter((t) => !t.done && t.due && t.due < src.today)
      .sort((a, b) => a.due!.localeCompare(b.due!));
    const ranges = rangesOf(p, src);
    const score = ranges[LIFE_DEFAULT_RANGE].score;
    const links = [...p.items]
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, 6)
      .map((i) => i.id);
    areas.push({
      key: def.key,
      name: def.name,
      img: def.img,
      tone: def.tone,
      score: score ?? 0,
      empty: score === null,
      active: active.includes(def.key),
      focus: focusOf(goals, p.items),
      vision: "",
      why: "",
      goals,
      routines,
      metrics: metricsFor(p, src),
      reflect: reflection(p, src, overdue),
      links,
      ranges,
      picks: picksOf(p, src.today),
    });

    if (!active.includes(def.key)) continue;
    const last = lastActivity(p);
    const quiet = last ? daysBetween(localDate(last, src.timeZone), src.today) : null;
    const corr = energyCorrelation(def, src.dailies);
    if (overdue.length)
      signals.push({
        key: def.key,
        area: def.name,
        text: tn(overdue.length, "{n} overdue task, first “{title}”.", "{n} overdue tasks, first “{title}”.", { title: overdue[0]!.title }),
        rank: 3,
      });
    if (quiet !== null && quiet >= 7)
      signals.push({
        key: def.key,
        area: def.name,
        text: t("No entry for {n} days.", { n: quiet }),
        rank: 2 + Math.min(quiet, 60) / 100,
      });
    if (corr) signals.push({ key: def.key, area: def.name, text: corr, rank: 1.5 });
  }
  // Most active area of the week as a positive signal when there is room.
  const monday = mondayOf(src.today);
  const busiest = areas
    .filter((a) => a.active)
    .map((a) => ({
      a,
      n: parts.get(a.key)!.items.filter((i) => localDate(i.created, src.timeZone) >= monday).length,
    }))
    .sort((x, y) => y.n - x.n)[0];
  if (busiest && busiest.n >= 3)
    signals.push({
      key: busiest.a.key,
      area: busiest.a.name,
      text: t("Most active area this week: {n} new entries.", { n: busiest.n }),
      rank: 1,
    });

  const seen = new Set<string>();
  const top = signals
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)))
    .slice(0, 3)
    .map((s) => ({ key: s.key, area: s.area, text: s.text }));
  return { areas, signals: top, today: weekdayIndex(src.today) };
}

/** Area display name for a key (review chips use the short form). */
export const areaShort = (key: string) => areaDef(key)?.short ?? key;
