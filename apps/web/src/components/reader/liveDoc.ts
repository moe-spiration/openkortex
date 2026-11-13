import type { KnowledgeItem } from "@/lib/mock/types";
import type { ReaderDoc, ReaderFormat, ReadingState } from "./mockDoc";

/*
 * ReaderDoc of a live knowledge item (pdf/epub with a stored original). Pure: no React, no
 * Supabase, so the server action (lib/api/reader-actions.ts) and the tests share it.
 * The file URL is not part of the item: the reader signs it on demand (getReaderFileUrl).
 */

/** Storage bucket of uploaded originals; a path whose first segment starts with "kortex-" names its own. */
export const DEFAULT_DOC_BUCKET = "kortex-documents";

/** knowledge_items.file_storage_path → bucket + object key. Null for an empty path. */
export function splitStoragePath(path: string): { bucket: string; key: string } | null {
  const clean = path.trim().replace(/^\/+/, "");
  if (!clean) return null;
  const slash = clean.indexOf("/");
  const first = slash === -1 ? clean : clean.slice(0, slash);
  if (first.startsWith("kortex-") && slash !== -1) {
    const key = clean.slice(slash + 1);
    return key ? { bucket: first, key } : null;
  }
  return { bucket: DEFAULT_DOC_BUCKET, key: clean };
}

/** Reader format of a stored file (mime first, then the extension); null when neither pdf nor epub. */
export function readerFormatOf(mime: string | null | undefined, path: string): ReaderFormat | null {
  const p = path.toLowerCase();
  if (mime === "application/pdf" || p.endsWith(".pdf")) return "pdf";
  if (mime === "application/epub+zip" || p.endsWith(".epub")) return "epub";
  return null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * reading_state jsonb → ReadingState, or null when it is unusable. A state saved for a format the
 * document doesn't have keeps its page but drops the CFI.
 */
export function parseReadingState(raw: unknown, formats: readonly ReaderFormat[]): ReadingState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !formats.length) return null;
  const r = raw as Record<string, unknown>;
  const page = num(r.page);
  const cfi = typeof r.cfi === "string" && r.cfi ? r.cfi : undefined;
  if (page === null && !cfi) return null;
  const sameFormat = formats.includes(r.format as ReaderFormat);
  const format = sameFormat ? (r.format as ReaderFormat) : formats[0]!;
  return {
    format,
    page: page !== null && page >= 1 ? Math.floor(page) : 1,
    ...(cfi && sameFormat ? { cfi } : {}),
    progress: Math.min(1, Math.max(0, num(r.progress) ?? 0)),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

export type LiveDocItem = Pick<KnowledgeItem, "id" | "path" | "title" | "reader" | "source" | "readingState">;

/** ReaderDoc of a live item, or null when it has no stored pdf/epub. */
export function liveReaderDoc(item: LiveDocItem): ReaderDoc | null {
  const file = item.source?.file;
  if (!item.reader || !file?.path) return null;
  const format = file.format === "pdf" || file.format === "epub" ? file.format : readerFormatOf(file.mime, file.path);
  if (!format) return null;
  const count = num(item.source?.pageCount);
  // EPUBs from the pipeline carry no page anchors: positions are CFIs, pages are not shown.
  const paged = format === "pdf";
  const total = paged && count !== null && count > 0 ? Math.floor(count) : 0;
  const saved = parseReadingState(item.readingState, [format]);
  const page = paged && saved ? (total ? Math.min(total, saved.page) : saved.page) : 1;
  const fileName = item.source?.fileName?.trim() || file.path.split("/").pop() || item.title;
  return {
    noteId: item.id,
    folder: item.path.split("/").slice(0, -1).join("/"),
    formats: [format],
    fileName: { [format]: fileName },
    url: {},
    live: true,
    paged,
    pageOffset: 0,
    firstPage: 1,
    lastPage: total,
    totalPages: total,
    anchorPage: page,
    epubAnchors: {},
    seedHighlights: [],
    explanation: null,
    savedState: saved ? { ...saved, page } : null,
  };
}
