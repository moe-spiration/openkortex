import { msg, t } from "@/i18n";
import type { Row } from "@kortex/db";
import { currentStreak } from "@kortex/db/daily";
import { isDomainObjectType } from "@kortex/db/domain";
import type {
  ActionItem as TaskItem,
  InboxKind,
  InboxProposal,
  InboxTarget,
  TaskPriority,
  TaskSourceKind,
} from "@/lib/mock/views";
import type { ItemType, KnowledgeItem, VaultFolder } from "@/lib/mock/types";
import { DEFAULT_AUTO_PLACE_THRESHOLD, placementDecision } from "@/lib/placement";
import { localDateTime } from "./dates";

/*
 * Pure mapping for the live Tasks, Inbox review and Journal views (WP-B2). No I/O; unit-tested.
 */

export type ActionRow = Pick<
  Row<"action_items">,
  | "id"
  | "title"
  | "status"
  | "priority"
  | "due_date"
  | "assignee"
  | "source_item_id"
  | "source_timestamp_sec"
  | "created_at"
  | "description"
> &
  Partial<
    Pick<
      Row<"action_items">,
      "project_item_id" | "timeframe" | "context" | "exported_at" | "external_ref"
    >
  >;

const SOURCE_KIND: Partial<Record<ItemType, TaskSourceKind>> = {
  meeting: "meeting",
  note: "note",
  article: "article",
  ai: "ai",
  video: "voice",
  podcast: "voice",
};

const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

/**
 * action_items row → task of the Tasks hub. `due` is the local day of due_date ("" = no date),
 * `dueTime` only when the due date carries a time other than midnight. Tasks extracted by the
 * pipeline (`description` starts with "ai:" or a source item without a manual marker) count as AI.
 */
export function toTask(
  row: ActionRow,
  source: KnowledgeItem | undefined,
  timeZone: string,
): TaskItem {
  const due = row.due_date ? localDateTime(row.due_date, timeZone) : null;
  const sourceType = source?.type;
  return {
    id: row.id,
    title: row.title,
    tag: source?.tags[0] ?? "",
    due: due?.date ?? "",
    ...(due && due.time !== "00:00" ? { dueTime: due.time } : {}),
    priority: PRIORITIES.includes(row.priority as TaskPriority)
      ? (row.priority as TaskPriority)
      : "medium",
    done: row.status === "done",
    ai: !!row.source_item_id && row.description !== MANUAL_TASK_MARK,
    ...(row.status === "in_progress" ? { accepted: true } : {}),
    assignee: row.assignee ?? "Me",
    sourceId: row.source_item_id ?? "",
    sourceKind:
      (sourceType && !isDomainObjectType(sourceType) && SOURCE_KIND[sourceType]) || "note",
    ...(row.source_timestamp_sec != null ? { sourceSec: row.source_timestamp_sec } : {}),
    ...(row.project_item_id ? { projectId: row.project_item_id } : {}),
    ...(row.timeframe ? { timeframe: row.timeframe } : {}),
    ...(row.context ? { context: row.context } : {}),
    ...(row.exported_at ? { exportedAt: row.exported_at } : {}),
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
  };
}

/** `description` of tasks the user created by hand (Tasks hub, note checklist sync). */
export const MANUAL_TASK_MARK = "manual";

// --- Inbox review ---------------------------------------------------------------------------------

const KIND: Partial<Record<ItemType, InboxKind>> = { video: "video", podcast: "video", ai: "ai" };

const SOURCE_LABEL: Partial<Record<ItemType, string>> = {
  note: msg("Note"),
  meeting: msg("Meeting"),
  article: msg("Article"),
  book: msg("Document"),
  video: msg("Video"),
  podcast: msg("Podcast"),
  ai: msg("AI chat"),
  recipe: msg("Recipe"),
};

/** How many days back the review queue looks. */
export const REVIEW_WINDOW_DAYS = 14;

/**
 * Items waiting for "Übernehmen": processed, captured within the review window, and either less
 * sure than the user's auto-place threshold or flagged with "Prüfen" (lib/placement.ts). Everything
 * else is filed silently (zero-setup). Confirming (moveItem with manual=true) takes an item out of
 * the queue. Domain objects and daily notes are never reviewed.
 */
