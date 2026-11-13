/*
 * What stands out in a week, computed from data the shell already has (no model call): topics on the
 * rise, open loops, new connections between entries and what comes back for review. Shown on the
 * journal's Woche tab, which gathers what used to be spread over Insights, Review, Flashcards and
 * Reminders. Pure, covered by tests.
 */

export interface SignalNote {
  id: string;
  title: string;
  /** ISO day. */
  date: string;
  tags: readonly string[];
  links: readonly string[];
  /** Vault path; daily notes (10_Notes/Daily/) link to everything and are left out of the connections. */
  path?: string;
}

export interface SignalTask {
  id: string;
  title: string;
  /** ISO day. */
  due: string;
  done: boolean;
  sourceId?: string;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isDaily = (tag: string) => /^#?daily$/i.test(tag);
const hash = (tag: string) => (tag.startsWith("#") ? tag : `#${tag}`);

export interface RisingTag {
  tag: string;
  /** Entries with the tag this week. */
  now: number;
  /** Entries with the tag the week before. */
  before: number;
}

/** Hashtags used more this week than the week before, biggest rise first. */
export function risingTags(notes: readonly SignalNote[], monday: string, max = 4): RisingTag[] {
  const sunday = addDays(monday, 6);
  const prevMonday = addDays(monday, -7);
  const now = new Map<string, number>();
  const before = new Map<string, number>();
  for (const n of notes) {
    const into = n.date >= monday && n.date <= sunday ? now : n.date >= prevMonday && n.date < monday ? before : null;
    if (!into) continue;
    for (const raw of n.tags) {
      if (isDaily(raw)) continue;
      const tag = hash(raw);
      into.set(tag, (into.get(tag) ?? 0) + 1);
    }
  }
  return [...now]
    .map(([tag, count]) => ({ tag, now: count, before: before.get(tag) ?? 0 }))
    .filter((r) => r.now > r.before)
    .sort((a, b) => b.now - b.before - (a.now - a.before) || b.now - a.now || a.tag.localeCompare(b.tag))
    .slice(0, max);
}

export interface OpenLoop {
  id: string;
  title: string;
  due: string;
  overdue: boolean;
  sourceId: string | null;
}

/** Open tasks due up to the end of the week, the longest overdue first. */
export function openLoops(tasks: readonly SignalTask[], today: string, sunday: string, max = 5): OpenLoop[] {
  return tasks
    .filter((t) => !t.done && !!t.due && t.due <= sunday)
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title))
    .slice(0, max)
    .map((t) => ({ id: t.id, title: t.title, due: t.due, overdue: t.due < today, sourceId: t.sourceId ?? null }));
}

export interface Connection {
  fromId: string;
  from: string;
  toId: string;
  to: string;
}

/** Links that entries of this week made to other entries (each pair once, newest entry first). */
export function newConnections(notes: readonly SignalNote[], monday: string, max = 4): Connection[] {
  const sunday = addDays(monday, 6);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: Connection[] = [];
  const week = notes.filter((n) => n.date >= monday && n.date <= sunday && !n.path?.includes("/Daily/")).sort((a, b) => b.date.localeCompare(a.date));
  for (const n of week) {
    for (const id of n.links) {
      const other = byId.get(id);
      if (!other || other.id === n.id) continue;
      const key = [n.id, other.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ fromId: n.id, from: n.title, toId: other.id, to: other.title });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Entries whose reminder falls into the week (Monday to Sunday), earliest first. */
export function comingBack<T extends { id: string; remindAt?: string | null; status?: string }>(items: readonly T[], monday: string): T[] {
  const end = addDays(monday, 7);
  return items
    .filter((i) => i.status !== "archived" && !!i.remindAt && i.remindAt.slice(0, 10) >= monday && i.remindAt.slice(0, 10) < end)
    .sort((a, b) => a.remindAt!.localeCompare(b.remindAt!));
}
