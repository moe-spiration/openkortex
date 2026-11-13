import { NOTE_TYPES, OBJECT_ITEMS, TASKS, tagTone, type KnowledgeItem, type NoteSummary, type NoteType } from "@/lib/workspace-data";
import { domainOf, lengthOf, monogram, progressOf, statusOf, taskCountOf, type EntryStatus } from "@/lib/data/collections";
import { NOTE_COVER, OBJECTS, coverSrc, type DomainType } from "@/lib/mock/views";
import type { IconId } from "@/components/shell/icons";
import { typeDefinition } from "@kortex/db";
import { isUngroupedType } from "@/lib/spaces";
import { monthName, weekdayShort } from "@/lib/date/words";
import { objectOptionLabel } from "@/lib/objects/schema";
import { intlLocale, msg, t, tn, tx } from "@/i18n";

/*
 * One shape for everything the space views list: knowledge items (notes, meetings, ...) and the
 * domain objects of 70_Objects/. Server pages build entries, the client views only render them.
 */

export type EntryKind = NoteType | DomainType;

export interface EntryTone {
  bg: string;
  fg: string;
  dot: string;
}

export type EntryFacts = {
  /** One-line key metadata ("VP Engineering ＠ AutoCorp"). */
  line: string;
  /** Emphasised part of the line (value, role). */
  strong?: string;
  status?: { label: string; cls: string };
  /** 0..100, rendered as a progress bar. */
  progress?: number;
};

export interface ViewEntry {
  id: string;
  /** Note id handed to the shell's note drawer. */
  openId: string;
  kind: EntryKind;
  /** Registry type (knowledge_items.type) behind `kind`; filters and type chips match on it. */
  dbType?: string;
  isObject: boolean;
  typeLabel: string;
  /** Prototype icon for notes; objects use the ObjectBadge glyph. */
  icon?: IconId;
  /** Type registry icon (types without a prototype glyph, e.g. movie, receipt); wins over `icon`. */
  lucide?: string;
  tone: EntryTone;
  title: string;
  path: string;
  date: string;
  time: string;
  tags: { label: string; cls: string }[];
  tldr: string;
  /**
   * Own cover or medium extracted from the source; null when there is none. The type tile of the active
   * theme pack is resolved on the client (useCoverOf), because the pack is a per-user setting.
   */
  cover: string | null;
  facts?: EntryFacts;
  /* Card context (Tactile Craft v2). Every field is optional: what the data does not carry is left out. */
  /** Source domain from source_url / metadata.domain ("inkandswitch.com"). */
  domain?: string;
  /** Length: a media clock (badge on the cover) or "14 Min." / "530 Seiten" in the source line. */
  length?: { label: string; clock: boolean };
  /** Reading / listening progress 0..1 of a started medium (bar on the cover). */
  progress?: number;
  /** Pipeline status pill (live). */
  status?: EntryStatus;
  /** Action items done / total. */
  tasks?: [number, number];
  /** Linked domain objects (avatars). */
  objects?: EntryObject[];
  /** Starred (knowledge_items.is_favorite, G4). */
  favorite?: boolean;
}

export interface EntryObject {
  id: string;
  title: string;
  kind: DomainType;
  mono: string;
}

const tagCls = (label: string) => {
  const tone = tagTone(label);
  return tone === "ai" ? "" : `kx-pill--${tone}`;
};

const domainTone = (g: string): EntryTone => ({ bg: `var(--tag-${g}-bg)`, fg: `var(--tag-${g}-fg)`, dot: `var(--tag-${g}-dot)` });

/** Colours per domain object, mirroring the ObjectBadge tones of @kortex/ui. */
const OBJECT_TONE: Record<DomainType, EntryTone> = {
  project: domainTone("ai"),
  person: domainTone("auto"),
  organization: domainTone("auto"),
  concept: domainTone("strategy"),
  tool: {
    bg: "color-mix(in srgb, var(--accent-checkin) 12%, transparent)",
    fg: "var(--accent-checkin)",
    dot: "var(--accent-checkin)",
  },
  asset: domainTone("food"),
  goal: domainTone("health"),
};

/** English source texts: show them with `t(OBJECT_TYPE_LABEL[kind])`. */
export const OBJECT_TYPE_LABEL: Record<DomainType, string> = {
  project: msg("Project"),
  person: msg("Person"),
  organization: msg("Organization"),
  concept: msg("Concept"),
  tool: msg("Tool"),
  asset: msg("Asset"),
  goal: msg("Goal"),
};

const eur = (n: number) => n.toLocaleString(intlLocale()) + " €";
/** Status values as they are stored in the frontmatter (data, not translated). */

const STATUS_CLS: Record<string, string> = {
  Planning: "",
  "In Progress": "kx-status--progress",
  Review: "kx-status--ai",
  Done: "kx-status--done",
  Vermietet: "kx-status--done",
  Aktiv: "kx-status--done",
  "In Prüfung": "kx-status--ai",
};

