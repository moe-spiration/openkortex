import type { KnowledgeItemType, Priority, StorageBucket } from "@kortex/db";

/** Raw capture as it arrives at `/api/ingest` (URL, text or file). */
export interface RawIngestInput {
  userId: string;
  /**
   * Id the new knowledge item will get. Set by `ingest()` before extraction so
   * adapters can upload files to `{user_id}/{item_id}.{ext}`.
   */
  itemId?: string;
  url?: string;
  rawText?: string;
  /** File bytes (a Node `Buffer` works, it is a Uint8Array). */
  fileBuffer?: Uint8Array;
  fileName?: string;
  mimeType?: string;
  /** Folder the user dropped the item into. Implies manual placement. */
  targetFolderId?: string;
  /** Path of `targetFolderId`, if the caller already knows it. */
  targetFolderPath?: string;
  manualTags?: string[];
  /** Optional hint from the client (e.g. share sheet "Rezept speichern"). */
  typeHint?: KnowledgeItemType;
  /**
   * What the client already knew about the page (share sheet, web clipper). Used as a
   * bookmark when the page itself blocks extraction (403, bot or consent wall).
   */
  clientHint?: {
    title?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    siteName?: string | null;
  };
  /**
   * Transcript the client already has (extension: YouTube captions read in the browser, a page's
   * own transcript, or user text). Used instead of fetching one: servers in data centers are
   * bot-walled by YouTube.
   */
  transcript?: ClientTranscript;
  /**
   * The page's text the caller already has (an import from another tool that stored the full
   * article, e.g. Recall). The web adapter uses it instead of fetching the page again.
   */
  pageContent?: { markdown: string; title?: string };
  /** What the client knows about the media (kind, provider, duration, channel, date). */
  media?: MediaInfo;
  /** Cover the client saw (og:image, thumbnail). The pipeline verifies and stores it. */
  imageUrl?: string;
  /** Title the client saw (page or video title). */
  title?: string;
  /**
   * How long the AI summary should be (clipper setting, feedback C1). Default "concise": the 2-3
   * sentence TL;DR; "detailed" asks for a longer summary and more key points.
   */
  summaryLevel?: SummaryLevel;
}

export const SUMMARY_LEVELS = ["concise", "detailed"] as const;
export type SummaryLevel = (typeof SUMMARY_LEVELS)[number];
export const DEFAULT_SUMMARY_LEVEL: SummaryLevel = "concise";

/** Shared contract with the extension (apps/extension/src/lib/api.ts `transcript`). */
export interface ClientTranscript {
  text: string;
  lang?: string;
  source: "youtube-captions" | "page" | "user";
  /** Seconds from the start; `dur` optional. */
  segments?: { start: number; dur?: number; text: string }[];
}

/** Shared contract with the extension (apps/extension/src/lib/api.ts `media`). */
export interface MediaInfo {
  kind: "video" | "podcast" | "audio";
  provider?: "youtube" | "spotify" | "apple" | "other";
  duration_sec?: number;
  channel?: string;
  published_at?: string;
}

export interface StructuralChunk {
  heading?: string;
  /** "Page 12" for PDFs, "00:05:12" for videos, an epubcfi for EPUB chapters. */
  pageOrTimestamp?: string;
  text: string;
}

/** A file the adapter stored through the StorageGateway. */
export interface StoredFile {
  bucket: StorageBucket;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ExtractedPayload {
  type: KnowledgeItemType;
  sourcePlatform: string;
  titleHint?: string;
  contentMd: string;
  coverImageUrl?: string;
  structuralChunks?: StructuralChunk[];
  metadata: Record<string, unknown>;
  /** Original file kept in storage (PDF, EPUB, image). Maps to file_storage_path etc. */
  file?: StoredFile;
  /** Canonical source URL, if it differs from the input URL. */
  sourceUrl?: string;
  /**
   * Tasks the adapter extracted itself (e.g. meeting protocol with transcript timestamps).
   * When set, `ingest()` uses them instead of the organizer's action items.
   */
  actionItems?: ExtractedActionItem[];
}

export interface ExtractedActionItem {
  title: string;
  description: string | null;
  assignee: string;
  priority: Priority;
  due_date: string | null;
  source_timestamp_sec: number | null;
  /** Linked project / goal object (knowledge_items.id) and its title. */
  project_item_id?: string | null;
  project_title?: string | null;
  /** "today" | "this_week" | "later" | YYYY-MM-DD. */
  timeframe?: string | null;
  /** One short sentence: why / where from. */
  context?: string | null;
}

export interface IngestionAdapter {
  readonly id: string;
  canHandle(input: RawIngestInput): boolean;
  extract(input: RawIngestInput): Promise<ExtractedPayload>;
}

export const isHttpUrl = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

export const fileExtension = (input: RawIngestInput): string | undefined => {
  const m = input.fileName?.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1];
};
