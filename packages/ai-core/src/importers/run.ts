import {
  DEFAULT_FOLDER_BY_TYPE,
  dedupKeys,
  findDuplicate,
  insertOrMerge,
  isDomainObjectType,
  isTitleIdentityType,
  matchKey,
  type DedupCandidate,
  type DedupKeys,
  type Insert,
  type Json,
  type KortexClient,
} from "@kortex/db";
import type { RawIngestInput } from "../adapters/base-adapter";
import { slugify } from "../pipeline/ingest";
import { isTypedExtractionType } from "../typed/extraction";
import type { ImportedItem, ImporterAdapter } from "./types";

/*
 * Import runner: export files → dedup (central @kortex/db dedup.ts) → insert through
 * `insertOrMerge` (same path as web ingest, MCP and md-sync) → optional ingest job (same durable
 * queue as the web capture: kortex.ingest_jobs, run by the web worker). Dry run by default.
 */

export const IMPORT_INBOX_FOLDER = "00_Inbox";
/** Default and hard cap of files per run (test imports; a full import needs `allowAll`). */
export const IMPORT_DEFAULT_LIMIT = 10;
export const IMPORT_MAX_LIMIT = 20;

/** Effective limit; throws when `requested` exceeds the cap without `allowAll`. */
export function resolveImportLimit(requested: number | undefined, allowAll = false): number {
  if (allowAll) return requested ?? Number.POSITIVE_INFINITY;
  const n = requested ?? IMPORT_DEFAULT_LIMIT;
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--limit must be a positive integer, got ${n}`);
  if (n > IMPORT_MAX_LIMIT)
    throw new Error(
      `--limit ${n} exceeds the cap of ${IMPORT_MAX_LIMIT} files per run (use --all only for an approved full import)`,
    );
  return n;
}

/** When the AI pipeline runs for a new item: `content` = only items with own text (default). */
export type ImportAiMode = "content" | "all" | "none";

export interface ImportJob {
  itemId: string;
  kind: string;
  input: Omit<RawIngestInput, "userId" | "itemId">;
  options: {
    keepTitle?: boolean;
    sourceUrl?: string;
    sourcePlatform?: string;
    /** Re-crawl: text processed instead when the page cannot be read on the last attempt. */
    fallbackText?: string;
    /** Re-crawl: keep the imported type and folder (domain objects from an entity card). */
    keepType?: boolean;
  };
}

export interface ImportHit {
  id: string;
  reason: string;
}

/** Database side of the runner (Supabase in the CLI, in-memory in tests). */
export interface ImportStore {
  findDuplicate(c: DedupCandidate, keys: DedupKeys): Promise<ImportHit | null>;
  /** Insert, or merge into the duplicate found meanwhile. */
  insert(
    row: Insert<"knowledge_items">,
    c: DedupCandidate,
  ): Promise<{ id: string; duplicate: ImportHit | null }>;
  folderId(path: string): Promise<string | null>;
  enqueue(job: ImportJob): Promise<void>;
}

export interface ImportFile {
  file: string;
  text: string;
}

export interface ImportEntry {
  file: string;
  title?: string;
  type?: string;
  sourceUrl?: string | null;
  action: "new" | "duplicate" | "skipped" | "error";
  /** Dedup stage (`source_url`, `content_hash`, `title`, ...) or `batch` for a twin in this run. */
  reason?: string;
  /** New item id (apply) or the existing duplicate. */
  id?: string;
  queued?: boolean;
  /** The source URL is fetched again (full content instead of the export's link card). */
  recrawl?: boolean;
  /** The source delivered the full content (no fetch needed). */
  prefetched?: boolean;
  error?: string;
}

export interface ImportReport {
  mode: "dry-run" | "apply";
  importer: string;
  files: number;
  created: number;
  duplicates: number;
  skipped: number;
  errors: number;
  queued: number;
  entries: ImportEntry[];
}

export interface RunImportOptions {
  importer: ImporterAdapter;
  userId: string;
  apply: boolean;
  ai?: ImportAiMode;
  uuid: () => string;
  platform?: string;
  /**
   * Re-crawl the source URL (default true): exports like Recall carry little more than a link,
   * so every card with an http(s) source is fetched again through the normal URL pipeline
   * (web article, YouTube, podcast …) and the export's own text is kept below it.
   * Needs the AI pipeline, so `ai: "none"` turns it off.
   */
  recrawl?: boolean;
  /**
   * Import entity cards (a person, organization, tool … with nothing but a link, Recall's graph
   * references). Default false: objects come from the content through the organizer instead.
   */
  objects?: boolean;
}

/** Http(s) source the URL pipeline can fetch again. */
export const crawlableUrl = (url: string | null): string | null =>
  url && /^https?:\/\//i.test(url) ? url : null;

/** Ingest job for an imported item: re-crawl its source URL, or process the export's text. */
export function importJobOf(
  item: ImportedItem,
  itemId: string,
  platform: string,
  recrawl: boolean,
): ImportJob {
  const url = recrawl ? crawlableUrl(item.sourceUrl) : null;
  const base = { keepTitle: true, ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}) };
  if (!url)
    return {
      itemId,
      kind: "import",
      input: {
        rawText: item.contentMd,
        typeHint: item.type,
        manualTags: item.tags,
        title: item.title,
      },
      options: { ...base, sourcePlatform: platform },
    };
  // Re-crawl: the export only knows the link. Title, tags, summary, folder and source platform
  // come from the Kortex pipeline like for any new capture; the export's text is only the
  // fallback for a dead page, its tags stay in metadata.import.
  return {
    itemId,
    kind: "import",
    input: {
      url,
      // Typed items (book, movie, …) keep their registry fields; articles, bookmarks, videos
      // and podcasts are typed by the URL adapter. Objects keep their type via `keepType`.
      ...(isTypedExtractionType(item.type) ? { typeHint: item.type } : {}),
      // A blocked page (403, bot wall) still becomes a bookmark with the export's title.
      clientHint: { title: item.title },
      // Content the source already has (Recall MCP): read instead of fetching the page.
      ...item.prefetched,
    },
    options: {
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      fallbackText: item.contentMd,
      ...(isDomainObjectType(item.type) ? { keepType: true } : {}),
    },
  };
}

export const candidateOf = (
  item: ImportedItem,
  platform: string,
  withTags = true,
): DedupCandidate => ({
  type: item.type,
  title: item.title,
  sourceUrl: item.sourceUrl,
  contentMd: item.contentMd,
  metadata: item.metadata,
  tags: withTags ? item.tags : [],
  platform,
  appendContent: true,
  ...(item.createdAt ? { at: item.createdAt } : {}),
});

/** Keys a later file of the same run collides on (twins inside one export). */
function batchKeys(c: DedupCandidate, k: DedupKeys): string[] {
  const out: string[] = [];
  if (k.source_url_norm) out.push(`url:${k.source_url_norm}`);
  if (k.content_hash) out.push(`hash:${c.type}:${k.content_hash}`);
  if (isTitleIdentityType(c.type) && matchKey(c.title))
    out.push(`title:${c.type}:${matchKey(c.title)}`);
  return out;
}

export async function runImport(
  files: readonly ImportFile[],
  store: ImportStore,
  o: RunImportOptions,
): Promise<ImportReport> {
  const platform = o.platform ?? o.importer.id;
  const ai = o.ai ?? "content";
  const recrawl = (o.recrawl ?? true) && ai !== "none";
  const crawlsAgain = (item: ImportedItem) => recrawl && !!crawlableUrl(item.sourceUrl);
  const report: ImportReport = {
    mode: o.apply ? "apply" : "dry-run",
    importer: o.importer.id,
    files: files.length,
    created: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    queued: 0,
    entries: [],
  };
  const seen = new Map<string, string>();
  const folders = new Map<string, string | null>();
  const folderId = async (path: string) => {
    if (!folders.has(path)) folders.set(path, await store.folderId(path));
    return folders.get(path) ?? null;
  };

  for (const f of files) {
    const entry: ImportEntry = { file: f.file, action: "error" };
    report.entries.push(entry);
    try {
      if (!o.importer.canHandle(f.file, f.text)) throw new Error(`not a ${o.importer.label} file`);
      const item = o.importer.parse(f.text, f.file);
      Object.assign(entry, { title: item.title, type: item.type, sourceUrl: item.sourceUrl });
      if (!o.objects && isDomainObjectType(item.type) && !item.hasBody) {
        Object.assign(entry, { action: "skipped", reason: "object-reference" });
        report.skipped++;
        continue;
      }
      const c = candidateOf(item, platform, !crawlsAgain(item));
      const keys = await dedupKeys(c);
      const twin = batchKeys(c, keys)
        .map((k) => seen.get(k))
        .find(Boolean);
      const hit = await store.findDuplicate(c, keys);
      if (hit || (twin && !o.apply)) {
        Object.assign(entry, {
          action: "duplicate",
          reason: hit?.reason ?? "batch",
          id: hit?.id ?? twin,
        });
        // Apply: merge (tags/sources/missing text) through the same insert path, nothing new.
        if (o.apply && hit)
          await store.insert(rowOf(item, o, "", null, false, !crawlsAgain(item)), c);
        report.duplicates++;
        continue;
      }

      const crawl = crawlsAgain(item);
      const willQueue = crawl || ai === "all" || (ai === "content" && item.hasBody);
      const queued = o.apply && willQueue;
      // Objects keep their type folder while their page is crawled; the rest waits in the inbox.
      const folderPath =
        willQueue && !(crawl && isDomainObjectType(item.type))
          ? IMPORT_INBOX_FOLDER
          : (DEFAULT_FOLDER_BY_TYPE[item.type] ?? IMPORT_INBOX_FOLDER);
      entry.queued = willQueue;
      if (crawl) entry.recrawl = true;
      if (crawl && item.prefetched) entry.prefetched = true;
      if (!o.apply) {
        const pseudo = `planned:${report.entries.length}`;
        for (const k of batchKeys(c, keys)) seen.set(k, pseudo);
        entry.action = "new";
        report.created++;
        if (willQueue) report.queued++;
        continue;
      }

      const id = o.uuid();
      const res = await store.insert(
        rowOf(item, o, id, { path: folderPath, id: await folderId(folderPath) }, queued, !crawl),
        c,
      );
      if (res.duplicate) {
        Object.assign(entry, {
          action: "duplicate",
          reason: res.duplicate.reason,
          id: res.duplicate.id,
          queued: false,
        });
        report.duplicates++;
        continue;
      }
      Object.assign(entry, { action: "new", id: res.id });
      for (const k of batchKeys(c, keys)) seen.set(k, res.id);
      report.created++;
      if (queued) {
        await store.enqueue(importJobOf(item, res.id, platform, crawl));
        report.queued++;
      }
    } catch (err) {
      entry.action = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      report.errors++;
    }
  }
  return report;
}

function rowOf(
  item: ImportedItem,
  o: RunImportOptions,
  id: string,
  folder: { path: string; id: string | null } | null,
  queued: boolean,
  /** False on re-crawl: the export's tags stay in metadata.import, Kortex tags the item. */
  withTags = true,
): Insert<"knowledge_items"> {
  return {
    id,
    user_id: o.userId,
    type: item.type,
    source_platform: o.platform ?? o.importer.id,
    title: item.title,
    slug: slugify(item.title) || id,
    content_md: item.contentMd,
    source_url: item.sourceUrl,
    folder_path: folder?.path ?? IMPORT_INBOX_FOLDER,
    folder_id: folder?.id ?? null,
    is_manual_placement: false,
    tags: withTags ? item.tags : [],
    status: queued ? "inbox" : "processed",
    ...(item.createdAt ? { created_at: item.createdAt } : {}),
    metadata: {
      ...item.metadata,
      captured_at: item.createdAt,
      ...(item.updatedAt ? { source_updated_at: item.updatedAt } : {}),
      ingest: { state: queued ? "queued" : "skipped" },
    } as unknown as Json,
  };
}

/** Supabase-backed store (service role, every query scoped by `userId`). */
export function createSupabaseImportStore(
  db: KortexClient,
  userId: string,
  uuid: () => string,
): ImportStore {
  return {
    async findDuplicate(c, keys) {
      const hit = await findDuplicate(db, userId, c, keys);
      return hit ? { id: hit.item.id, reason: hit.reason } : null;
    },
    async insert(row, c) {
      const res = await insertOrMerge(db, userId, row, c);
      return {
        id: res.id,
        duplicate: res.duplicate
          ? { id: res.duplicate.item.id, reason: res.duplicate.reason }
          : null,
      };
    },
    async folderId(path) {
      const { data, error } = await db
        .from("folders")
        .select("id")
        .eq("user_id", userId)
        .eq("folder_path", path)
        .limit(1);
      if (error) throw new Error(`folder ${path}: ${error.message}`);
      return (data as { id: string }[] | null)?.[0]?.id ?? null;
    },
    async enqueue(job) {
      const { error } = await db.from("ingest_jobs").insert({
        id: uuid(),
        user_id: userId,
        item_id: job.itemId,
        kind: job.kind,
        payload: { input: job.input, options: job.options } as unknown as Json,
      });
      if (error) throw new Error(`ingest_jobs insert: ${error.message}`);
    },
  };
}
