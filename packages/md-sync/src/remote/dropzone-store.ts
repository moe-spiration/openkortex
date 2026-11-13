import { randomUUID } from "node:crypto";
import {
  STORAGE_BUCKETS,
  findDuplicate,
  storagePath,
  type Json,
  type KnowledgeItemType,
  type KortexClient,
} from "@kortex/db";
import { INBOX_FOLDER } from "../vault-layout";
import { slugify } from "../paths";

/** A stable, fully read file from the dropzone. `hash` is `fileHash(bytes)` (`file:<sha256>`). */
export interface DropzoneUpload {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  hash: string;
}

export type DropzoneSubmitResult =
  | { status: "created"; itemId: string }
  /** The same bytes are already a Kortex item: nothing new was written. */
  | { status: "duplicate"; itemId: string };

/**
 * Thrown by a store when the file should wait in the dropzone and be tried again later (daily AI
 * budget reached, offline, server busy) instead of going to `.failed`.
 */
export class DropzonePostponeError extends Error {
  override name = "DropzonePostponeError";
}

/** Where dropzone files go: the cloud side (Supabase in the daemon, a fake in tests). */
export interface DropzoneStore {
  submit(file: DropzoneUpload): Promise<DropzoneSubmitResult>;
}

const TEXT_EXT = /\.(txt|text)$/i;
const MAX_TEXT_CHARS = 2_000_000;

export const isTextUpload = (name: string) => TEXT_EXT.test(name);

/** Same mapping as the web ingest (`initialTypeForFile`); text files become notes. */
export function itemTypeForUpload(name: string, mimeType: string): KnowledgeItemType {
  if (/pdf/i.test(mimeType) || /\.pdf$/i.test(name)) return "pdf";
  if (/epub/i.test(mimeType) || /\.epub$/i.test(name)) return "epub";
  if (isTextUpload(name)) return "note";
  if (/^image\//i.test(mimeType) || /\.(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(name)) return "image";
  // Audio, .eml, ...: a placeholder note until the pipeline's adapter for it replaces it.
  return "note";
}

export const titleForUpload = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim() || "Upload";

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
  eml: "message/rfc822",
  txt: "text/plain",
};

export const mimeForUpload = (name: string): string =>
  MIME_BY_EXT[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";

/**
 * Dropzone on the self-hosted Supabase. Same hand-over as `POST /api/ingest` (file kind) without
 * HTTP: optimistic inbox row + a durable `kortex.ingest_jobs` row with the bytes staged in
 * Storage; the web worker runs OCR / transcript / organizer. The daemon's service-role client is
 * the auth path, every query is scoped to `userId`.
 */
export class SupabaseDropzoneStore implements DropzoneStore {
  constructor(
    private readonly client: KortexClient,
    private readonly userId: string,
  ) {}

  async submit(file: DropzoneUpload): Promise<DropzoneSubmitResult> {
    const type = itemTypeForUpload(file.name, file.mimeType);
    const title = titleForUpload(file.name);
    const dup = await findDuplicate(this.client, this.userId, { type, title, hash: file.hash });
    if (dup) return { status: "duplicate", itemId: dup.item.id };

    const { data: folder, error: folderError } = await this.client
      .from("folders")
      .select("id")
      .eq("user_id", this.userId)
      .eq("folder_path", INBOX_FOLDER)
      .maybeSingle();
    if (folderError) throw new Error(`dropzone folder lookup: ${folderError.message}`);

    const itemId = randomUUID();
    const text = isTextUpload(file.name)
      ? new TextDecoder("utf-8").decode(file.bytes).slice(0, MAX_TEXT_CHARS)
      : null;
    const base = {
      id: itemId,
      user_id: this.userId,
      type,
      source_platform: "dropzone",
      title,
      slug: slugify(title) || itemId,
      content_md: text ?? "",
      folder_path: INBOX_FOLDER,
      folder_id: folder?.id ?? null,
      is_manual_placement: false,
      tags: [] as string[],
      status: "inbox" as const,
      content_hash: file.hash,
      file_mime_type: file.mimeType,
      file_size_bytes: file.bytes.byteLength,
      metadata: {
        original_file_name: file.name,
        dropzone: true,
        ingest: { state: "queued" },
      } as Json,
    };
    const { error: insertError } = await this.client.from("knowledge_items").insert(base);
    if (insertError) throw new Error(`dropzone insert item: ${insertError.message}`);

    try {
      const jobId = randomUUID();
      let payload: Json;
      if (text !== null) {
        payload = {
          input: { rawText: text, typeHint: "note", manualTags: [] },
          options: { keepTitle: false, userNote: null },
        };
      } else {
        const safe = file.name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "upload";
        const staged = {
          bucket: STORAGE_BUCKETS.documents,
          path: storagePath(this.userId, "_ingest", jobId, safe),
          name: file.name,
          mimeType: file.mimeType,
        };
        const { error: uploadError } = await this.client.storage
          .from(staged.bucket)
          .upload(staged.path, file.bytes, { contentType: file.mimeType, upsert: true });
        if (uploadError) throw new Error(`dropzone upload: ${uploadError.message}`);
        payload = {
          input: { fileName: file.name, mimeType: file.mimeType, manualTags: [] },
          options: { keepTitle: false, userNote: null },
          file: staged,
        };
      }
      const { error: jobError } = await this.client.from("ingest_jobs").insert({
        id: jobId,
        user_id: this.userId,
        item_id: itemId,
        kind: text !== null ? "note" : "file",
        payload,
      });
      if (jobError) throw new Error(`dropzone enqueue: ${jobError.message}`);
    } catch (error) {
      // Not queued: the optimistic row must not wait for a job that never comes (and a retry of
      // the file must not be reported as a duplicate of this half-made item).
      await this.client.from("knowledge_items").delete().eq("user_id", this.userId).eq("id", itemId);
      throw error;
    }
    return { status: "created", itemId };
  }
}
