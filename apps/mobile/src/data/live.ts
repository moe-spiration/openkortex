import type { ImageSourcePropType } from "react-native";
import { packCoverFor, type CoverSource } from "../theme/cover";
import type { TagTone } from "../theme/tokens";
import type { Entry, EntryKind, LifeArea } from "./mock";
import { keyPointsOf } from "../lib/markdown";
import { typeDefinition, typeIcon, typeLabel as registryLabel } from "@kortex/db/type-registry";
import { DEFAULT_AUTO_PLACE_THRESHOLD, placementDecision, placementOf } from "@kortex/db/gates";
import { isDomainObjectType } from "@kortex/db/domain";
import { byLocale, msg, t } from "../i18n";

/*
 * Live data → the shapes the screens already render (Entry, LifeArea, …). Pure functions, so the
 * mapping is tested without React Native; artwork for items without a cover comes in as `art`.
 */

export type Art = (key: string) => ImageSourcePropType;

/** Columns the app reads from kortex.knowledge_items. */
export const ITEM_COLUMNS =
  "id,type,title,summary,content_md,tags,status,folder_path,cover_image_url,source_url,metadata,entities,is_favorite,is_pinned,is_manual_placement,remind_at,created_at,updated_at";

export interface ItemRow {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  content_md: string | null;
  tags: string[] | null;
  status: string;
  folder_path: string;
  cover_image_url: string | null;
  source_url?: string | null;
  metadata: Record<string, unknown> | null;
  entities: string[] | null;
  is_favorite?: boolean | null;
  /** "Markiert" (swipe action in Heute verarbeitet). */
  is_pinned?: boolean | null;
  /** Reminder / snooze instant (ISO); due once it passes. */
  remind_at?: string | null;
  /** Placed by the user: the organizer keeps it, never in the review. */
  is_manual_placement?: boolean | null;
  created_at: string;
  updated_at: string;
}

const KIND_OF: Record<string, EntryKind> = {
  note: "note",
  daily_note: "note",
  voice: "note",
  image: "note",
  meeting: "meeting",
  article: "read",
  bookmark: "read",
  pdf: "read",
  epub: "read",
  book: "read",
  video: "video",
  social: "video",
  podcast: "video",
  recipe: "food",
  ai_memory: "ai",
  chat: "ai",
  ai_chat: "ai",
  digest: "ai",
  movie: "video",
  receipt: "read",
  prompt: "ai",
  snippet: "ai",
  session: "read",
  product: "object",
  place: "object",
  inspiration: "note",
  email: "read",
  person: "object",
  project: "object",
  organization: "object",
  concept: "object",
  tool: "object",
  asset: "object",
  goal: "object",
};

/** Old type values that are not in the registry any more (rows written before it). */
const LEGACY_LABEL: Record<string, string> = { chat: msg("AI chat"), ai_memory: msg("AI Memory") };

export const kindOf = (type: string): EntryKind => KIND_OF[type] ?? "note";
/** Label of a knowledge_items.type: the type registry (@kortex/db) is the source; unknown types get a readable fallback. */
export const typeLabel = (type: string): string =>
  LEGACY_LABEL[type] ? t(LEGACY_LABEL[type]) : typeDefinition(type) ? registryLabel(type) : (type.charAt(0).toUpperCase() + type.slice(1)).replace(/_/g, " ");
/** Lucide icon name of a type, from the registry. */
export const typeIconOf = (type: string): string => typeIcon(type);

const KIND_ART: Record<EntryKind, string> = { note: "journal", meeting: "meeting", read: "book", ai: "ribbons", food: "salmon", video: "podcast", object: "desk" };
export const artKey = (kind: EntryKind) => KIND_ART[kind];

