import { resolveWiki, wikiTitles } from "./links";

/*
 * What stands out in the week on the phone (same rules as apps/web/src/lib/daily/week-signals.ts): topics on
 * the rise, open loops, new connections between entries and what comes back. No model call, pure, covered by tests.
 */

export interface SignalNote {
  id: string;
  title: string;
  /** ISO day. */
  date: string;
  tags: readonly string[];
  /** Ids of the entries this one links to. */
  links: readonly string[];
  /** Vault folder; daily notes link to everything and are left out of the connections. */
  path?: string;
}

export interface SignalTask {
  id: string;
  title: string;
  /** ISO day. */
  due: string;
  done: boolean;
  sourceId?: string | null;
}

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week that holds `day` (YYYY-MM-DD). */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}

const isDaily = (tag: string) => /^#?daily$/i.test(tag);
const hash = (tag: string) => (tag.startsWith("#") ? tag : `#${tag}`);

export interface RisingTag {
  tag: string;
  now: number;
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
  const week = notes.filter((n) => n.date >= monday && n.date <= sunday && !n.path?.includes("/Daily")).sort((a, b) => b.date.localeCompare(a.date));
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
export function comingBack<T extends { id: string; remindAt?: string | null; archived?: boolean }>(items: readonly T[], monday: string): T[] {
  const end = addDays(monday, 7);
  return items
    .filter((i) => !i.archived && !!i.remindAt && i.remindAt.slice(0, 10) >= monday && i.remindAt.slice(0, 10) < end)
    .sort((a, b) => a.remindAt!.localeCompare(b.remindAt!));
}

/** The phone's entries as signal notes: date from "days ago", links resolved by title among the loaded entries. */
export function signalNotes<E extends { id: string; title: string; day: number; folder?: string; content?: string }>(entries: readonly E[], tagsOf: (id: string) => readonly string[], today: string): SignalNote[] {
  return entries.map((e) => ({
    id: e.id,
    title: e.title,
    date: addDays(today, -e.day),
    tags: tagsOf(e.id),
    path: e.folder,
    links: [...new Set(wikiTitles(e.content ?? ""))].map((x) => resolveWiki(entries, x)?.id).filter((x): x is string => !!x && x !== e.id),
  }));
}
