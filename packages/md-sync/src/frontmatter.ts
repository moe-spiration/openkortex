import matter from "gray-matter";
import {
  ITEM_STATUSES,
  KNOWLEDGE_ITEM_TYPES,
  type ItemStatus,
  type Json,
  type KnowledgeItemType,
} from "@kortex/db";
import { sha256Checksum } from "./checksum";
import { isUuid, normalizeFolderPath } from "./paths";
import type { ItemWrite, SyncItem } from "./types";
import { INBOX_FOLDER } from "./vault-layout";

/** Frontmatter keys in the order they are written (spec 02, section 3.2). */
export const FRONTMATTER_KEYS = [
  "id",
  "title",
  "type",
  "source_platform",
  "source_ref",
  "folder_path",
  "parent_item_id",
  "cover_image",
  "icon",
  "cluster",
  "tags",
  "entities",
  "status",
  "remind_at",
  "created_at",
  "updated_at",
  "checksum",
  "metadata",
] as const;

/** Same defaults as the `knowledge_items` column defaults, so both sides normalise identically. */
export const ITEM_DEFAULTS = {
  source_platform: "manual",
  icon: "file-text",
  cluster: "General",
  status: "inbox" as ItemStatus,
} as const;

type JsonObject = { [key: string]: Json | undefined };

/**
 * The normalised, comparable form of one item. Identical for a DB row and for the markdown
 * file it was written to, which is what makes the checksum loop prevention work.
 * `updated_at` and `checksum` are deliberately not part of it (they change on every save).
 */
export interface CanonicalDoc {
  id: string;
  title: string;
  type: KnowledgeItemType;
  source_platform: string;
  /** DB column `source_url`. */
  source_ref: string | null;
  folder_path: string;
  parent_item_id: string | null;
  /** DB column `cover_image_url`. */
  cover_image: string | null;
  icon: string;
  /** DB column `cluster_name`. */
  cluster: string;
  tags: string[];
  entities: string[];
  status: ItemStatus;
  /** Reminder (resurfacing). Null = none; then it is neither in the checksum nor in the file. */
  remind_at: string | null;
  created_at: string;
  metadata: JsonObject;
  /** Trimmed markdown body (`content_md`), LF line endings. */
  body: string;
}

export class FrontmatterError extends Error {
  override name = "FrontmatterError";
}

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

export const normalizeBody = (body: string) => body.replace(/\r\n?/g, "\n").trim();