const WEEKDAY = [msg("Sun"), msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat")];
/** Day and month without the year: "12.10." in German, "10/12" in English. */
const dayMonth = (day: string, month: string) => byLocale({ en: `${month}/${day}`, de: `${day}.${month}.` });
const pad = (n: number) => String(n).padStart(2, "0");
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole local days between `iso` and `now` (0 = today). */
export function daysAgo(iso: string, now: Date): number {
  return Math.max(0, Math.round((dayStart(now) - dayStart(new Date(iso))) / 86_400_000));
}

/** "Today" / "Yesterday" / weekday within a week / day and month */
export function shortDay(iso: string, now: Date): string {
  const d = new Date(iso);
  const n = daysAgo(iso, now);
  if (n === 0) return t("Today");
  if (n === 1) return t("Yesterday");
  if (n < 7) return t(WEEKDAY[d.getDay()]!);
  return dayMonth(pad(d.getDate()), pad(d.getMonth() + 1));
}

export const clockOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Markdown → one plain paragraph. */
export function plain(md: string | null | undefined, max = 220): string {
  const s = (md ?? "")
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Key points: metadata.key_points / takeaways (podcast, AI chat adapters), else the bullets of a
 * "Kernpunkte / Kernaussagen / Key Takeaways" section. Never random bullets of a clipped page.
 */
export function pointsOf(row: Pick<ItemRow, "metadata" | "content_md">): string[] {
  for (const key of ["key_points", "takeaways"]) {
    const kp = row.metadata?.[key];
    if (Array.isArray(kp)) {
      const list = kp.filter((x): x is string => typeof x === "string" && !!x.trim());
      if (list.length) return list.slice(0, 6);
    }
  }
  return keyPointsOf(row.content_md ?? "").map((p) => plain(p, 160));
}

/** Why processing failed (metadata.ingest.error), shown in the detail sheet. */
export function ingestError(row: Pick<ItemRow, "status" | "metadata">): string | null {
  if (row.status !== "error") return null;
  const ing = row.metadata?.ingest as { error?: unknown } | undefined;
  const reason = typeof ing?.error === "string" ? ing.error : "";
  if (/content too short|could not extract/i.test(reason)) return t("The page could not be read (blocked or JavaScript only). The link is saved.");
  if (/ytInitialPlayerResponse/i.test(reason)) return t("The video could not be read. The link is saved.");
  return reason ? t("Processing failed: {reason}", { reason: reason.slice(0, 160) }) : t("Processing failed.");
}

/** Domain object: its scalar frontmatter properties as "Key: Wert" lines (max 6). */
export function propsOf(meta: Record<string, unknown> | null): string[] {
  return Object.entries(meta ?? {})
    .filter(([k, v]) => !k.startsWith("_") && (typeof v === "string" || typeof v === "number" || typeof v === "boolean") && String(v).trim())
    .slice(0, 6)
    .map(([k, v]) => `${k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}: ${String(v)}`);
}

const hashtag = (t: string) => (t.startsWith("#") ? t : `#${t}`);

export function itemToEntry(row: ItemRow, now: Date, art: Art, opened = 0): Entry {
  const kind = kindOf(row.type);
  const time = clockOf(row.created_at);
  const whenShort = shortDay(row.created_at, now);
  const folderTag = row.folder_path.split("/").pop()?.replace(/^\d+_/, "").toLowerCase() || "inbox";
  return {
    id: row.id,
    kind,
    type: typeLabel(row.type),
    when: `${whenShort}, ${time}`,
    img: row.cover_image_url ? { uri: row.cover_image_url } : packCoverFor(row.type),
    title: row.title || t("Untitled"),
    tag: row.tags?.[0] ? hashtag(row.tags[0]) : `#${folderTag}`,
    tldr: plain(row.summary) || plain(row.content_md) || t("No summary yet."),
    points: kind === "object" ? propsOf(row.metadata) : pointsOf(row),
    day: daysAgo(row.created_at, now),
    who: (row.entities ?? []).slice(0, 4),
    opened,
    time,
    // Sort key of the prototype: lower = newer.
    ts: -new Date(row.created_at).getTime() / 60_000,
    whenShort,
    fav: row.is_favorite === true,
    pinned: row.is_pinned === true,
    remindAt: row.remind_at ?? null,
    itemType: row.type,
    meta: row.metadata ?? {},
    read: isRead(row),
    folder: row.folder_path,
    content: row.content_md ?? "",
    url: row.source_url ?? null,
    error: ingestError(row),
  };
}

/** Items → entries; `opened` ranks by updated_at (most recently touched first). */
export function itemsToEntries(rows: readonly ItemRow[], now: Date, art: Art): Entry[] {
  const rank = new Map([...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((r, i) => [r.id, i]));
  return rows.map((r) => itemToEntry(r, now, art, rank.get(r.id) ?? 0));
}

/** Tone of a hashtag by its first segment (same domains as the web sidebar). */
export function toneOfTag(tag: string): TagTone {
  const head = tag.replace(/^#/, "").split("/")[0]!.toLowerCase();
  if (/^(fitness|health|sport|hyrox|run)/.test(head)) return "health";
  if (/^(rezepte?|food|kochen|recipe)/.test(head)) return "food";
  if (/^(finance|finanzen|real-estate|immobilien|money)/.test(head)) return "finance";
  if (/^(strategy|mba|career|karriere|leadership)/.test(head)) return "strategy";
  if (/^(automotive|auto|car)/.test(head)) return "auto";
  return "ai";
}

// --- Inbox ---------------------------------------------------------------------------------------

export interface InboxJob {
  id: string;
  title: string;
  img: CoverSource;
  step: string;
  /** 0..100; processing reports no real progress, so this is a time-based estimate. */
  pct: number;
  failed: boolean;
}

export interface Processed {
  id: string;
  title: string;
  space: string;
  /** Marked as read (metadata.read_at). */
  read?: boolean;
  /** Marked (is_pinned). */
  pinned?: boolean;
}

/** "Gelesen" lives in metadata.read_at (portable: it lands in the frontmatter, no extra column). */
export const isRead = (row: Pick<ItemRow, "metadata">) => typeof row.metadata?.read_at === "string";

const STEP: Record<string, string> = {
  inbox: msg("Waiting to be processed"),
  processing: msg("AI is summarizing and tagging"),
  error: msg("Error while processing"),
};

/** Space name of a folder path ("30_Clippings/Web" → "Clippings"). */
export const spaceOf = (folder: string) => folder.split("/")[0]!.replace(/^\d+_/, "").replace(/_/g, " ") || "Inbox";

/** A capture the Gardener placed and the user should check ("Einsortiert, bitte kurz prüfen", like the web Inbox). */
export interface ReviewRow {
  id: string;
  title: string;
  /** Proposed folder (metadata.placement.folder_path, else where the item is now). */
  target: string;
  tags: string[];
}

/** Days a capture stays in the review (web: REVIEW_WINDOW_DAYS). */
export const REVIEW_WINDOW_DAYS = 14;

/** Same rule as the web's isReviewCandidate: processed, no object, no daily note, placement "review", recent. */
export function isReviewCandidate(r: ItemRow, now: Date, threshold = DEFAULT_AUTO_PLACE_THRESHOLD): boolean {
  if (r.status !== "processed" || isDomainObjectType(r.type)) return false;
  if (r.folder_path.startsWith("10_Notes/Daily")) return false;
  if (placementDecision(placementOf(r.metadata), r.is_manual_placement === true, threshold) !== "review") return false;
  const age = daysAgo(r.created_at, now);
  return age >= 0 && age <= REVIEW_WINDOW_DAYS;
}

/** Still being processed (or failed), what waits for a check, and what was finished today. */
export function inboxOf(rows: readonly ItemRow[], now: Date, threshold = DEFAULT_AUTO_PLACE_THRESHOLD): { jobs: InboxJob[]; processed: Processed[]; review: ReviewRow[] } {
  const jobs: InboxJob[] = [];
  const processed: Processed[] = [];
  const review: ReviewRow[] = [];
  for (const r of rows) {
    if (isReviewCandidate(r, now, threshold)) {
      review.push({ id: r.id, title: r.title || t("Untitled"), target: placementOf(r.metadata)?.folderPath || r.folder_path, tags: r.tags ?? [] });
      continue;
    }
    const pending = r.status === "processing" || r.status === "error" || (r.status === "inbox" && !r.summary && daysAgo(r.created_at, now) <= 1);
    if (pending) {
      const ageSec = (now.getTime() - new Date(r.created_at).getTime()) / 1000;
      jobs.push({
        id: r.id,
        title: r.title || t("Untitled"),
        img: r.cover_image_url ? { uri: r.cover_image_url } : packCoverFor(r.type),
        step: t(STEP[r.status] ?? STEP.processing!),
        pct: r.status === "error" ? 100 : Math.min(92, Math.round(10 + ageSec / 2)),
        failed: r.status === "error",
      });
    } else if (daysAgo(r.updated_at, now) === 0) {
      processed.push({ id: r.id, title: r.title || t("Untitled"), space: spaceOf(r.folder_path), read: isRead(r), pinned: r.is_pinned === true });
    }
  }
  return { jobs, processed, review };
}

// --- Life ----------------------------------------------------------------------------------------

/** Subset of the web's LifeAreaDetail that the phone renders (apps/web/src/lib/mock/life.ts). */
export interface LiveLifeArea {
  key: string;
  name: string;
  tone: TagTone;
  img: string;
  score: number;
  vision: string;
  goals: { t: string; pct: number }[];
  empty?: boolean;
  active?: boolean;
}

export interface LiveLife {
  areas: LiveLifeArea[];
  visions: Record<string, string>;
}

const AREA_ART: Record<string, string> = { health: "runner", career: "skyline", finance: "stones", ventures: "loft", relations: "dinner", growth: "journal" };

export function lifeToAreas(life: LiveLife, art: Art): LifeArea[] {
  return life.areas
    .filter((a) => a.active !== false)
    .map((a) => ({
      key: a.key,
      name: a.name,
      tone: a.tone,
      img: art(AREA_ART[a.key] ?? a.img),
      score: a.score,
      vision: life.visions[a.key] ?? a.vision ?? "",
      goals: a.goals.map((g) => [g.t, g.pct] as [string, number]),
    }));
}

// --- Home ----------------------------------------------------------------------------------------

/** HomeBackInItem of apps/web/src/server/home/types.ts. */
export interface LiveBackIn {
  id: string;
  type: string;
  title: string;
  meta: string;
  img: string | null;
  pct: number | null;
}

/** The rest of HomeData (apps/web/src/server/home/types.ts) the phone renders. */
export interface LiveHome {
  archive: { id: string; title: string; quote: string; createdAt: string; yearAgo: boolean } | null;
  flashcards: { itemId: string; deck: string; cards: [string, string][] } | null;
  fitsToday: { id: string; type: string; title: string; text: string; img: string | null; seed: string } | null;
  meeting: { id: string; title: string; people: string[]; coaching: string | null; startedAt: string | null } | null;
}

export const emptyHome = (): LiveHome => ({ archive: null, flashcards: null, fitsToday: null, meeting: null });

export function homeOf(raw: Partial<LiveHome> | null | undefined): LiveHome {
  return {
    archive: raw?.archive ?? null,
    flashcards: raw?.flashcards && raw.flashcards.cards?.length ? raw.flashcards : null,
    fitsToday: raw?.fitsToday ?? null,
    meeting: raw?.meeting ?? null,
  };
}

export interface JumpItem {
  id: string;
  title: string;
  meta: string;
  img: CoverSource;
  pct: number;
}

export function backInToJump(items: readonly LiveBackIn[]): JumpItem[] {
  return items.map((b) => ({
    id: b.id,
    title: b.title,
    meta: b.meta,
    img: b.img ? { uri: b.img } : packCoverFor(b.type),
    pct: b.pct ?? 0,
  }));
}

// --- Tasks ---------------------------------------------------------------------------------------

export const TASK_COLUMNS = "id,title,status,priority,due_date,source_item_id,created_at,project_item_id,timeframe,context,exported_at,external_ref,assignee,description,completed_at";

export interface TaskRow {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  source_item_id: string | null;
  created_at: string;
  /** Linked project / goal (knowledge_items.id). */
  project_item_id?: string | null;
  /** "today" | "this_week" | "later" | YYYY-MM-DD. */
  timeframe?: string | null;
  context?: string | null;
  /** Set once the task was handed to another tool ("überführt"). */
  exported_at?: string | null;
  external_ref?: string | null;
  /** "Agent" while the agent works on it (status board). */
  assignee?: string | null;
  /** "manual" marks a task typed by hand (not an AI suggestion). */
  description?: string | null;
  completed_at?: string | null;
}

/** "Today", "Tomorrow", "overdue", or the date; null without due date. */
export function dueLabel(due: string | null, now: Date): string | null {
  if (!due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d = new Date(`${due.slice(0, 10)}T00:00:00`).getTime();
  const days = Math.round((d - today) / 86_400_000);
  if (days < 0) return t("overdue");
  if (days === 0) return t("Today");
  if (days === 1) return t("Tomorrow");
  return dayMonth(due.slice(8, 10), due.slice(5, 7));
}

const PRIO = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

/** Open tasks first by due date (none last), then priority. */
export function sortTasks(tasks: readonly TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => {
    const done = Number(a.status === "done") - Number(b.status === "done");
    if (done) return done;
    const da = a.due_date ?? "9999";
    const db = b.due_date ?? "9999";
    if (da !== db) return da.localeCompare(db);
    return PRIO[a.priority] - PRIO[b.priority];
  });
}

/** Top-level spaces a long-press "Move" offers (vault layout of md-sync); labels are English sources, shown with `t(label)`. */
export const SPACES: [folder: string, label: string][] = [
  ["10_Notes", "Notes"],
  ["20_Meetings", "Meetings"],
  ["30_Clippings", "Clippings"],
  ["40_AI_Memories", "AI Memories"],
  ["50_Recipes", msg("Recipes")],
  ["60_Documents", msg("Documents")],
];

/**
 * "Heute fällig" (S11, mirrors the web Home): entries whose reminder has come, i.e. remind_at up to the end of
 * today (phone time) or overdue, oldest first. No reminder is never due.
 */
export function dueReminders<E extends { remindAt?: string | null }>(entries: readonly E[], now: Date): E[] {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const ms = (e: E) => Date.parse(e.remindAt ?? "");
  return entries.filter((e) => !!e.remindAt && ms(e) <= end.getTime()).sort((a, b) => ms(a) - ms(b));
}
