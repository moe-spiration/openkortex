import { z } from "zod";
import { KNOWLEDGE_ITEM_TYPES, type ItemStatus, type KnowledgeItemType } from "@kortex/db";

// Request/response contract of POST /api/ingest.
// `web_clip`, `highlight` and `ai_chat` mirror apps/extension/src/lib/api.ts exactly
// (a test drives the extension's own client against this route). `note` and multipart
// file uploads are for the web app, desktop and mobile capture.

export const AI_MEMORIES_FOLDER = "40_AI_Memories";
export const INBOX_FOLDER = "00_Inbox";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Field limits of the JSON kinds. The extension mirrors them in `apps/extension/src/lib/limits.ts`
 * (a web test asserts both tables are equal) and trims client-side, so a capture is never refused
 * for length alone. Exceeding one still yields 400 `invalid_request` with the zod issue in `details`.
 */
export const INGEST_LIMITS = {
  url: 4096,
  imageUrl: 4096,
  title: 500,
  description: 5000,
  siteName: 200,
  note: 20_000,
  quote: 20_000,
  noteText: 20_000,
  contentMd: 2_000_000,
  folderPath: 300,
  tags: 30,
  tagLength: 100,
} as const;

/**
 * Media caps, kept apart from INGEST_LIMITS (which the extension mirrors 1:1). The extension cuts
 * the transcript text to transcriptText itself (TRANSCRIPT_MAX_CHARS); the rest is trimmed here.
 */
export const MEDIA_LIMITS = {
  transcriptText: 400_000,
  transcriptSegments: 20_000,
  transcriptSegmentText: 5_000,
  mediaChannel: 200,
} as const;

/**
 * Transcript the client already has (YouTube captions read in the browser, a page's transcript,
 * or user text). Shared contract with apps/extension/src/lib/api.ts.
 */
export const ClientTranscriptSchema = z.object({
  text: z.string().max(MEDIA_LIMITS.transcriptText),
  lang: z.string().trim().max(20).optional(),
  source: z.enum(["youtube-captions", "page", "user"]),
  segments: z
    .array(
      z.object({
        start: z.number().min(0).max(1_000_000),
        dur: z.number().min(0).max(1_000_000).optional(),
        text: z.string().transform((t) => t.slice(0, MEDIA_LIMITS.transcriptSegmentText)),
      }),
    )
    // Lenient: a very long caption track is cut, not refused.
    .transform((a) => a.slice(0, MEDIA_LIMITS.transcriptSegments))
    .optional(),
});

/** What the client knows about the media. Shared contract with apps/extension/src/lib/api.ts. */
export const MediaInfoSchema = z.object({
  kind: z.enum(["video", "podcast", "audio"]),
  provider: z.enum(["youtube", "spotify", "apple", "other"]).optional(),
  duration_sec: z.number().min(0).max(1_000_000).optional(),
  channel: z
    .string()
    .trim()
    .transform((c) => c.slice(0, MEDIA_LIMITS.mediaChannel))
    .optional(),
  published_at: z.string().max(40).optional(),
});

const httpUrl = z
  .string()
  .max(INGEST_LIMITS.url)
  .refine((v) => {
    try {
      return /^https?:$/.test(new URL(v).protocol);
    } catch {
      return false;
    }
  }, "must be an http(s) URL");

const tags = z.array(z.string().trim().min(1).max(INGEST_LIMITS.tagLength)).max(INGEST_LIMITS.tags);
const folderPath = z.string().trim().min(1).max(INGEST_LIMITS.folderPath);

/**
 * Optional client-generated key (the extension sends a UUID and reuses it for every retry of the
 * same capture). A repeated key for the same URL never creates or appends a second time: the
 * server answers with the original item and `replayed: true`. Honoured for `web_clip`,
 * `highlight` and `ai_chat`.
 */
export const IDEMPOTENCY_KEY = /^[\w.:-]{8,128}$/;
const idempotencyKey = z
  .string()
  .regex(IDEMPOTENCY_KEY, "8-128 chars: letters, digits, _ . : -")
  .optional();

/**
 * Length of the AI summary (feedback C1, clipper setting "Detailgrad"). Optional on every JSON kind;
 * missing means "concise" (the 2-3 sentence TL;DR). "detailed" asks for a longer summary and more
 * key points. Shared contract with apps/extension/src/lib/api.ts.
 */
export const SUMMARY_LEVELS = ["concise", "detailed"] as const;
export type SummaryLevel = (typeof SUMMARY_LEVELS)[number];

const base = {
  client: z.object({ name: z.string().max(100), version: z.string().max(50) }).optional(),
  captured_at: z.string().max(40).optional(),
  summary_level: z.enum(SUMMARY_LEVELS).optional(),
};

export const WebClipSchema = z.object({
  ...base,
  kind: z.literal("web_clip"),
  url: httpUrl,
  idempotency_key: idempotencyKey,
  title: z.string().trim().min(1).max(INGEST_LIMITS.title),
  description: z.string().max(INGEST_LIMITS.description).nullish(),
  image_url: httpUrl.max(INGEST_LIMITS.imageUrl).nullish(),
  site_name: z.string().max(INGEST_LIMITS.siteName).nullish(),
  note: z.string().max(INGEST_LIMITS.note).nullish(),
  folder_path: folderPath.nullish(),
  tags: tags.optional(),
  type_hint: z.enum(KNOWLEDGE_ITEM_TYPES).optional(),
  transcript: ClientTranscriptSchema.nullish(),
  media: MediaInfoSchema.nullish(),
});