export function objectFacts(o: (typeof OBJECTS)[number]): EntryFacts {
  const m = o.meta;
  switch (m.type) {
    case "person":
      return { line: `${m.role} ＠ ${m.org}`, strong: m.role };
    case "organization":
      return { line: `${objectOptionLabel(m.kind)} · ${m.industry} · ${tn(m.contacts, "{n} contact", "{n} contacts")}`, strong: objectOptionLabel(m.kind) };
    case "project":
      return { line: t("Due {date} · {pct} %", { date: m.due, pct: m.progress }), status: { label: m.status, cls: STATUS_CLS[m.status] ?? "" }, progress: m.progress };
    case "concept":
      return { line: t("{kind} · {n} links", { kind: m.kind, n: m.links }), strong: m.kind };
    case "tool":
      return { line: `${m.category} · ${m.version}`, strong: m.category, status: m.inStack ? { label: t("In the stack"), cls: "kx-status--done" } : undefined };
    case "asset":
      return { line: t("{kind} · value {value}", { kind: m.kind, value: eur(m.value) }), strong: eur(m.value), status: { label: objectOptionLabel(m.status), cls: STATUS_CLS[m.status] ?? "" } };
    case "goal":
      return { line: `${m.period} · ${m.progress} % · ${m.metric}`, strong: `${m.progress} %`, progress: m.progress };
  }
}

/** Objects an item links to or that link back to it (both directions, like the note's backlinks). */
export function linkedObjects(id: string, links: readonly string[]): EntryObject[] {
  return OBJECT_ITEMS.filter((o) => o.id !== id && (links.includes(o.id) || o.links.includes(id))).map((o) => ({
    id: o.id,
    title: o.title,
    kind: o.type as DomainType,
    mono: monogram(o.title),
  }));
}

type EntryContext = Pick<ViewEntry, "domain" | "length" | "progress" | "status" | "tasks" | "objects">;

/** Card context of an item from its real fields (live: source, metadata, reading state, status; both: tasks, links). */
export function itemContext(n: NoteSummary & Partial<KnowledgeItem>): EntryContext {
  const meta = n.metadata ?? {};
  const progress = progressOf(n.readingState);
  const own = n.actionItems?.length ? n.actionItems : TASKS.filter((task) => task.sourceId === n.id);
  const objects = linkedObjects(n.id, n.links ?? []);
  const metaDomain = typeof meta.domain === "string" && meta.domain ? meta.domain.replace(/^www\./, "") : undefined;
  const domain = domainOf(n.source?.url) ?? metaDomain;
  const length = lengthOf(meta, n.source?.pageCount);
  const status = statusOf(n.status, progress);
  const tasks = taskCountOf(own);
  const out: EntryContext = {};
  if (domain) out.domain = domain;
  if (length) out.length = length;
  if (progress !== undefined) out.progress = progress;
  if (status) out.status = status;
  if (tasks) out.tasks = tasks;
  if (objects.length) out.objects = objects;
  return out;
}

export function noteEntry(n: NoteSummary & Partial<KnowledgeItem>): ViewEntry {
  const ty = NOTE_TYPES[n.type];
  const cover = NOTE_COVER[n.id];
  // Types without a curated shell type (movie, receipt, prompt, ...) show their registry label and icon.
  const own = n.dbType && isUngroupedType(n.dbType) ? typeDefinition(n.dbType) : undefined;
  return {
    ...itemContext(n),
    id: n.id,
    openId: n.id,
    kind: n.type,
    ...(n.dbType ? { dbType: n.dbType } : {}),
    isObject: false,
    typeLabel: own?.label ?? ty.label,
    icon: ty.icon,
    ...(own ? { lucide: own.icon } : {}),
    tone: domainTone(ty.tone),
    title: n.title,
    path: n.path,
    date: n.date,
    time: n.time,
    tags: n.tags.map((label) => ({ label, cls: tagCls(label) })),
    tldr: n.tldr,
    // Mock notes with a bundled cover count as own covers; live items bring the extracted medium (cover_image_url).
    cover: cover ? coverSrc(cover) : ((n as { cover?: string | null }).cover ?? null),
    ...(n.favorite ? { favorite: true } : {}),
  };
}

type ObjectItem = (typeof OBJECT_ITEMS)[number];


const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const join = (...p: (string | undefined)[]) => p.filter(Boolean).join(" · ");

/** Key facts from the object's own metadata (frontmatter): what live data has when the card-only mock facts are missing. */
export function factsFromMetadata(type: DomainType, md: Record<string, unknown>): EntryFacts {
  switch (type) {
    case "person": {
      const role = str(md.role);
      const org = str(md.organization);
      return { line: role && org ? `${role} ＠ ${org}` : (role ?? org ?? t(OBJECT_TYPE_LABEL.person)), strong: role };
    }
    case "organization":
      return { line: join(str(md.org_type), str(md.industry)) || t(OBJECT_TYPE_LABEL.organization) };
    case "project": {
      const status = str(md.project_status);
      const due = str(md.target_date);
      return { line: join(due && t("Target {date}", { date: due })) || t(OBJECT_TYPE_LABEL.project), status: status ? { label: status, cls: STATUS_CLS[status] ?? "" } : undefined };
    }
    case "concept":
      return { line: str(md.category) ?? t(OBJECT_TYPE_LABEL.concept) };
    case "tool":
      return { line: join(str(md.tool_category), str(md.usage_status)) || t(OBJECT_TYPE_LABEL.tool) };
    case "asset": {
      const status = str(md.status);
      return { line: str(md.asset_type) ?? t(OBJECT_TYPE_LABEL.asset), status: status ? { label: status, cls: STATUS_CLS[status] ?? "" } : undefined };
    }
    case "goal": {
      const pct = typeof md.progress_pct === "number" ? md.progress_pct : undefined;
      return { line: join(str(md.goal_timeframe), pct !== undefined ? `${pct} %` : undefined, str(md.target_metric)) || t(OBJECT_TYPE_LABEL.goal), strong: pct !== undefined ? `${pct} %` : undefined, progress: pct };
    }
  }
}

