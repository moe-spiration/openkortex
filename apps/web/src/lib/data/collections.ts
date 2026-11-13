/*
 * Collection selectors (Tactile Craft v2, Paket D): pure functions behind Spaces / Alle Einträge, Objekte,
 * Hashtags and the Inbox triage. They read only real fields (source_url, metadata.duration_sec,
 * reading_minutes, page_count, reading_state, status, action items, links, tags, timestamps) and leave a
 * field out when the data has none (progressive disclosure). No React, no server imports: used by the
 * server pages and the client views alike, and unit-tested in collections.test.ts.
 */

import { DOMAIN_OBJECT_TYPES, TYPE_REGISTRY } from "@kortex/db";
import { intlLocale, msg, t, tn, tx } from "@/i18n";
import { monthName, monthShort, weekdayShort } from "@/lib/date/words";
import { resolveDensity } from "@/lib/settings/appearance";
import { CONTENT_TYPES } from "@/lib/spaces";
import type { Density } from "@kortex/ui";

/* ------------------------------------------------------------------------------------------- source */

/** Host without "www." from a URL; undefined for anything that is not an http(s) URL. */
export function domainOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/** Media length as a clock: 42:10, 1:12:04. */
export function clockOf(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? `${h}:` : "") + `${mm}:${String(r).padStart(2, "0")}`;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Length of an entry: a media clock (shown as the badge on the cover) or a quiet "14 Min." / "530 Seiten"
 * in the source line. Undefined when the item carries none.
 */
export function lengthOf(meta: Record<string, unknown> | undefined, pageCount?: number | null): { label: string; clock: boolean } | undefined {
  const sec = num(meta?.duration_sec);
  if (sec) return { label: clockOf(sec), clock: true };
  const pages = num(pageCount ?? meta?.page_count);
  if (pages) return { label: tn(pages, "{n} page", "{n} pages"), clock: false };
  const min = num(meta?.reading_minutes);
  if (min) return { label: t("{n} min", { n: Math.round(min) }), clock: false };
  return undefined;
}

/** Reading / listening progress 0..1 of a started medium (reading_state.progress); undefined when not started or done. */
export function progressOf(readingState: Record<string, unknown> | null | undefined): number | undefined {
  const p = readingState?.progress;
  if (typeof p !== "number" || !Number.isFinite(p)) return undefined;
  return p > 0 && p < 1 ? p : undefined;
}

/* ------------------------------------------------------------------------------------------- status */

export type StatusTone = "new" | "ok" | "run" | "mute" | "crit";
export interface EntryStatus {
  label: string;
  tone: StatusTone;
}

/** Status pill of an item from the pipeline status and the reading progress (live data; mock items have none). */
export function statusOf(status: string | undefined, progress?: number): EntryStatus | undefined {
  switch (status) {
    case "inbox":
      return { label: tx("status", "New"), tone: "new" };
    case "processing":
      return { label: t("Processing"), tone: "run" };
    case "error":
      return { label: t("Error"), tone: "crit" };
    case "archived":
      return { label: t("Archived"), tone: "mute" };
    case "processed":
      return progress !== undefined ? { label: t("Read {pct}%", { pct: Math.round(progress * 100) }), tone: "run" } : { label: t("Processed"), tone: "ok" };
    default:
      return undefined;
  }
}

/* -------------------------------------------------------------------------------------------- tasks */

/** Done / total of an item's action items; undefined without any. */
export function taskCountOf(items: readonly { done: boolean }[] | undefined): [number, number] | undefined {
  if (!items?.length) return undefined;
  return [items.filter((i) => i.done).length, items.length];
}

/* ----------------------------------------------------------------------------------------- objects */

