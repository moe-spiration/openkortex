import { PRODUCT_NAME, t } from "@/i18n";
import {
  isDomainObjectType,
  type DomainObjectType,
  type KnowledgeItemType,
  type Row,
} from "@kortex/db";
import type { User } from "@supabase/supabase-js";
import { validateMetadata } from "@/lib/objects/schema";
import { placementOf } from "@/lib/placement";
import { parseWatch } from "@/lib/radar";
import { typedMetadata } from "@/lib/typed/fields";
import type {
  ActionItem,
  InboxJob,
  ItemSource,
  ItemType,
  KnowledgeItem,
  NoteType,
  ObjectHub,
  Profile,
  VaultFolder,
} from "@/lib/mock/types";

/*
 * Pure mapping between kortex.* rows and the shapes the shell renders (lib/mock/types.ts).
 * No I/O here, so it is unit-tested without a database.
 */

export type ItemRow = Row<"knowledge_items">;
export type FolderRow = Row<"folders">;
export type ActionRow = Row<"action_items">;

/** Content type in the shell for a DB type (the shell knows 8 content types + 7 objects). */
const UI_TYPE: Record<Exclude<KnowledgeItemType, DomainObjectType>, NoteType> = {
  note: "note",
  daily_note: "note",
  article: "article",
  bookmark: "article",
  email: "article",
  social: "video",
  meeting: "meeting",
  video: "video",
  podcast: "podcast",
  recipe: "recipe",
  ai_chat: "ai",
  pdf: "book",
  epub: "book",
  image: "note",
  voice: "note",
  digest: "note",
  // Typed items (type registry): the shell type only picks the base glyph/tone. Spaces, filter chips, labels and
  // icons in lists, and the editable metadata use the registry type (KnowledgeItem.dbType, lib/spaces.ts).
  movie: "video",
  book: "book",
  product: "note",
  place: "note",
  snippet: "note",
  inspiration: "note",
  receipt: "note",
  prompt: "note",
  session: "note",
};

export function uiType(dbType: string): ItemType {
  if (isDomainObjectType(dbType)) return dbType;
  return UI_TYPE[dbType as keyof typeof UI_TYPE] ?? "note";
}

/** DB type for a shell content type; `previous` wins when it maps back to the same shell type. */
export function dbTypeFor(ui: ItemType, previous?: string | null): KnowledgeItemType {
  if (isDomainObjectType(ui)) return ui;
  if (previous && !isDomainObjectType(previous) && uiType(previous) === ui)
    return previous as KnowledgeItemType;
  const map: Record<NoteType, KnowledgeItemType> = {
    note: "note",
    meeting: "meeting",
    article: "article",
    book: "pdf",
    video: "video",
    podcast: "podcast",
    ai: "ai_chat",
    recipe: "recipe",
  };
  return map[ui];
}

/** Shell hashtag label (`#ai/mcp`) for a stored tag (`ai/mcp` or `#ai/mcp`). */
export const tagLabel = (tag: string): string => `#${tag.trim().replace(/^#+/, "")}`;
/** Stored form of a hashtag label: without the leading `#`. */
export const tagName = (label: string): string => label.trim().replace(/^#+/, "");

export { localDateTime } from "./dates";
import { localDateTime } from "./dates";

/** Vault path of an item: `<folder_path>/<slug>.md` (md-sync's file name). */
export const itemPath = (row: Pick<ItemRow, "folder_path" | "slug">): string =>
  `${row.folder_path}/${row.slug}.md`;

/** `[[Title]]`, `[[Title|alias]]` and `![[Title]]` targets in a Markdown body. */
export function wikiLinkTitles(md: string): string[] {
  return [...md.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)]
    .map((m) => m[1]!.trim())
    .filter(Boolean);
}

const mmss = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export function toActionItem(
  row: Pick<ActionRow, "id" | "title" | "status" | "source_timestamp_sec">,
): ActionItem {
  return {
    id: row.id,
    text: row.title,
    done: row.status === "done",
    ...(row.source_timestamp_sec != null ? { timestamp: mmss(row.source_timestamp_sec) } : {}),
  };
}

