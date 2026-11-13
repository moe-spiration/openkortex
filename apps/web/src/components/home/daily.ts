import { t } from "@/i18n";
import { normalizeEnergy, type EnergyDayFacts } from "@kortex/db/daily";
import { saveDailyCheckin, type ActionResult } from "@/lib/api/actions";
import { readApi } from "@/lib/api/read";
import { DAILY_SEED } from "@/lib/mock/home";
import { dailyStreakNow, isLiveData, TASKS } from "@/lib/workspace-data";

/*
 * Daily Check-in & Journal: the state behind the Home widget and how it maps to the vault file
 * `10_Notes/Daily/YYYY-MM-DD.md`.
 *
 * File shape (frontmatter = machine fields, body = the same data as readable Markdown):
 *
 *   ---
 *   type: daily
 *   date: 2026-10-22
 *   energy: 9                 # 1..10, omitted until picked
 *   streak: 14
 *   habits:
 *     mob: true               # habit key -> done
 *     carb: true
 *   focus_done: 1             # finished top-3 priorities
 *   tags: [daily]
 *   ---
 *   # Daily Journal 2026-10-22
 *
 *   ## Check-in
 *   - Energie: 9/10
 *   - [x] Morning Mobility
 *   - [x] Low-Carb Fokus
 *
 *   ## Top-3-Prioritäten
 *   - [x] Architektur-Sync vorbereiten
 *   - [ ] Mobility Session und Meal Prep
 *
 *   ## Mind Dump                (only when there are entries)
 *   - Gedanke ...
 *
 *   ## Voice Check-ins          (only when there are entries; audio + transcript live in 00_Inbox)
 *   - 08:12 · 0:30
 *
 * Mind dump and voice check-ins are part of the shape although the prototype's Home captures them
 * through the footbar orb, not inside the widget.
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

export interface VoiceCheckin {
  /** Local time of the recording, HH:MM. */
  at: string;
  seconds: number;
}

export interface DailyCheckin {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** Energy 1..10, null until picked. */
  energy: number | null;
  streak: number;
  habits: DailyHabit[];
  /** Top-3 priorities of the day. */
  focus: DailyFocus[];
  mindDump: string[];
  voice: VoiceCheckin[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local YYYY-MM-DD of a date. */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const dailyPath = (date: string) => `10_Notes/Daily/${date}.md`;

/**
 * Fresh check-in for a day. Mock: the prototype's defaults (energy 9). Live: the focus, nothing picked yet.
 * Habits are not tracked in Kortex any more (they live in Griply, 2026-11-12): a new day has none, an old
 * note keeps its stored habit lines when it is saved again.
 */
export function seedCheckin(date: string, live = false): DailyCheckin {
  return {
    date,
    energy: live ? null : DAILY_SEED.energy,
    streak: live ? dailyStreakNow() : DAILY_SEED.streak,
    habits: [],
    // Live: the day's top 3 are the user's most pressing open tasks; mock: the prototype list.
    focus: live ? topTasks(date) : DAILY_SEED.focus.map((f) => ({ ...f })),
    mindDump: [],
    voice: [],
  };
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

/** Up to 3 open tasks: overdue and due today first, then by priority, then by due date. */
export function topTasks(
  date: string,
  tasks: readonly {
    id: string;
    title: string;
    done: boolean;
    due: string;
    priority: keyof typeof PRIORITY_RANK;
  }[] = TASKS,
): DailyFocus[] {
  const urgent = (due: string) => (due && (!date || due <= date) ? 0 : 1);
  return tasks
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        urgent(a.due) - urgent(b.due) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (a.due || "9999").localeCompare(b.due || "9999"),
    )
    .slice(0, 3)
    .map((t) => ({ key: t.id, text: t.title, done: false }));
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const box = (done: boolean) => (done ? "[x]" : "[ ]");

/** Serializes a check-in to the Markdown file stored at `dailyPath(c.date)`. */
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
  if (c.mindDump.length) body.push("", "## Mind Dump", ...c.mindDump.map((t) => `- ${oneLine(t)}`));
  if (c.voice.length)
    body.push(
      "",
      "## Voice Check-ins",
      ...c.voice.map((v) => `- ${v.at} · ${Math.floor(v.seconds / 60)}:${pad(v.seconds % 60)}`),
    );
  return [...fm, ...body, ""].join("\n");
}

const STORE_PREFIX = "kortex.daily.v1:";

/** A stored check-in (localStorage or metadata.checkin of the daily note), merged onto the seed. */
function parseCheckin(date: string, raw: unknown, live: boolean): DailyCheckin | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<DailyCheckin>;
  if (c.date !== date || !Array.isArray(c.focus)) return null;
  const seed = seedCheckin(date, live);
  const habits = Array.isArray(c.habits) ? c.habits : [];
  // W6/A-08: the streak is never taken from storage. A stored check-in kept the value of its first
  // load (often 0, before the day's note existed), so the widget said "0" next to "1 Tag in Folge".
  return { ...seed, ...c, habits, streak: seed.streak };
}

/** Local copy of the day: the mock store, and the offline cache in live mode. */
export function loadCheckin(date: string, live = false): DailyCheckin {
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + date);
    const c = raw ? parseCheckin(date, JSON.parse(raw), live) : null;
    if (c) return c;
  } catch {
    /* storage blocked or corrupt: fall back to the seed */
  }
  return seedCheckin(date, live);
}