/** Domain object of the workspace (live row or mock) as a view entry. Card-only mock facts win when the id is a mock object. */
export function objectEntry(o: ObjectItem): ViewEntry {
  const type = o.type as DomainType;
  const mock = OBJECTS.find((m) => m.id === o.id);
  return {
    ...itemContext(o),
    id: o.id,
    // The note drawer resolves domain objects itself (lib/mock/objects.ts maps them to knowledge items).
    openId: o.id,
    kind: type,
    isObject: true,
    typeLabel: OBJECT_TYPE_LABEL[type] ? t(OBJECT_TYPE_LABEL[type]) : type,
    tone: OBJECT_TONE[type] ?? OBJECT_TONE.concept,
    title: o.title,
    path: o.path,
    date: o.date,
    time: o.time,
    tags: o.tags.map((label) => ({ label, cls: tagCls(label) })),
    tldr: o.tldr,
    cover: o.cover || null,
    facts: mock ? objectFacts(mock) : factsFromMetadata(type, o.metadata),
    ...((o as { favorite?: boolean }).favorite ? { favorite: true } : {}),
  };
}

/** Evaluated per request: OBJECT_ITEMS is a live view of the installed workspace snapshot. */
export const objectEntries = (): ViewEntry[] => OBJECT_ITEMS.map(objectEntry);

export function sortNewest(list: ViewEntry[]): ViewEntry[] {
  return [...list].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
}

/* --------------------------------------------------------------- dates */

const WEEKDAYS = [msg("Sunday"), msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday")] as const;
/** Weekday name for `Date.getUTCDay()` (0 = Sunday): "Monday" / "Montag". */
export const weekdayName = (day: number): string => t(WEEKDAYS[day] ?? "");
/** Three-letter month without a dot for dense rows and chart ticks (0-based): "Oct" / "Okt". */
export function monthAbbr(month: number): string {
  const all = [tx("abbr3", "Jan"), tx("abbr3", "Feb"), tx("abbr3", "Mar"), tx("abbr3", "Apr"), tx("abbr3", "May"), tx("abbr3", "Jun"), tx("abbr3", "Jul"), tx("abbr3", "Aug"), tx("abbr3", "Sep"), tx("abbr3", "Oct"), tx("abbr3", "Nov"), tx("abbr3", "Dec")];
  return all[month] ?? "";
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Today, 09:05" / "Yesterday, 21:30" / "Tue, Oct 20, 16:00" (prototype dayOf + time). */
export function whenLabel(date: string, time: string, today: string): string {
  if (date === today) return t("Today, {time}", { time });
  if (date === addDays(today, -1)) return t("Yesterday, {time}", { time });
  const d = new Date(date + "T12:00:00Z");
  return t("{weekday}, {month} {day}, {time}", { weekday: weekdayShort(d.getUTCDay()), day: d.getUTCDate(), month: monthAbbr(d.getUTCMonth()), time });
}

export interface DayGroup {
  anchor: string;
  date: string;
  label: string;
  sub: string;
  items: ViewEntry[];
}

/** Timeline groups: one section per day, newest first, entries newest first (prototype `groups`). */
export function groupByDay(items: ViewEntry[], today: string): DayGroup[] {
  // One pass over the items (long lists: a filter per day was days x items).
  const byDate = new Map<string, ViewEntry[]>();
  for (const n of items) {
    const g = byDate.get(n.date);
    if (g) g.push(n);
    else byDate.set(n.date, [n]);
  }
  const dates = [...byDate.keys()].sort().reverse();
  return dates.map((ds) => {
    const d = new Date(ds + "T12:00:00Z");
    const its = byDate.get(ds)!.sort((a, b) => (a.time < b.time ? 1 : -1));
    const full = t("{weekday}, {month} {day}", { weekday: weekdayName(d.getUTCDay()), day: d.getUTCDate(), month: monthName(d.getUTCMonth()) });
    const recent = ds === today || ds === addDays(today, -1);
    return {
      anchor: "tl-" + ds,
      date: ds,
      label: ds === today ? t("Today") : ds === addDays(today, -1) ? t("Yesterday") : full,
      sub: (recent ? full + " · " : "") + tn(its.length, "{n} entry", "{n} entries"),
      items: its,
    };
  });
}