export const HighlightLocatorSchema = z.object({
  v: z.literal(1),
  quote: z.object({ exact: z.string(), prefix: z.string(), suffix: z.string() }),
  position: z.object({ start: z.number().int(), end: z.number().int() }),
  range: z.object({
    startXPath: z.string(),
    startOffset: z.number().int(),
    endXPath: z.string(),
    endOffset: z.number().int(),
  }),
});

export const HighlightSchema = z.object({
  ...base,
  kind: z.literal("highlight"),
  idempotency_key: idempotencyKey,
  url: httpUrl,
  page_title: z.string().trim().min(1).max(INGEST_LIMITS.title),
  quote_text: z.string().trim().min(1).max(INGEST_LIMITS.quote),
  note_text: z.string().max(INGEST_LIMITS.noteText).nullish(),
  color: z.string().max(30).optional(),
  locator: HighlightLocatorSchema,
});

export const AiChatSchema = z.object({
  ...base,
  kind: z.literal("ai_chat"),
  idempotency_key: idempotencyKey,
  platform: z.enum(["chatgpt", "claude"]),
  scope: z.enum(["chat", "answer"]),
  url: httpUrl,
  title: z.string().trim().min(1).max(INGEST_LIMITS.title),
  content_md: z.string().min(1).max(INGEST_LIMITS.contentMd),
  message_count: z.number().int().min(0),
  folder_path: z.literal(AI_MEMORIES_FOLDER),
  tags: tags.optional(),
});

/** Quick capture from the web app / desktop / mobile: a thought, optionally with a URL. */
export const NoteSchema = z.object({
  ...base,
  kind: z.literal("note"),
  content_md: z.string().trim().min(1).max(500_000),
  title: z.string().trim().min(1).max(500).optional(),
  folder_path: folderPath.nullish(),
  tags: tags.optional(),
  type_hint: z.enum(KNOWLEDGE_ITEM_TYPES).optional(),
});

export const IngestRequestSchema = z.discriminatedUnion("kind", [
  WebClipSchema,
  HighlightSchema,
  AiChatSchema,
  NoteSchema,
]);

export type WebClipRequest = z.infer<typeof WebClipSchema>;
export type HighlightRequest = z.infer<typeof HighlightSchema>;
export type AiChatRequest = z.infer<typeof AiChatSchema>;
export type NoteRequest = z.infer<typeof NoteSchema>;
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

/** multipart/form-data upload: `file` plus optional `folder_path`, `tags` (comma list or repeated), `title`, `note`. */
export interface FileIngestRequest {
  kind: "file";
  file: { name: string; type: string; bytes: Uint8Array };
  folder_path?: string | null;
  tags?: string[];
  title?: string;
  note?: string;
}

export type IngestKind = IngestRequest["kind"] | "file";

export interface IngestSuccess {
  ok: true;
  kind: IngestKind;
  item_id: string;
  highlight_id?: string;
  type: KnowledgeItemType;
  status: ItemStatus;
  folder_path: string;
  /** True when the AI organizer places the item (no explicit folder given). */
  auto_routed: boolean;
  /** True when the URL/chat already existed and was merged. */
  duplicate: boolean;
  /** Vault file name for ai_chat items (`YYYY-MM-DD_topic-slug.md`). */
  file?: string;
  suggested_tags?: string[];
  /** True when AI processing was queued and continues after this response. */
  queued: boolean;
  /** True when the request carried an `idempotency_key` seen before: nothing was written again. */
  replayed?: boolean;
}

/** GET /api/ingest (connection test) and GET /api/ingest?item_id=… (status poll). */
export interface IngestStatusResponse {
  ok: true;
  user_id: string;
  /** Name of the personal token that made the call ("Verbindung testen" shows it). */
  token_name?: string;
  item?: {
    item_id: string;
    status: ItemStatus;
    type: KnowledgeItemType;
    title: string;
    folder_path: string;
    error?: string;
    /**
     * Zero-setup placement once processed: `auto` = filed without review (confidence at or above
     * user_settings.auto_place_threshold), otherwise it waits in the Inbox for "Übernehmen".
     */
    placement?: { confidence: number | null; decision: "auto" | "review" | "manual" };
  };
}

const SUPPORTED_FILE =
  /^(application\/pdf|application\/epub\+zip|image\/(png|jpe?g|webp|gif|heic|heif|avif))$/i;
const SUPPORTED_EXT = /\.(pdf|epub|png|jpe?g|webp|gif|heic|heif|avif)$/i;

/** Types that a browser would run as a document (SVG with script, HTML): never accepted. */
const ACTIVE_TYPE = /svg|html|xml|javascript/i;

export const isSupportedUpload = (name: string, type: string) =>
  !ACTIVE_TYPE.test(type) &&
  !/\.svgz?$/i.test(name) &&
  (SUPPORTED_FILE.test(type) || SUPPORTED_EXT.test(name));

const TYPE_BY_EXT: Record<string, string> = {
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
};

/**
 * Content type stored with the upload: the client's type only when it is on the allowlist, else
 * the one for the file extension. The stored file is served with this type, so a renamed SVG or
 * HTML file can never come back as an active document.
 */
export function uploadContentType(name: string, type: string): string {
  if (SUPPORTED_FILE.test(type)) return type.toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

export function initialTypeForFile(name: string, type: string): KnowledgeItemType {
  if (/pdf/i.test(type) || /\.pdf$/i.test(name)) return "pdf";
  if (/epub/i.test(type) || /\.epub$/i.test(name)) return "epub";
  return "image";
}