export function isReviewCandidate(
  item: KnowledgeItem,
  today: string,
  threshold: number = DEFAULT_AUTO_PLACE_THRESHOLD,
  windowDays = REVIEW_WINDOW_DAYS,
): boolean {
  if (item.status !== "processed" || isDomainObjectType(item.type)) return false;
  if (item.path.startsWith("10_Notes/Daily/")) return false;
  if (placementDecision(item.placement, item.manualPlacement, threshold) !== "review") return false;
  const age = (Date.parse(today + "T12:00:00Z") - Date.parse(item.date + "T12:00:00Z")) / 864e5;
  return age >= 0 && age <= windowDays;
}

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/") || "00_Inbox";

export function toProposal(
  item: KnowledgeItem,
  titleById: (id: string) => string | undefined,
): InboxProposal {
  const host = (() => {
    try {
      return item.source?.url ? new URL(item.source.url).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();
  const source = isDomainObjectType(item.type) ? undefined : SOURCE_LABEL[item.type];
  const label = isDomainObjectType(item.type) ? t("Object") : source ? t(source) : t("Entry");
  return {
    id: item.id,
    itemId: item.id,
    kind: (!isDomainObjectType(item.type) && KIND[item.type]) || "image",
    title: item.title,
    source: [label, host ?? item.source?.fileName ?? null].filter(Boolean).join(" · "),
    summary: item.tldr,
    cover: "ribbons",
    ...(item.cover ? { coverUrl: item.cover } : {}),
    // md-sync keeps an unsure vault capture in 00_Inbox and only proposes the folder (metadata.placement).
    target: item.placement?.folderPath || folderOf(item.path),
    tags: item.tags,
    links: item.links.map(titleById).filter((t): t is string => !!t),
  };
}

const TOP_ICON: Record<string, InboxTarget["icon"]> = {
  "10_Notes": "note",
  "20_Meetings": "meeting",
  "30_Clippings": "article",
  "40_AI_Memories": "ai",
  "50_Recipes": "recipe",
  "60_Documents": "book",
};

/** Vault folders as review targets ("Ziel ändern"): every folder except Inbox, Daily, Objects and Digests. */
export function inboxTargets(tree: readonly VaultFolder[]): InboxTarget[] {
  return tree
    .filter(
      (f) => !/^(00_Inbox|70_Objects|90_Digests)(\/|$)/.test(f.path) && f.path !== "10_Notes/Daily",
    )
    .map((f) => ({
      path: f.path,
      label: f.path.split("/").join(" › "),
      icon: TOP_ICON[f.path.split("/")[0]!] ?? "note",
    }));
}

// --- Journal ------------------------------------------------------------------------------------------

export interface DailyNoteRef {
  id: string;
  /** YYYY-MM-DD */
  date: string;
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/**
 * Consecutive days with a daily note, ending today (or yesterday when today has none yet).
 * W6/A-08: the one shared rule, `@kortex/db/daily` currentStreak (Home, Journal, Insights, mobile).
 */
export function dailyStreak(dates: Iterable<string>, today: string): number {
  return currentStreak(dates, today);
}

/** Mon..Sun of the current week: "is-done" with a daily note, "is-today", "" otherwise. */
export function weekStrip(dates: Iterable<string>, today: string): string[] {
  const set = new Set(dates);
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - dow);
    return set.has(d) ? "is-done" : d === today ? "is-today" : "";
  });
}

/** 84 cells (12 weeks, oldest first) as percent of the busiest day; 0 = nothing captured. */
export function activityHeat(
  countByDay: Record<string, number>,
  today: string,
  days = 84,
): number[] {
  const counts = Array.from(
    { length: days },
    (_, i) => countByDay[addDays(today, i - days + 1)] ?? 0,
  );
  const max = Math.max(1, ...counts);
  return counts.map((c) => (c ? Math.max(20, Math.round((c / max) * 100)) : 0));
}

export { addDays as addIsoDays };