/** The stored local copy of a day, or null when this device has none (no seed). */
export function storedCheckin(date: string, live = false): DailyCheckin | null {
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + date);
    return raw ? parseCheckin(date, JSON.parse(raw), live) : null;
  } catch {
    return null;
  }
}

/**
 * The energy picker's change (Tactile Craft decision 11): sets the day's energy 1..10. Anything else
 * (0, 11, NaN) leaves the check-in untouched, so a stray value never reaches the daily note.
 */
export function pickEnergy(c: DailyCheckin, value: number): DailyCheckin {
  const energy = normalizeEnergy(value);
  return energy === null || energy === c.energy ? c : { ...c, energy };
}

/** A check-in as one day of the energy evaluation (`@kortex/db/daily` energyCorrelations). */
export function checkinFacts(c: DailyCheckin, output?: number | null): EnergyDayFacts {
  return {
    date: c.date,
    energy: c.energy,
    habits: Object.fromEntries(c.habits.map((h) => [h.key, h.done])),
    focusDone: c.focus.length ? c.focus.filter((f) => f.done).length : null,
    output: output ?? null,
  };
}

export function saveCheckin(c: DailyCheckin): void {
  try {
    window.localStorage.setItem(STORE_PREFIX + c.date, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/**
 * The day's check-in. Live: `metadata.checkin` of `10_Notes/Daily/<date>.md` via
 * GET /api/read/checkin (loadDailyCheckin), falling back to the local copy when offline or signed out.
 * An aborted read (`signal`, e.g. on unmount) rejects with an AbortError.
 */
export async function fetchCheckin(date: string, signal?: AbortSignal): Promise<DailyCheckin> {
  const live = isLiveData();
  const local = loadCheckin(date, live);
  if (!live) return local;
  const res = await readCheckin(date, signal);
  const remote = res.ok ? parseCheckin(date, res.data, live) : null;
  if (remote) saveCheckin(remote);
  return remote ?? local;
}

/** The stored check-in of a day (GET /api/read/checkin). */
const readCheckin = (date: string, signal?: AbortSignal) =>
  readApi<ActionResult<Record<string, unknown> | null>>("checkin", { date }, signal);

/** A change to one day's check-in, applied to the freshest known state. */
export type CheckinChange = (base: DailyCheckin) => DailyCheckin;

interface DayQueue {
  changes: CheckinChange[];
  onError: ((message: string) => void)[];
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * N5 #10: one queue per date (energy taps on Home and a Mind Dump from the Orbit-Bar no longer
 * share one timer), and no writer sends a whole stale check-in. Each writer queues a change; the
 * save reads the note's current check-in and applies the queued changes to it, so fields other
 * writers changed meanwhile survive. Saves of one date run one after another.
 */
const queues = new Map<string, DayQueue>();
const running = new Map<string, Promise<void>>();
const SAVE_DELAY_MS = 600;

/** Fields whose value differs between two check-ins. */
export function changedFields(prev: DailyCheckin, next: DailyCheckin): (keyof DailyCheckin)[] {
  return (Object.keys(next) as (keyof DailyCheckin)[]).filter(
    (k) => k !== "date" && JSON.stringify(prev[k]) !== JSON.stringify(next[k]),
  );
}

/** A change that sets the given fields of `next` (all fields when `fields` is omitted). */
export function setFields(
  next: DailyCheckin,
  fields?: readonly (keyof DailyCheckin)[],
): CheckinChange {
  const keys = (fields ?? (Object.keys(next) as (keyof DailyCheckin)[])).filter(
    (k) => k !== "date",
  );
  const patch = Object.fromEntries(keys.map((k) => [k, next[k]])) as Partial<DailyCheckin>;
  return (base) => ({ ...base, ...structuredClone(patch), date: base.date });
}

async function flush(date: string): Promise<void> {
  const q = queues.get(date);
  if (!q) return;
  queues.delete(date);
  const live = isLiveData();
  // The note's current state, not the one a widget loaded minutes ago.
  const res = await Promise.resolve()
    .then(() => readCheckin(date))
    .catch(() => null);
  const remote = res && res.ok ? parseCheckin(date, res.data, live) : null;
  const next = q.changes.reduce((c, change) => change(c), remote ?? loadCheckin(date, live));
  saveCheckin(next);
  const saved = await Promise.resolve()
    .then(() => saveDailyCheckin({ date, markdown: toDailyMarkdown(next), checkin: { ...next } }))
    .catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : t("Saving failed"),
    }));
  if (saved && !saved.ok) q.onError.forEach((fn) => fn(saved.error));
}