/** Two-letter monogram of a name ("Dr. Louisa Weber" → "LW", "Kortex" → "Ko"). */
export function monogram(name: string): string {
  const words = name
    .replace(/^(Dr|Prof|Hr|Fr)\.\s+/i, "")
    .split(/[\s_-]+/)
    .filter((w) => /\p{L}|\d/u.test(w));
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  const w = words[0] ?? "?";
  return w.slice(0, 2).replace(/^(.)(.?)/, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
}

interface Linkable {
  id: string;
  links: readonly string[];
}

/**
 * Links in both directions between content items and domain objects: an item mentions an object, or the
 * object's note links back to the item. Returns object ids per item id and item ids per object id.
 */
export function linkIndex(items: readonly Linkable[], objects: readonly Linkable[]) {
  const objectIds = new Set(objects.map((o) => o.id));
  const itemIds = new Set(items.map((i) => i.id));
  const objectsOf = new Map<string, string[]>();
  const itemsOf = new Map<string, string[]>();
  const add = (item: string, obj: string) => {
    const a = objectsOf.get(item) ?? [];
    if (!a.includes(obj)) objectsOf.set(item, [...a, obj]);
    const b = itemsOf.get(obj) ?? [];
    if (!b.includes(item)) itemsOf.set(obj, [...b, item]);
  };
  for (const i of items) for (const l of i.links) if (objectIds.has(l)) add(i.id, l);
  for (const o of objects) for (const l of o.links) if (itemIds.has(l)) add(l, o.id);
  return { objectsOf, itemsOf };
}

export type DomainKind = "person" | "project" | "organization" | "concept" | "tool" | "asset" | "goal";

export interface ObjectColumn {
  key: string;
  label: string;
  /** Right-aligned number column. */
  numeric?: boolean;
  /** Pill column (status values). */
  status?: boolean;
}

/** Frontmatter fields per object type, in table order (packages/db domain.ts). Labels are English sources, translated in `objectColumns`. */
export const OBJECT_FIELDS: Record<DomainKind, ObjectColumn[]> = {
  person: [
    { key: "role", label: msg("Role") },
    { key: "organization", label: msg("Organization") },
    { key: "relationship", label: msg("Relationship") },
  ],
  organization: [
    { key: "org_type", label: msg("Kind") },
    { key: "industry", label: msg("Industry") },
    { key: "location", label: msg("Location") },
  ],
  project: [
    { key: "priority", label: msg("Priority") },
    { key: "target_date", label: msg("Target date") },
  ],
  concept: [
    { key: "category", label: msg("Category") },
    { key: "maturity", label: msg("Maturity") },
  ],
  tool: [
    { key: "tool_category", label: msg("Category") },
    { key: "pricing", label: msg("Price") },
  ],
  asset: [
    { key: "asset_type", label: msg("Kind") },
    { key: "location", label: msg("Location") },
    { key: "monthly_value", label: msg("Monthly value"), numeric: true },
  ],
  goal: [
    { key: "goal_timeframe", label: msg("Timeframe") },
    { key: "target_metric", label: msg("Metric") },
    { key: "progress_pct", label: msg("Progress"), numeric: true },
  ],
};

/** Status field per object type. */
export const OBJECT_STATUS_FIELD: Record<DomainKind, string | null> = {
  person: null,
  organization: null,
  project: "project_status",
  concept: null,
  tool: "usage_status",
  asset: "status",
  goal: "status",
};

const PRIORITY_LABEL: Record<string, string> = { low: msg("Low"), medium: msg("Medium"), high: msg("High"), urgent: msg("Urgent") };

/** "2026-12-31" → "31. Dez. 2026". */
export function shortDate(isoDay: string, withYear = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!m) return isoDay;
  const p = { day: Number(m[3]), month: monthShort(Number(m[2]) - 1), year: m[1]! };
  return withYear ? t("{month} {day}, {year}", p) : t("{month} {day}", p);
}