/** Parses a markdown file. Throws `FrontmatterError` on broken YAML (the file is then left alone). */
export function parseMarkdown(text: string): ParsedMarkdown {
  let file: matter.GrayMatterFile<string>;
  try {
    // Passing options disables gray-matter's global (unbounded) parse cache.
    file = matter(text.replace(/\r\n?/g, "\n"), { language: "yaml" });
  } catch (error) {
    throw new FrontmatterError(
      `invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { data: isPlainObject(file.data) ? file.data : {}, body: normalizeBody(file.content) };
}

// --- field normalisation -------------------------------------------------------

const toText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

/** Any timestamp spelling (Date from YAML, Postgres `+00:00` with microseconds, ...) -> ISO UTC ms. */
export function normalizeTimestamp(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" && v.trim()) {
    const ms = Date.parse(v.trim());
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  return null;
}

const toStringArray = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  return list.map(toText).filter((s): s is string => s !== null);
};

/** Deep JSON copy: Dates -> ISO strings, undefined/functions dropped, non-finite numbers -> null. */
function toJson(v: unknown): Json | undefined {
  if (v === undefined || typeof v === "function" || typeof v === "symbol") return undefined;
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) return v.map((x) => toJson(x) ?? null);
  if (isPlainObject(v)) {
    const out: JsonObject = {};
    for (const [k, x] of Object.entries(v)) {
      const j = toJson(x);
      if (j !== undefined) out[k] = j;
    }
    return out;
  }
  return String(v);
}

const toMetadata = (v: unknown): JsonObject =>
  isPlainObject(v) ? (toJson(v) as JsonObject) : ({} as JsonObject);

const toItemType = (v: unknown, fallback: KnowledgeItemType): KnowledgeItemType => {
  const s = toText(v);
  return s && (KNOWLEDGE_ITEM_TYPES as readonly string[]).includes(s)
    ? (s as KnowledgeItemType)
    : fallback;
};

const toStatus = (v: unknown): ItemStatus => {
  const s = toText(v);
  return s && (ITEM_STATUSES as readonly string[]).includes(s)
    ? (s as ItemStatus)
    : ITEM_DEFAULTS.status;
};

/** DB folder_path -> canonical (empty means the inbox). */
export const canonicalFolderPath = (folderPath: string | null | undefined) =>
  normalizeFolderPath(folderPath) || INBOX_FOLDER;

// --- DB row <-> canonical <-> file --------------------------------------------

export function canonicalFromItem(item: SyncItem): CanonicalDoc {
  return {
    id: item.id,
    title: toText(item.title) ?? item.slug,
    type: toItemType(item.type, "note"),
    source_platform: toText(item.source_platform) ?? ITEM_DEFAULTS.source_platform,
    source_ref: toText(item.source_url),
    folder_path: canonicalFolderPath(item.folder_path),
    parent_item_id: isUuid(item.parent_item_id) ? item.parent_item_id : null,
    cover_image: toText(item.cover_image_url),
    icon: toText(item.icon) ?? ITEM_DEFAULTS.icon,
    cluster: toText(item.cluster_name) ?? ITEM_DEFAULTS.cluster,
    tags: toStringArray(item.tags),
    entities: toStringArray(item.entities),
    status: toStatus(item.status),
    remind_at: normalizeTimestamp(item.remind_at),
    created_at: normalizeTimestamp(item.created_at) ?? item.created_at,
    metadata: toMetadata(item.metadata),
    body: normalizeBody(item.content_md ?? ""),
  };
}

export interface FileContext {
  id: string;
  /** Where the file actually is (location wins over the `folder_path` key). */
  folderPath: string;
  /** File name without `.md`; title fallback. */
  stem: string;
  /** Type for files that don't declare one (inferred from the folder). */
  defaultType: KnowledgeItemType;
  /** created_at for files that don't declare one. */
  createdAt: string;
}

export function canonicalFromFile(parsed: ParsedMarkdown, ctx: FileContext): CanonicalDoc {
  const d = parsed.data;
  return {
    id: ctx.id,
    title: toText(d.title) ?? ctx.stem,
    type: toItemType(d.type, ctx.defaultType),
    source_platform: toText(d.source_platform) ?? ITEM_DEFAULTS.source_platform,
    source_ref: toText(d.source_ref),
    folder_path: canonicalFolderPath(ctx.folderPath),
    parent_item_id: isUuid(d.parent_item_id) ? d.parent_item_id : null,
    cover_image: toText(d.cover_image),
    icon: toText(d.icon) ?? ITEM_DEFAULTS.icon,
    cluster: toText(d.cluster) ?? ITEM_DEFAULTS.cluster,
    tags: toStringArray(d.tags),
    entities: toStringArray(d.entities),
    status: toStatus(d.status),
    remind_at: normalizeTimestamp(d.remind_at),
    created_at: normalizeTimestamp(d.created_at) ?? ctx.createdAt,
    metadata: toMetadata(d.metadata),
    body: parsed.body,
  };
}

/** Deterministic `sha256:` checksum (frontmatter `checksum` == DB `local_file_hash`). */
export function checksumOf(doc: CanonicalDoc): string {
  const { body, remind_at, ...fields } = doc;
  // remind_at joins the checksum only when set, so files from before it existed keep their hash.
  return sha256Checksum(remind_at ? { ...fields, remind_at } : fields, body);
}

/** Renders the markdown file for a canonical doc. */
export function renderMarkdown(doc: CanonicalDoc, updatedAt: string, checksum: string): string {
  const data: Partial<Record<(typeof FRONTMATTER_KEYS)[number], unknown>> = {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    source_platform: doc.source_platform,
    source_ref: doc.source_ref,
    folder_path: doc.folder_path,
    parent_item_id: doc.parent_item_id,
    cover_image: doc.cover_image,
    icon: doc.icon,
    cluster: doc.cluster,
    tags: doc.tags,
    entities: doc.entities,
    status: doc.status,
    ...(doc.remind_at ? { remind_at: doc.remind_at } : {}),
    created_at: doc.created_at,
    updated_at: normalizeTimestamp(updatedAt) ?? updatedAt,
    checksum,
    metadata: doc.metadata,
  };
  const content = doc.body ? `\n${doc.body}\n` : "";
  // Options go straight to js-yaml safeDump: no line folding, no anchors, stable output.
  const yamlOptions = { lineWidth: -1, noRefs: true } as unknown as matter.GrayMatterOption<
    string,
    never
  >;
  return matter.stringify(content, data, yamlOptions);
}

export function itemWriteFromCanonical(
  doc: CanonicalDoc,
  extra: {
    slug: string;
    folderId: string | null;
    checksum: string;
    isManualPlacement?: boolean;
  },
): ItemWrite {
  const write: ItemWrite = {
    id: doc.id,
    parent_item_id: doc.parent_item_id,
    folder_id: extra.folderId,
    type: doc.type,
    source_platform: doc.source_platform,
    title: doc.title,
    slug: extra.slug,
    content_md: doc.body,
    source_url: doc.source_ref,
    cover_image_url: doc.cover_image,
    icon: doc.icon,
    cluster_name: doc.cluster,
    folder_path: doc.folder_path,
    tags: doc.tags,
    entities: doc.entities,
    metadata: doc.metadata,
    status: doc.status,
    local_file_hash: extra.checksum,
    remind_at: doc.remind_at,
    created_at: doc.created_at,
  };
  if (extra.isManualPlacement !== undefined) write.is_manual_placement = extra.isManualPlacement;
  return write;
}
