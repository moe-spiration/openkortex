import { t } from "@/i18n";
import { normalizeTag, slugify, type RawIngestInput } from "@kortex/ai-core";
import {
  fileHash,
  findDuplicate,
  insertOrMerge,
  normalizeUrl,
  type DedupCandidate,
  type Insert,
  type DedupItem,
  type DuplicateHit,
  type ItemStatus,
  type Json,
  type KnowledgeItemType,
} from "@kortex/db";
import { ApiError } from "../api-error";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import {
  ensureFolderPath,
  insertHighlight,
  listFolders,
  mergeJson,
  normalizeFolderPath,
  updateItem,
  type FolderRef,
} from "../repo";
import {
  AI_MEMORIES_FOLDER,
  INBOX_FOLDER,
  initialTypeForFile,
  type AiChatRequest,
  type FileIngestRequest,
  type HighlightRequest,
  type IngestRequest,
  type IngestSuccess,
  type NoteRequest,
  type WebClipRequest,
} from "./contract";
import { markItemFailed, type ProcessOptions } from "./process";
import { applyStatusCapture } from "./status-capture";

// Accept phase of POST /api/ingest: validate, dedupe, write an optimistic row (status
// `inbox`) and queue the AI pipeline. The response returns before any model call.

// URL normalisation and all duplicate detection live in @kortex/db (dedup.ts).
export { normalizeUrl };

/** Response for a capture that turned out to be a duplicate of `item` (nothing queued). */
const duplicateOf = (kind: IngestSuccess["kind"], item: DedupItem, file?: string): IngestSuccess =>
  ok({
    kind,
    item_id: item.id,
    type: item.type as KnowledgeItemType,
    status: item.status as ItemStatus,
    folder_path: item.folder_path,
    auto_routed: !item.is_manual_placement,
    duplicate: true,
    queued: false,
    ...(file ? { file } : {}),
  });

/** Existing item of a URL capture (all dedup stages, see @kortex/db dedup.ts). */
const findByUrl = (
  ctx: AuthContext,
  url: string,
  c: Partial<DedupCandidate> & { title: string },
): Promise<DuplicateHit | null> =>
  findDuplicate(ctx.client, ctx.userId, {
    type: "bookmark",
    sourceUrl: url,
    platform: "web",
    ...c,
  });

/** Same rule as the extension and the MCP server: `YYYY-MM-DD_topic-slug.md`. */
export function memoryFileName(title: string, at: Date): string {
  const slug =
    title
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "untitled";
  return `${at.toISOString().slice(0, 10)}_${slug}.md`;
}

const cleanTags = (tags: readonly string[] | undefined) => [
  ...new Set((tags ?? []).map(normalizeTag).filter(Boolean)),
];

/** Pipeline input of a web clip, incl. what the client knows about media (shared contract). */
function mediaInput(
  req: WebClipRequest,
  url: string,
  tags: string[],
  manualFolder: FolderRef | null,
): Omit<RawIngestInput, "userId" | "itemId"> {
  const t = req.transcript;
  return {
    url,
    typeHint: req.type_hint,
    manualTags: tags,
    title: req.title,
    ...(req.summary_level ? { summaryLevel: req.summary_level } : {}),
    clientHint: {
      title: req.title,
      description: req.description ?? null,
      imageUrl: req.image_url ?? null,
      siteName: req.site_name ?? null,
    },
    ...(req.image_url ? { imageUrl: req.image_url } : {}),
    ...(t && (t.text.trim() || t.segments?.length)
      ? {
          transcript: {
            text: t.text,
            source: t.source,
            ...(t.lang ? { lang: t.lang } : {}),
            ...(t.segments?.length ? { segments: t.segments } : {}),
          },
        }
      : {}),
    ...(req.media
      ? {
          media: {
            kind: req.media.kind,
            ...(req.media.provider ? { provider: req.media.provider } : {}),
            ...(req.media.duration_sec !== undefined
              ? { duration_sec: req.media.duration_sec }
              : {}),
            ...(req.media.channel ? { channel: req.media.channel } : {}),
            ...(req.media.published_at ? { published_at: req.media.published_at } : {}),
          },
        }
      : {}),
    ...(manualFolder && manualFolder.id
      ? { targetFolderId: manualFolder.id, targetFolderPath: manualFolder.folder_path }
      : {}),
  };
}