/** Display value of a frontmatter field; undefined when empty. */
export function fieldValue(key: string, raw: unknown): string | undefined {
  if (key === "monthly_value") {
    const n = typeof raw === "number" ? raw : undefined;
    return n === undefined ? undefined : n.toLocaleString(intlLocale()) + " €";
  }
  if (key === "progress_pct") return typeof raw === "number" ? t("{pct}%", { pct: Math.round(raw) }) : undefined;
  if (key === "priority") return str(raw) ? (PRIORITY_LABEL[str(raw)!] ? t(PRIORITY_LABEL[str(raw)!]!) : str(raw)) : undefined;
  if (key === "target_date") return str(raw) ? shortDate(str(raw)!) : undefined;
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string").join(", ") || undefined;
  return str(raw);
}

/**
 * Table columns of an object type: only frontmatter fields at least one object has (progressive disclosure).
 * Name, Einträge, Verknüpft mit, Letzter Kontakt and Status are added by the view around these.
 */
export function objectColumns(type: DomainKind, rows: readonly { metadata: Record<string, unknown> }[]): ObjectColumn[] {
  return (OBJECT_FIELDS[type] ?? []).filter((c) => rows.some((r) => fieldValue(c.key, r.metadata[c.key]) !== undefined)).map((c) => ({ ...c, label: t(c.label) }));
}

/** Tone of an object status value (German and English spellings of the usual states). */
export function objectStatusTone(value: string): StatusTone {
  const v = value.toLowerCase();
  if (/(fertig|erledigt|done|aktiv|active|im stack|vermietet|abgeschlossen|erreicht)/.test(v)) return "ok";
  if (/(arbeit|progress|läuft|review|prüfung|test)/.test(v)) return "run";
  if (/(geplant|planung|planned|idee|neu|new)/.test(v)) return "new";
  return "mute";
}

/* ------------------------------------------------------------------------------------------ density */

export type CollectionKind = "spaces" | "objects" | "hashtags" | "inbox";

/** Density scope of a collection view (plan 5.5): spaces:<key>, objects:<type>, hashtags, inbox. */
export function collectionScope(kind: CollectionKind, key?: string): string {
  return kind === "hashtags" || kind === "inbox" ? kind : `${kind}:${key ?? "all"}`;
}

/**
 * Density a collection renders with (decision 3): an open drawer always shows "dicht" (display only, the
 * user's choice stays stored), otherwise the choice for this view, then the global default (Kompakt).
 */
export function collectionDensity(opts: { chosen?: Density | null; global?: Density; drawerOpen?: boolean }): Density {
  return resolveDensity({ global: opts.global ?? "kompakt", scoped: opts.chosen ?? undefined, drawerOpen: opts.drawerOpen });
}

/* -------------------------------------------------------------------------------------- placeholder */

/** Lucide glyph name of the monochrome placeholder per entry type (decision 13: one thin type icon, no brand colours). */
export const PLACEHOLDER_GLYPH: Record<string, string> = {
  note: "file-text",
  meeting: "mic",
  article: "globe",
  book: "book-open",
  video: "play",
  podcast: "audio-lines",
  ai: "sparkles",
  recipe: "chef-hat",
  person: "user",
  project: "rocket",
  organization: "building-2",
  concept: "lightbulb",
  tool: "wrench",
  asset: "landmark",
  goal: "target",
};

/**
 * What the visual slot of an entry shows: its own image, or the monochrome placeholder. Theme-pack tiles and
 * favicons never stand in for a missing image any more (decision 13); logos would be blown up by object-fit.
 */
export function visualOf(cover: string | null | undefined, kind: string): { kind: "image"; src: string } | { kind: "placeholder"; glyph: string } {
  if (cover && !/\.svg(\?|$)/i.test(cover)) return { kind: "image", src: cover };
  return { kind: "placeholder", glyph: PLACEHOLDER_GLYPH[kind] ?? "file-text" };
}

/* --------------------------------------------------------------------------------------------- week */

const DAY_MS = 864e5;

const parseDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Adds n days to an ISO day. */
export function addDays(day: string, n: number): string {
  return isoDay(new Date(parseDay(day).getTime() + n * DAY_MS));
}

/** Monday of the ISO week of a day. */
export function weekStart(day: string): string {
  const d = parseDay(day);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

/** ISO calendar week number. */
export function isoWeek(day: string): number {
  const t = parseDay(day);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - firstThu.getTime()) / DAY_MS - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

export interface WeekEntryIn {
  id: string;
  date: string;
  time: string;
  title: string;
  /** CSS colour of the entry bullet (type colour); a neutral dot when left out. */
  color?: string;
}
export interface WeekPlanIn {
  id: string;
  /** ISO due day. */
  due: string;
  title: string;
  done?: boolean;
  /** Item the task comes from (opens on click). */
  sourceId?: string;
}

export interface WeekDay {
  date: string;
  /** "Mon" … "Sun" ("Mo" … "So"). */
  dow: string;
  /** Day of month. */
  day: number;
  today: boolean;
  /** Captured entries, earliest first. */
  entries: WeekEntryIn[];
  /** Tasks due that day: the open ones, with `withDone` also the done ones (after the open ones). */
  planned: WeekPlanIn[];
}

export interface WeekData {
  start: string;
  end: string;
  /** "26. Okt. bis 1. Nov." */
  title: string;
  kw: number;
  /** Entries captured in this week. */
  count: number;
  days: WeekDay[];
}

function plansOn(plans: readonly WeekPlanIn[], date: string, withDone: boolean): WeekPlanIn[] {
  const day = plans.filter((p) => p.due === date && (withDone || !p.done));
  return withDone ? [...day.filter((p) => !p.done), ...day.filter((p) => p.done)] : day;
}

/** Week calendar data (Mo..So) around `anchor`: entries per day plus the tasks due that day (open only unless `withDone`). */
export function buildWeek(
  entries: readonly WeekEntryIn[],
  plans: readonly WeekPlanIn[],
  anchor: string,
  today: string,
  opts: { withDone?: boolean } = {},
): WeekData {
  const start = weekStart(anchor);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return {
      date,
      dow: weekdayShort((i + 1) % 7),
      day: parseDay(date).getUTCDate(),
      today: date === today,
      entries: entries.filter((e) => e.date === date).sort((a, b) => (a.time < b.time ? -1 : 1)),
      planned: plansOn(plans, date, !!opts.withDone),
    };
  });
  const end = days[6]!.date;
  const s = parseDay(start);
  const e = parseDay(end);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  const range = { d1: s.getUTCDate(), m1: monthShort(s.getUTCMonth()), d2: e.getUTCDate(), m2: monthShort(e.getUTCMonth()) };
  const title = sameMonth ? t("{m2} {d1} to {d2}", range) : t("{m1} {d1} to {m2} {d2}", range);
  return { start, end, title, kw: isoWeek(start), count: days.reduce((n, d) => n + d.entries.length, 0), days };
}

/**
 * Month grid (Mo-first, whole weeks) around `anchor` with the entry count per day. Every cell also lists its entries
 * (earliest first) and, when `plans` are given, the tasks due that day (open first, then done) for the dot row.
 */
export function buildMonth<E extends { date: string; time?: string }>(entries: readonly E[], anchor: string, today: string, plans?: readonly WeekPlanIn[]) {
  const a = parseDay(anchor);
  const first = isoDay(new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)));
  const lastDay = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0)).getUTCDate();
  const start = weekStart(first);
  const lead = (parseDay(first).getTime() - parseDay(start).getTime()) / DAY_MS;
  const total = Math.ceil((lead + lastDay) / 7) * 7;
  const byDay = new Map<string, E[]>();
  for (const e of entries) {
    const l = byDay.get(e.date);
    if (l) l.push(e);
    else byDay.set(e.date, [e]);
  }
  return {
    title: `${monthName(a.getUTCMonth())} ${a.getUTCFullYear()}`,
    cells: Array.from({ length: total }, (_, i) => {
      const date = addDays(start, i);
      const items = [...(byDay.get(date) ?? [])].sort((x, y) => ((x.time ?? "") < (y.time ?? "") ? -1 : 1));
      return {
        date,
        day: parseDay(date).getUTCDate(),
        inMonth: date.slice(0, 7) === first.slice(0, 7),
        today: date === today,
        count: items.length,
        entries: items,
        planned: plans ? plansOn(plans, date, true) : [],
      };
    }),
  };
}