const firstSentence = (md: string): string => {
  const text = md
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^#.*$/gm, "")
    .replace(/[*_`>#[\]!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
};

/**
 * Metadata the shell may edit, by registry type: an object's domain fields, a typed item's registry schema fields
 * (status, rating, isbn, ...). Ingest/AI bookkeeping stays in the DB.
 */
export function editableMetadata(dbType: string, metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  if (isDomainObjectType(dbType))
    return validateMetadata(dbType, metadata as Record<string, unknown>).metadata;
  return typedMetadata(dbType, metadata as Record<string, unknown>);
}

export interface ItemContext {
  timeZone: string;
  /** Lowercased title -> id, for [[Wiki-Links]]. */
  idByTitle: Map<string, string>;
  /** All loaded item ids (related_item_ids pointing elsewhere are dropped). */
  ids: Set<string>;
  actionsBySource: Map<string, ActionItem[]>;
}

export function toKnowledgeItem(row: ItemRow, ctx: ItemContext): KnowledgeItem {
  const type = uiType(row.type);
  const { date, time } = localDateTime(row.created_at, ctx.timeZone);
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const linked = wikiLinkTitles(row.content_md)
    .map((t) => ctx.idByTitle.get(t.toLowerCase()))
    .filter((id): id is string => !!id && id !== row.id);
  const related = (row.related_item_ids ?? []).filter((id) => ctx.ids.has(id) && id !== row.id);
  return {
    id: row.id,
    type,
    dbType: row.type,
    title: row.title,
    path: itemPath(row),
    date: row.type === "daily_note" && typeof meta.date === "string" ? meta.date : date,
    time,
    tags: (row.tags ?? []).map(tagLabel),
    tldr: row.summary?.trim() || firstSentence(row.content_md),
    links: [...new Set([...related, ...linked])],
    contentMd: row.content_md,
    cover: row.cover_image_url ?? null,
    icon: row.icon ?? null,
    favorite: row.is_favorite === true,
    remindAt: row.remind_at ?? null,
    watch: parseWatch(meta),
    actionItems: ctx.actionsBySource.get(row.id) ?? [],
    ...((row.type === "pdf" || row.type === "epub") && row.file_storage_path
      ? { reader: true }
      : {}),
    metadata: editableMetadata(row.type, meta),
    manualPlacement: row.is_manual_placement ?? false,
    folderSuggestion: null,
    status: row.status as KnowledgeItem["status"],
    placement: placementOf(meta),
    updatedAt: row.updated_at,
    source: itemSource(row, meta),
    ...(row.type === "pdf" || row.type === "epub"
      ? { readingState: (row.reading_state as Record<string, unknown> | null) ?? null }
      : {}),
  };
}

const fileFormat = (mime: string | null, path: string): "pdf" | "epub" | "other" => {
  const p = path.toLowerCase();
  if (mime === "application/pdf" || p.endsWith(".pdf")) return "pdf";
  if (mime === "application/epub+zip" || p.endsWith(".epub")) return "epub";
  return "other";
};

/** source_url, stored original (file_storage_path + mime/size) and the PDF page count. */
export function itemSource(
  row: Pick<ItemRow, "source_url" | "file_storage_path" | "file_mime_type" | "file_size_bytes">,
  meta: Record<string, unknown>,
): ItemSource {
  const pageCount = typeof meta.page_count === "number" ? meta.page_count : null;
  const fileName = typeof meta.original_file_name === "string" ? meta.original_file_name : null;
  return {
    url: row.source_url ?? null,
    ...(row.file_storage_path
      ? {
          file: {
            path: row.file_storage_path,
            mime: row.file_mime_type ?? null,
            format: fileFormat(row.file_mime_type ?? null, row.file_storage_path),
            sizeBytes: row.file_size_bytes ?? null,
          },
        }
      : {}),
    ...(pageCount !== null ? { pageCount } : {}),
    ...(fileName ? { fileName } : {}),
  };
}

/** Folder tree in display order (depth-first, sort_order then name), ids are folder uuids. */
export function buildVaultTree(
  rows: readonly Pick<FolderRow, "id" | "parent_id" | "name" | "folder_path" | "sort_order">[],
): VaultFolder[] {
  const children = new Map<string | null, (typeof rows)[number][]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const parent = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(r);
    children.set(parent, list);
  }
  const out: VaultFolder[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = (children.get(parent) ?? []).sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
    );
    for (const f of list) {
      const kids = children.get(f.id)?.length ?? 0;
      out.push({
        id: f.id,
        name: f.name,
        path: f.folder_path,
        depth,
        ...(parent ? { parent } : {}),
        ...(kids ? { hasChildren: true } : {}),
      });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function countHubs(hubs: readonly ObjectHub[], types: readonly ItemType[]): ObjectHub[] {
  return hubs.map((h) => ({ ...h, count: types.filter((t) => t === h.type).length }));
}

const TYPE_ICON: Record<NoteType, InboxJob["icon"]> = {
  note: "i-note",
  meeting: "i-meeting",
  article: "i-article",
  book: "i-book",
  video: "i-video",
  podcast: "i-video",
  ai: "i-ai",
  recipe: "i-recipe",
};

/** A capture still in the pipeline (status inbox/processing) as an inbox job. */
export function toInboxJob(
  row: Pick<ItemRow, "title" | "type" | "status"> & { id?: string },
): InboxJob {
  const type = uiType(row.type);
  const icon = isDomainObjectType(type) ? "i-note" : TYPE_ICON[type];
  const itemId = row.id ?? null;
  return row.status === "processing"
    ? {
        itemId,
        title: row.title,
        icon,
        step:
          row.type === "meeting" ? t("Meeting is running or being processed") : t("AI processing"),
        pct: 60,
      }
    : { itemId, title: row.title, icon, step: t("In the queue"), pct: 10 };
}

export function toProfile(
  user: Pick<User, "email" | "user_metadata">,
  tier: string | null | undefined,
): Profile {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fromMeta = [meta.full_name, meta.name, meta.display_name].find(
    (v): v is string => typeof v === "string" && !!v.trim(),
  );
  const local = (user.email ?? "").split("@")[0] ?? "";
  const name =
    fromMeta?.trim() || (local ? local.charAt(0).toUpperCase() + local.slice(1) : t("You"));
  const plan = tier
    ? `${PRODUCT_NAME} ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`
    : PRODUCT_NAME;
  return { name, initial: name.charAt(0).toUpperCase(), plan };
}