/** Runs the save for a date after the one already running for it. */
function scheduleFlush(date: string): void {
  const before = running.get(date) ?? Promise.resolve();
  const p = before
    .then(() => flush(date))
    .finally(() => {
      if (running.get(date) === p) running.delete(date);
    });
  running.set(date, p);
}

/**
 * Applies a change to a day's check-in: at once to the local copy (returned, for the UI), and in
 * live mode (debounced per date, energy taps come in bursts) to the daily note via
 * `saveDailyCheckin` (Markdown body + structured check-in).
 */
export function updateCheckinFor(
  date: string,
  change: CheckinChange,
  onError?: (message: string) => void,
): DailyCheckin {
  const live = isLiveData();
  const local = change(loadCheckin(date, live));
  saveCheckin(local);
  if (!live || !date) return local;
  const q = queues.get(date) ?? { changes: [], onError: [], timer: null };
  q.changes.push(change);
  if (onError && !q.onError.includes(onError)) q.onError.push(onError);
  if (q.timer) clearTimeout(q.timer);
  q.timer = setTimeout(() => {
    q.timer = null;
    scheduleFlush(date);
  }, SAVE_DELAY_MS);
  queues.set(date, q);
  return local;
}

/**
 * Saves a check-in. With `prev` (the state the widget changed), only the fields that differ are
 * written, merged onto the freshest state; without it, every field of `c`.
 */
export function persistCheckin(
  c: DailyCheckin,
  onError?: (message: string) => void,
  prev?: DailyCheckin,
): void {
  if (!c.date) return;
  const fields = prev ? changedFields(prev, c) : undefined;
  if (fields && !fields.length) return;
  updateCheckinFor(c.date, setFields(c, fields), onError);
}

/** Appends a Mind Dump line to a day's check-in (Orbit-Bar, chip "Journal"). */
export function appendMindDump(
  date: string,
  text: string,
  onError?: (message: string) => void,
): DailyCheckin {
  return updateCheckinFor(
    date,
    (base) => ({ ...base, mindDump: [...base.mindDump, text] }),
    onError,
  );
}

/** Title of a day's daily note (`saveDailyCheckin` writes it); also what `[[…]]` links to. */
export const dailyTitle = (date: string) => `Daily Journal ${date}`;

/** `[[Daily Journal 2026-11-03]]` → its date, for links to a note that is not loaded yet. */
export const dailyDateOf = (title: string): string | null => /^Daily Journal (\d{4}-\d{2}-\d{2})$/.exec(title.trim())?.[1] ?? null;

/**
 * Today's daily note for the editor's slash "Daily Note (heute)": the existing note, or (live) a new one
 * written from the day's check-in, so the editor, the Home check-in and the Journal share one file.
 */
export async function ensureDailyNote(
  date: string,
  known: readonly { id: string; date: string }[],
): Promise<{ id: string | null; title: string }> {
  const title = dailyTitle(date);
  const have = known.find((d) => d.date === date);
  if (have) return { id: have.id, title };
  if (!isLiveData()) return { id: null, title };
  const c = await fetchCheckin(date);
  const res = await saveDailyCheckin({ date, markdown: toDailyMarkdown(c), checkin: { ...c } });
  if (!res.ok) throw new Error(res.error);
  return { id: res.data.id, title };
}
