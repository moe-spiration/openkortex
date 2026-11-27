import { loadDaily, loadDueReminders, loadRemindersUntil, loadTasks, loadWidgetItems, saveDaily, secureStorage } from "../api/kortex";
import { ensureConfigured } from "../api/restore";
import { placementOf } from "@kortex/db/gates";
import { isReviewCandidate } from "../data/live";
import { isoDay, parseCheckin, seedCheckin, streakOf } from "../data/daily";
import type { TaskRow } from "../data/live";
import type { DueItem } from "../notify/plan";
import { buildCheckin, buildEntries, buildToday, endOfDay, mergeDue, parsePrefs, TODAY_MAX, type CheckinModel, type EntryCard, type EntrySource, type TodayModel, type WidgetItem, type WidgetPrefs, parseStyle, type StoredStyle } from "./model";

/*
 * Loading for the widgets. Runs with the stored session, so it works in the headless widget task too.
 * `createCache` loads each part at most once per redraw round and only when a placed widget needs it.
 */

/** What the "Heute" widget shows. */
export interface TodayData {
  due: DueItem[];
  tasks: TaskRow[];
  /** Both reads failed (offline, signed out). */
  error: boolean;
}

export async function loadTodayData(): Promise<TodayData> {
  if (!(await ensureConfigured())) return { due: [], tasks: [], error: true };
  const [due, later, tasks] = await Promise.allSettled([loadDueReminders(), loadRemindersUntil(endOfDay(new Date()).toISOString()), loadTasks()]);
  const dueOk = due.status === "fulfilled" || later.status === "fulfilled";
  return {
    due: mergeDue(due.status === "fulfilled" ? due.value : [], later.status === "fulfilled" ? later.value : []),
    tasks: tasks.status === "fulfilled" ? tasks.value : [],
    error: !dueOk && tasks.status === "rejected",
  };
}

export const todayModel = (data: TodayData, doneIds: readonly string[] = [], snoozed: Readonly<Record<string, string>> = {}): TodayModel | null =>
  data.error ? null : buildToday(data.due, data.tasks, new Date(), TODAY_MAX, doneIds, snoozed);

async function loadEntries(source: EntrySource): Promise<EntryCard[] | null> {
  if (!(await ensureConfigured())) return null;
  try {
    const now = new Date();
    const rows = (await loadWidgetItems(source)).map<WidgetItem>((r) => ({
      ...r,
      target: source === "inbox" && isReviewCandidate(r, now) ? placementOf(r.metadata)?.folderPath || null : null,
    }));
    return buildEntries(rows, now);
  } catch {
    return null;
  }
}

export interface CheckinData {
  energy: number | null;
  days: string[];
  energies: Record<string, number>;
  stored: unknown;
}

async function loadCheckin(): Promise<CheckinData | null> {
  if (!(await ensureConfigured())) return null;
  try {
    const today = isoDay(new Date());
    const r = await loadDaily(today);
    const e = (r.stored as { energy?: unknown } | null)?.energy;
    return { energy: typeof e === "number" ? e : null, days: r.days, energies: r.energies, stored: r.stored };
  } catch {
    return null;
  }
}

export function checkinModel(data: CheckinData | null, energy?: number): CheckinModel | null {
  if (!data) return null;
  const today = isoDay(new Date());
  const e = energy ?? data.energy;
  const days = e != null && !data.days.includes(today) ? [today, ...data.days] : data.days;
  return buildCheckin(today, data.energies, streakOf(days, today), e);
}

/** Saves today's energy from the widget: the same check-in (and Markdown note) the app writes. */
export async function saveEnergy(n: number): Promise<void> {
  const today = isoDay(new Date());
  const [daily, tasks] = await Promise.all([loadDaily(today), loadTasks().catch(() => [] as TaskRow[])]);
  const days = daily.days.includes(today) ? daily.days : [today, ...daily.days];
  const seed = seedCheckin(today, tasks, streakOf(days, today));
  const stored = parseCheckin(today, daily.stored, seed);
  await saveDaily({ ...(stored ?? seed), energy: n, streak: seed.streak });
}

const PREFS_KEY = "kortex.widgets";

export async function loadPrefs(): Promise<WidgetPrefs> {
  try {
    return parsePrefs(await secureStorage.getItem(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
}

export async function savePrefs(prefs: WidgetPrefs): Promise<void> {
  await secureStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export type { StoredStyle };

export async function storedStyle(): Promise<StoredStyle> {
  return parseStyle(await secureStorage.getItem("kortex.prefs").catch(() => null));
}

/** Lazy, shared loads of one redraw round. */
export function createCache() {
  let today: Promise<TodayData> | undefined;
  let checkin: Promise<CheckinData | null> | undefined;
  let prefs: Promise<WidgetPrefs> | undefined;
  let style: Promise<StoredStyle> | undefined;
  const entries = new Map<EntrySource, Promise<EntryCard[] | null>>();
  return {
    today: () => (today ??= loadTodayData()),
    checkin: () => (checkin ??= loadCheckin()),
    prefs: () => (prefs ??= loadPrefs()),
    style: () => (style ??= storedStyle()),
    entries: (source: EntrySource) => {
      if (!entries.has(source)) entries.set(source, loadEntries(source));
      return entries.get(source)!;
    },
  };
}
export type WidgetCache = ReturnType<typeof createCache>;