/** Appends a dated "## Notiz" section (repeat captures of the same URL). */
const withNoteSection = (content: string, note: string, at: string) =>
  `${content.trimEnd()}\n\n## ${t("Note")} (${at.slice(0, 10)})\n\n${note}\n`;

/** First note (metadata.user_note, shown above the content) plus the "## Notiz" sections added since. */
function collectUserNotes(content: string, metadata: unknown): string | null {
  const first = (metadata as { user_note?: unknown } | null)?.user_note;
  const head = typeof first === "string" && first.trim() ? first.trim() : null;
  const from = head && content.startsWith(head) ? head.length : 0;
  const at = content.slice(from).search(/\n## (?:Notiz|Note) \(\d{4}-\d{2}-\d{2}\)\n/);
  const later = at >= 0 ? content.slice(from + at).trim() : null;
  return [head, later].filter(Boolean).join("\n\n") || null;
}

const captureDate = (capturedAt: string | undefined, now: Date): Date => {
  const d = capturedAt ? new Date(capturedAt) : now;
  return Number.isNaN(d.getTime()) ? now : d;
};

interface Placement {
  folder: FolderRef;
  manual: boolean;
}

async function resolvePlacement(
  ctx: AuthContext,
  folderPath: string | null | undefined,
): Promise<Placement> {
  if (folderPath) {
    return {
      folder: await ensureFolderPath(ctx.client, ctx.userId, normalizeFolderPath(folderPath)),
      manual: true,
    };
  }
  const inbox = (await listFolders(ctx.client, ctx.userId)).find(
    (f) => f.folder_path === INBOX_FOLDER,
  );
  return { folder: inbox ?? { id: "", folder_path: INBOX_FOLDER }, manual: false };
}

/** Hands the item to the ingest queue (durable in production, see ./queue.ts). */
async function queue(
  deps: ServerDeps,
  ctx: AuthContext,
  itemId: string,
  input: Omit<RawIngestInput, "userId" | "itemId">,
  options: ProcessOptions,
  kind: string,
) {
  try {
    await deps.queue.enqueue(ctx, { itemId, kind, input, options });
  } catch (err) {
    // Not queued: the optimistic row must not wait for a job that never comes.
    await markItemFailed(
      deps,
      ctx,
      itemId,
      t("Not queued: {error}", { error: err instanceof Error ? err.message : String(err) }),
    ).catch(() => {});
    throw err;
  }
}

const ok = (p: Omit<IngestSuccess, "ok">): IngestSuccess => ({ ok: true, ...p });

/**
 * Inserts `row`, or merges it into the existing duplicate and returns that one (nothing is inserted,
 * so nothing must be queued). A concurrent insert that trips the unique URL index is a merge, not an error.
 */
async function insertDeduped(
  ctx: AuthContext,
  candidate: Pick<DedupCandidate, "type" | "title"> & Partial<DedupCandidate>,
  row: Insert<"knowledge_items">,
): Promise<DedupItem | null> {
  const res = await insertOrMerge(ctx.client, ctx.userId, row, { platform: "web", ...candidate });
  return res.duplicate?.item ?? null;
}

// --- idempotency ---------------------------------------------------------------------------
// A client retries a capture with the same `idempotency_key` (timeouts, offline outbox). Keys live
// in the data that already exists, so no new table is needed: `metadata.idempotency_keys` on
// knowledge_items (web_clip, ai_chat) and `locator.idempotency_key` on item_highlights. Two requests
// with the same key in flight at the same instant can still both pass the lookup; a retry is
// always sequential (it only follows a failed or timed-out attempt), so that window is accepted.

const MAX_KEYS = 20;

interface KeyedItem {
  id: string;
  type: string;
  status: string;
  folder_path: string;
  is_manual_placement: boolean | null;
  metadata: Json | null;
}

const keysOf = (metadata: Json | null | undefined): string[] => {
  const keys = (metadata as { idempotency_keys?: unknown } | null)?.idempotency_keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
};

/** Metadata patch that remembers `key` (newest 20 kept). Empty when the request had no key. */
const withKey = (metadata: Json | null | undefined, key: string | undefined) =>
  key
    ? { idempotency_keys: [...keysOf(metadata).filter((k) => k !== key), key].slice(-MAX_KEYS) }
    : {};

async function findKeyedItem(
  ctx: AuthContext,
  url: string,
  key: string,
  type?: string,
): Promise<KeyedItem | null> {
  let q = ctx.client
    .from("knowledge_items")
    .select("id,type,status,folder_path,is_manual_placement,metadata")
    .eq("user_id", ctx.userId)
    .eq("source_url", url);
  if (type) q = q.eq("type", type);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(200);
  if (error)
    throw new ApiError("server_error", `find keyed item: ${error.message}`, { cause: error });
  return (
    ((data as unknown as KeyedItem[] | null) ?? []).find((r) => keysOf(r.metadata).includes(key)) ??
    null
  );
}

async function findKeyedHighlight(
  ctx: AuthContext,
  itemId: string,
  key: string,
): Promise<string | null> {
  const { data, error } = await ctx.client
    .from("item_highlights")
    .select("id,locator")
    .eq("user_id", ctx.userId)
    .eq("item_id", itemId)
    .limit(500);
  if (error)
    throw new ApiError("server_error", `find keyed highlight: ${error.message}`, { cause: error });
  const rows = (data as unknown as { id: string; locator: Json }[] | null) ?? [];
  return (
    rows.find((r) => (r.locator as { idempotency_key?: unknown } | null)?.idempotency_key === key)
      ?.id ?? null
  );
}

const replayed = (
  kind: IngestSuccess["kind"],
  row: KeyedItem,
  extra: Partial<IngestSuccess> = {},
): IngestSuccess =>
  ok({
    kind,
    item_id: row.id,
    type: row.type as KnowledgeItemType,
    status: row.status as ItemStatus,
    folder_path: row.folder_path,
    auto_routed: !row.is_manual_placement,
    duplicate: true,
    queued: false,
    replayed: true,
    ...extra,
  });

// --- kinds ---------------------------------------------------------------------------------

async function acceptWebClip(
  deps: ServerDeps,
  ctx: AuthContext,
  req: WebClipRequest,
): Promise<IngestSuccess> {
  const url = normalizeUrl(req.url);
  const tags = cleanTags(req.tags);
  if (req.idempotency_key) {
    const hit = await findKeyedItem(ctx, url, req.idempotency_key);
    if (hit) return replayed(req.kind, hit);
  }
  const existing =
    (await findByUrl(ctx, url, { title: req.title, type: req.type_hint ?? "bookmark" }))?.item ??
    null;
  // Clipped again with what was missing (a transcript), or the first try failed: process again.
  const hasTranscript = !!req.transcript?.text?.trim() || !!req.transcript?.segments?.length;
  const missing = !!(existing?.metadata as { transcript_missing?: unknown } | null)
    ?.transcript_missing;
  if (existing && (existing.status === "error" || (hasTranscript && missing))) {
    const note = req.note?.trim();
    const at = req.captured_at ?? deps.now().toISOString();
    const content = note ? withNoteSection(existing.content_md, note, at) : existing.content_md;
    // Processing rewrites content_md: the user's notes (first note + later "## Notiz" sections) go above it.
    const userNote = collectUserNotes(content, existing.metadata);
    await updateItem(ctx.client, ctx.userId, existing.id, {
      status: "inbox",
      tags: [...new Set([...(existing.tags ?? []), ...tags])],
      content_md: content,
      metadata: mergeJson(existing.metadata, {
        last_captured_at: at,
        ...withKey(existing.metadata, req.idempotency_key),
        user_note: userNote,
        ingest: { state: "queued", error: null },
      }),
    });
    const manualFolder =
      existing.is_manual_placement && existing.folder_id
        ? { id: existing.folder_id, folder_path: existing.folder_path }
        : null;
    await queue(
      deps,
      ctx,
      existing.id,
      mediaInput(req, url, tags, manualFolder),
      { userNote, sourceUrl: url },
      "web_clip",
    );
    return ok({
      kind: req.kind,
      item_id: existing.id,
      type: existing.type as KnowledgeItemType,
      status: "inbox",
      folder_path: existing.folder_path,
      auto_routed: !existing.is_manual_placement,
      duplicate: true,
      queued: true,
    });
  }
  if (existing) {
    const note = req.note?.trim();
    await updateItem(ctx.client, ctx.userId, existing.id, {
      tags: [...new Set([...(existing.tags ?? []), ...tags])],
      ...(note
        ? {
            content_md: withNoteSection(
              existing.content_md,
              note,
              req.captured_at ?? deps.now().toISOString(),
            ),
          }
        : {}),
      metadata: mergeJson(existing.metadata, {
        last_captured_at: req.captured_at ?? deps.now().toISOString(),
        ...withKey(existing.metadata, req.idempotency_key),
      }),
    });
    return ok({
      kind: req.kind,
      item_id: existing.id,
      type: existing.type as KnowledgeItemType,
      status: existing.status as ItemStatus,
      folder_path: existing.folder_path,
      auto_routed: !existing.is_manual_placement,
      duplicate: true,
      queued: false,
    });
  }

  const { folder, manual } = await resolvePlacement(ctx, req.folder_path);
  const itemId = deps.uuid();
  const type =
    req.type_hint ??
    (req.media?.kind === "video" ? "video" : req.media?.kind ? "podcast" : "bookmark");
  const note = req.note?.trim() || null;
  const dup = await insertDeduped(
    ctx,
    { type, title: req.title, sourceUrl: url, tags },
    {
      id: itemId,
      user_id: ctx.userId,
      type,
      source_platform: "web",
      title: req.title,
      slug: slugify(req.title) || itemId,
      summary: req.description ?? null,
      content_md: [
        note,
        req.description ? `> ${req.description}` : null,
        `[${req.title}](${req.url})`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      source_url: url,
      cover_image_url: req.image_url ?? null,
      folder_path: folder.folder_path,
      folder_id: folder.id || null,
      is_manual_placement: manual,
      tags,
      status: "inbox",
      metadata: mergeJson(null, {
        site_name: req.site_name ?? null,
        captured_at: req.captured_at ?? null,
        client: req.client ?? null,
        user_note: note,
        ...withKey(null, req.idempotency_key),
        ingest: { state: "queued" },
      }),
    },
  );
  if (dup) return duplicateOf(req.kind, dup);
  await queue(
    deps,
    ctx,
    itemId,
    mediaInput(req, req.url, tags, manual ? folder : null),
    { userNote: note, sourceUrl: url },
    "web_clip",
  );
  return ok({
    kind: req.kind,
    item_id: itemId,
    type,
    status: "inbox",
    folder_path: folder.folder_path,
    auto_routed: !manual,
    duplicate: false,
    queued: true,
    suggested_tags: tags.length ? tags : undefined,
  });
}

async function acceptHighlight(
  deps: ServerDeps,
  ctx: AuthContext,
  req: HighlightRequest,
): Promise<IngestSuccess> {
  const url = normalizeUrl(req.url);
  let item: Pick<
    DedupItem,
    "id" | "type" | "status" | "folder_path" | "is_manual_placement"
  > | null = (await findByUrl(ctx, url, { title: req.page_title }))?.item ?? null;
  const duplicate = !!item;
  let queued = false;
  if (item && req.idempotency_key) {
    const prior = await findKeyedHighlight(ctx, item.id, req.idempotency_key);
    if (prior) {
      return replayed(
        req.kind,
        { ...item, is_manual_placement: item.is_manual_placement, metadata: null },
        { highlight_id: prior },
      );
    }
  }
  if (!item) {
    const { folder } = await resolvePlacement(ctx, null);
    const itemId = deps.uuid();
    const dup = await insertDeduped(
      ctx,
      { type: "bookmark", title: req.page_title, sourceUrl: url },
      {
        id: itemId,
        user_id: ctx.userId,
        type: "bookmark",
        source_platform: "web",
        title: req.page_title,
        slug: slugify(req.page_title) || itemId,
        content_md: `[${req.page_title}](${req.url})`,
        source_url: url,
        folder_path: folder.folder_path,
        folder_id: folder.id || null,
        is_manual_placement: false,
        status: "inbox",
        metadata: mergeJson(null, {
          captured_at: req.captured_at ?? null,
          client: req.client ?? null,
          ingest: { state: "queued" },
        }),
      },
    );
    if (dup) {
      item = dup; // another request stored the page first: attach the highlight to it
    } else {
      item = {
        id: itemId,
        type: "bookmark",
        status: "inbox",
        folder_path: folder.folder_path,
        is_manual_placement: false,
      };
      await queue(deps, ctx, itemId, { url: req.url }, { sourceUrl: url }, "highlight");
      queued = true;
    }
  }
  const highlightId = await insertHighlight(ctx.client, {
    item_id: item.id,
    user_id: ctx.userId,
    quote_text: req.quote_text,
    note_text: req.note_text ?? null,
    ...(req.color ? { color: req.color } : {}),
    locator: req.idempotency_key
      ? { ...req.locator, idempotency_key: req.idempotency_key }
      : req.locator,
  });
  return ok({
    kind: req.kind,
    item_id: item.id,
    highlight_id: highlightId,
    type: item.type as KnowledgeItemType,
    status: item.status as ItemStatus,
    folder_path: item.folder_path,
    auto_routed: !item.is_manual_placement,
    duplicate,
    queued,
  });
}

async function acceptAiChat(
  deps: ServerDeps,
  ctx: AuthContext,
  req: AiChatRequest,
): Promise<IngestSuccess> {
  const url = normalizeUrl(req.url);
  const at = captureDate(req.captured_at, deps.now());
  const file = memoryFileName(req.title, at);
  const tags = cleanTags(req.tags);
  if (req.idempotency_key) {
    const hit = await findKeyedItem(ctx, url, req.idempotency_key, "ai_chat");
    if (hit) {
      const stored = (hit.metadata as { file_name?: unknown } | null)?.file_name;
      return replayed(req.kind, hit, { file: typeof stored === "string" ? stored : file });
    }
  }
  const { folder } = await resolvePlacement(ctx, AI_MEMORIES_FOLDER);
  const meta = {
    platform: req.platform,
    scope: req.scope,
    message_count: req.message_count,
    file_name: file,
    captured_at: req.captured_at ?? null,
    client: req.client ?? null,
  };

  // A re-exported whole chat updates the existing memory; single answers are always new items.
  const existing =
    req.scope === "chat"
      ? await findByUrl(ctx, url, { title: req.title, type: "ai_chat" }).then((h) =>
          h?.item.type === "ai_chat" ? h.item : null,
        )
      : null;
  const itemId = existing?.id ?? deps.uuid();
  let raced: DedupItem | null = null;
  if (existing) {
    await updateItem(ctx.client, ctx.userId, itemId, {
      title: req.title,
      content_md: req.content_md,
      tags: [...new Set([...(existing.tags ?? []), ...tags])],
      status: "inbox",
      metadata: mergeJson(existing.metadata, {
        ...meta,
        ...withKey(existing.metadata, req.idempotency_key),
        ingest: { state: "queued" },
      }),
    });
  } else {
    raced = await insertDeduped(
      ctx,
      {
        type: "ai_chat",
        title: req.title,
        sourceUrl: url,
        urlIdentity: req.scope === "chat",
        contentMd: req.content_md,
        platform: req.platform,
      },
      {
        id: itemId,
        user_id: ctx.userId,
        type: "ai_chat",
        source_platform: req.platform,
        title: req.title,
        slug: slugify(req.title) || itemId,
        content_md: req.content_md,
        source_url: url,
        folder_path: folder.folder_path,
        folder_id: folder.id || null,
        is_manual_placement: true,
        tags,
        status: "inbox",
        metadata: mergeJson(null, {
          ...meta,
          ...withKey(null, req.idempotency_key),
          ingest: { state: "queued" },
        }),
      },
    );
  }
  if (raced) return duplicateOf(req.kind, raced, file);
  await queue(
    deps,
    ctx,
    itemId,
    {
      rawText: req.content_md,
      typeHint: "ai_chat",
      manualTags: tags,
      ...(req.summary_level ? { summaryLevel: req.summary_level } : {}),
      targetFolderId: folder.id,
      targetFolderPath: folder.folder_path,
    },
    { keepTitle: true, sourceUrl: url, sourcePlatform: req.platform },
    "ai_chat",
  );
  return ok({
    kind: req.kind,
    item_id: itemId,
    type: "ai_chat",
    status: "inbox",
    folder_path: folder.folder_path,
    auto_routed: false,
    duplicate: !!existing,
    file,
    queued: true,
  });
}

async function acceptNote(
  deps: ServerDeps,
  ctx: AuthContext,
  req: NoteRequest,
): Promise<IngestSuccess> {
  // "Film X gesehen" (voice / quick capture) updates the existing entry instead of adding a note.
  if (!req.folder_path && (!req.type_hint || req.type_hint === "voice")) {
    const updated = await applyStatusCapture(ctx, req.content_md).catch(() => null);
    if (updated)
      return duplicateOf(req.kind, updated as unknown as DedupItem);
  }
  const { folder, manual } = await resolvePlacement(ctx, req.folder_path);
  const tags = cleanTags(req.tags);
  const itemId = deps.uuid();
  const type = req.type_hint ?? "note";
  const firstLine = req.content_md
    .split("\n", 1)[0]
    ?.replace(/^#+\s*/, "")
    .trim()
    .slice(0, 80);
  const title = req.title ?? (firstLine || t("Note"));
  const dup = await insertDeduped(
    ctx,
    { type, title, contentMd: req.content_md, tags, platform: "manual" },
    {
      id: itemId,
      user_id: ctx.userId,
      type,
      source_platform: "manual",
      title,
      slug: slugify(title) || itemId,
      content_md: req.content_md,
      folder_path: folder.folder_path,
      folder_id: folder.id || null,
      is_manual_placement: manual,
      tags,
      status: "inbox",
      metadata: mergeJson(null, {
        captured_at: req.captured_at ?? null,
        client: req.client ?? null,
        ingest: { state: "queued" },
      }),
    },
  );
  if (dup) return duplicateOf(req.kind, dup);
  await queue(
    deps,
    ctx,
    itemId,
    {
      rawText: req.content_md,
      typeHint: req.type_hint,
      manualTags: tags,
      ...(req.summary_level ? { summaryLevel: req.summary_level } : {}),
      ...(manual ? { targetFolderId: folder.id, targetFolderPath: folder.folder_path } : {}),
    },
    // Voice notes get the organizer's title like typed notes ("Sprachnotiz 0:07" is only a placeholder).
    { keepTitle: !!req.title && req.type_hint !== "voice" },
    "note",
  );
  return ok({
    kind: req.kind,
    item_id: itemId,
    type,
    status: "inbox",
    folder_path: folder.folder_path,
    auto_routed: !manual,
    duplicate: false,
    queued: true,
  });
}

async function acceptFile(
  deps: ServerDeps,
  ctx: AuthContext,
  req: FileIngestRequest,
): Promise<IngestSuccess> {
  const { folder, manual } = await resolvePlacement(ctx, req.folder_path);
  const tags = cleanTags(req.tags);
  const itemId = deps.uuid();
  const type = initialTypeForFile(req.file.name, req.file.type);
  const title =
    req.title ??
    (req.file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() ||
      "Upload");
  const dup = await insertDeduped(
    ctx,
    { type, title, tags, hash: await fileHash(req.file.bytes), platform: "upload" },
    {
      id: itemId,
      user_id: ctx.userId,
      type,
      source_platform: "upload",
      title,
      slug: slugify(title) || itemId,
      content_md: req.note?.trim() ?? "",
      folder_path: folder.folder_path,
      folder_id: folder.id || null,
      is_manual_placement: manual,
      tags,
      status: "inbox",
      file_mime_type: req.file.type || null,
      file_size_bytes: req.file.bytes.byteLength,
      metadata: mergeJson(null, {
        original_file_name: req.file.name,
        user_note: req.note?.trim() || null,
        ingest: { state: "queued" },
      }),
    },
  );
  if (dup) return duplicateOf("file", dup);
  await queue(
    deps,
    ctx,
    itemId,
    {
      fileBuffer: req.file.bytes,
      fileName: req.file.name,
      mimeType: req.file.type || undefined,
      manualTags: tags,
      ...(manual ? { targetFolderId: folder.id, targetFolderPath: folder.folder_path } : {}),
    },
    { keepTitle: !!req.title, userNote: req.note?.trim() || null },
    "file",
  );
  return ok({
    kind: "file",
    item_id: itemId,
    type,
    status: "inbox",
    folder_path: folder.folder_path,
    auto_routed: !manual,
    duplicate: false,
    queued: true,
  });
}

export function acceptIngest(
  deps: ServerDeps,
  ctx: AuthContext,
  req: IngestRequest | FileIngestRequest,
): Promise<IngestSuccess> {
  switch (req.kind) {
    case "web_clip":
      return acceptWebClip(deps, ctx, req);
    case "highlight":
      return acceptHighlight(deps, ctx, req);
    case "ai_chat":
      return acceptAiChat(deps, ctx, req);
    case "note":
      return acceptNote(deps, ctx, req);
    case "file":
      return acceptFile(deps, ctx, req);
  }
}