/* ----------------------------------------------------------------------------------------- hashtags */

/** Captures per day over the last `days` days up to `today` (oldest first), from the entries' own dates. */
export function sparkSeries(dates: readonly string[], today: string, days = 30): number[] {
  const from = addDays(today, -(days - 1));
  const out = new Array<number>(days).fill(0);
  for (const d of dates) {
    if (d < from || d > today) continue;
    const i = Math.round((parseDay(d).getTime() - parseDay(from).getTime()) / DAY_MS);
    if (i >= 0 && i < days) out[i]! += 1;
  }
  return out;
}

/** SVG path data (line and filled area) of a series in a w×h box; flat line for an empty series. */
export function sparkPath(series: readonly number[], w: number, h: number): { line: string; area: string; last: [number, number] } {
  const n = Math.max(series.length, 2);
  const max = Math.max(1, ...series);
  const pts = (series.length ? series : [0, 0]).map((v, i): [number, number] => [(i * w) / (n - 1), h - 2 - (v / max) * (h - 5)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return { line, area: `${line} L${w} ${h} L0 ${h} Z`, last: pts[pts.length - 1]! };
}

export interface TagRow {
  /** Full tag without "#", e.g. "ai/mcp" (root rows: "ai"). */
  tag: string;
  /** Last path segment ("mcp"). */
  name: string;
  count: number;
  series: number[];
  /** Object ids carrying or linked to the tag (up to 3 shown). */
  objects: string[];
}
export interface TagGroup extends TagRow {
  children: TagRow[];
}

interface Taggable {
  id: string;
  date: string;
  tags: readonly string[];
}

const bare = (t: string) => t.replace(/^#/, "").trim().toLowerCase();

/**
 * Hierarchical hashtag index (#pfad/teil): one group per first segment, children per full tag. Counts and the
 * 30-day series come from the entries' own dates; objects are those carrying the tag or linked to its entries.
 */
export function tagIndex(entries: readonly Taggable[], objects: readonly Taggable[], objectsOf: ReadonlyMap<string, readonly string[]>, today: string): TagGroup[] {
  const byTag = new Map<string, Taggable[]>();
  for (const e of entries) for (const t of new Set(e.tags.map(bare))) if (t) byTag.set(t, [...(byTag.get(t) ?? []), e]);
  const objTags = new Map<string, Set<string>>();
  for (const o of objects) for (const t of o.tags.map(bare)) if (t) (objTags.get(t) ?? objTags.set(t, new Set()).get(t)!).add(o.id);

  const objectsFor = (tags: string[], list: Taggable[]) => {
    const ids = new Set<string>();
    for (const t of tags) objTags.get(t)?.forEach((id) => ids.add(id));
    for (const e of list) objectsOf.get(e.id)?.forEach((id) => ids.add(id));
    return [...ids];
  };
  const roots = new Map<string, string[]>();
  for (const t of byTag.keys()) {
    const root = t.split("/")[0]!;
    roots.set(root, [...(roots.get(root) ?? []), t]);
  }
  const groups: TagGroup[] = [];
  for (const [root, tags] of roots) {
    const seen = new Map<string, Taggable>();
    for (const t of tags) for (const e of byTag.get(t)!) seen.set(e.id, e);
    const list = [...seen.values()];
    const children = tags
      .filter((t) => t !== root)
      .map((t): TagRow => {
        const l = byTag.get(t)!;
        return { tag: t, name: t.slice(root.length + 1), count: l.length, series: sparkSeries(l.map((e) => e.date), today), objects: objectsFor([t], l) };
      })
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    groups.push({ tag: root, name: root, count: list.length, series: sparkSeries(list.map((e) => e.date), today), objects: objectsFor(tags, list), children });
  }
  return groups.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Filters the index by a query (matches a group or any child; a matching group keeps all its children). */
export function filterTags(groups: readonly TagGroup[], query: string): TagGroup[] {
  const q = bare(query);
  if (!q) return [...groups];
  return groups.flatMap((g) => {
    if (g.tag.includes(q)) return [g];
    const kids = g.children.filter((c) => c.tag.includes(q));
    return kids.length ? [{ ...g, children: kids }] : [];
  });
}

/* ------------------------------------------------------------------------------------ type filters */

export interface TypeFilter {
  key: string;
  label: string;
  kinds: readonly string[];
}

/**
 * Curated chips of the dummy (Alle, Artikel, Video, Audio, Notizen, Meetings, Bücher, …) over registry types.
 * Labels are getters: they answer in the language of the moment they are read.
 */
const CURATED_FILTERS: readonly TypeFilter[] = [
  { key: "article", get label() { return t("Articles"); }, kinds: ["article", "bookmark"] },
  { key: "video", get label() { return t("Video"); }, kinds: ["video"] },
  { key: "audio", get label() { return t("Audio"); }, kinds: ["podcast"] },
  { key: "note", get label() { return t("Notes"); }, kinds: ["note", "daily_note"] },
  { key: "meeting", get label() { return t("Meetings"); }, kinds: ["meeting"] },
  { key: "book", get label() { return t("Books"); }, kinds: ["book", "pdf", "epub"] },
  { key: "ai", get label() { return t("AI Memories"); }, kinds: ["ai_chat"] },
  { key: "recipe", get label() { return t("Recipes"); }, kinds: ["recipe"] },
  { key: "object", get label() { return t("Objects"); }, kinds: DOMAIN_OBJECT_TYPES },
];

/**
 * Type chips of the filter bar, matched against registry types (knowledge_items.type, see registryTypeOf):
 * the curated chips, then one chip per other registry content type with its registry label.
 */
export const TYPE_FILTERS: readonly TypeFilter[] = [
  ...CURATED_FILTERS,
  ...CONTENT_TYPES.filter((type) => !CURATED_FILTERS.some((f) => f.kinds.includes(type))).map((type) => ({ key: type, get label() { return TYPE_REGISTRY[type].label; }, kinds: [type] })),
];

/** Chips with counts; only types present in the list (plus "Alle"). */
export function typeChips(kinds: readonly string[]): { key: string; label: string; count: number }[] {
  const chips = TYPE_FILTERS.map((f) => ({ key: f.key, label: f.label, count: kinds.filter((k) => f.kinds.includes(k)).length })).filter((c) => c.count > 0);
  return [{ key: "all", label: t("All"), count: kinds.length }, ...chips];
}

export function matchesType(kind: string, key: string): boolean {
  if (key === "all") return true;
  return TYPE_FILTERS.find((f) => f.key === key)?.kinds.includes(kind) ?? false;
}

export type SortKey = "newest" | "oldest" | "title";
export const SORT_LABEL: Record<SortKey, string> = {
  get newest() { return t("Newest"); },
  get oldest() { return t("Oldest"); },
  get title() { return t("Title A–Z"); },
};

export function sortEntries<T extends { date: string; time: string; title: string }>(list: readonly T[], key: SortKey): T[] {
  const out = [...list];
  if (key === "title") return out.sort((a, b) => a.title.localeCompare(b.title, intlLocale()));
  out.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : a.date + a.time > b.date + b.time ? -1 : 0));
  return key === "oldest" ? out.reverse() : out;
}
