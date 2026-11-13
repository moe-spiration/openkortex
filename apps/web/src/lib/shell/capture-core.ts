import { t } from "@/i18n";
import type { IconId } from "@/components/shell/icons";
import type { InboxJob } from "@/lib/workspace-data";
import type { IngestStatusResponse } from "@/lib/api/client";
import type { IngestRequest } from "@/server/ingest/contract";

/*
 * Pure part of the capture flow (no React): job shape, what a dropped text becomes, and the
 * status poll. `useCapture` in ./capture.ts wires it to the shell store and /api/ingest.
 */

export type CaptureStatus = "sending" | "inbox" | "processing" | "processed" | "error";

/** One capture as the shell shows it (footbar, palette, inbox drop, voice). Extends the inbox row shape. */
export interface CaptureJob extends InboxJob {
  /** Client id (stable from the first optimistic render). */
  id: string;
  /** knowledge_items.id once the server accepted it (live mode). */
  itemId: string | null;
  status: CaptureStatus;
  folderPath?: string;
  error?: string;
  createdAt: number;
}

/** Item type a text capture may carry (voice note, or the type of the target space). */
export type CaptureTypeHint = NonNullable<Extract<IngestRequest, { kind: "note" }>["type_hint"]>;

/** Options of a text capture (Orbit-Bar: Ziel-Chip, #tags, the note to a link chip). */
export interface TextCaptureOpts {
  title?: string;
  typeHint?: CaptureTypeHint;
  folderPath?: string;
  /** Structured tags (the text keeps its #tags as well). */
  tags?: string[];
  /** Note to a web clip (link chip plus text in the field). */
  note?: string;
}

/** What can be captured. Text that is only a URL becomes a web clip, any other text a note. */
export type CaptureInput = ({ text: string } & TextCaptureOpts) | { file: File };

export const ACTIVE_STATUSES: readonly CaptureStatus[] = ["sending", "inbox", "processing"];
export const isActive = (j: Pick<CaptureJob, "status">) => ACTIVE_STATUSES.includes(j.status);

const URL_ONLY = /^https?:\/\/\S+$/i;

export const shorten = (s: string, n = 56) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

/** Ingest request for a text capture: a lone http(s) URL is a web clip, everything else a note. */
export function textRequest(text: string, opts: TextCaptureOpts = {}): IngestRequest {
  const t = text.trim();
  const client = { name: "kortex-web", version: "1" };
  const captured_at = new Date().toISOString();
  if (URL_ONLY.test(t)) {
    let title = t;
    try {
      const u = new URL(t);
      title = (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).slice(0, 200) || t;
    } catch {
      /* the regex already guarantees a URL-ish string; keep it as the title */
    }
    return {
      kind: "web_clip",
      url: t,
      title,
      client,
      captured_at,
      ...(opts.folderPath ? { folder_path: opts.folderPath } : {}),
      ...(opts.note?.trim() ? { note: opts.note.trim() } : {}),
      ...(opts.tags?.length ? { tags: opts.tags } : {}),
    };
  }
  return {
    kind: "note",
    content_md: t,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.typeHint ? { type_hint: opts.typeHint } : {}),
    ...(opts.folderPath ? { folder_path: opts.folderPath } : {}),
    ...(opts.tags?.length ? { tags: opts.tags } : {}),
    client,
    captured_at,
  };
}

/** Files /api/ingest accepts as uploads (mirrors server/ingest/contract.ts). */
const UPLOAD_TYPE = /^(application\/pdf|application\/epub\+zip|image\/(png|jpe?g|webp|gif|heic|heif|avif))$/i;
const UPLOAD_EXT = /\.(pdf|epub|png|jpe?g|webp|gif|heic|heif|avif)$/i;
/** Plain text files are read in the browser and sent as a note. */
const TEXT_EXT = /\.(md|markdown|txt)$/i;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type FilePlan = { kind: "upload" } | { kind: "text" } | { kind: "unsupported"; reason: string };

export function planFile(file: Pick<File, "name" | "type" | "size">): FilePlan {
  if (TEXT_EXT.test(file.name) || file.type === "text/plain" || file.type === "text/markdown") return { kind: "text" };
  if (!(UPLOAD_TYPE.test(file.type) || UPLOAD_EXT.test(file.name)))
    return { kind: "unsupported", reason: t("File type is not supported (PDF, EPUB, images, Markdown, text)") };
  if (file.size > MAX_UPLOAD_BYTES) return { kind: "unsupported", reason: t("File is larger than 50 MB") };
  return { kind: "upload" };
}

export function iconForFile(name: string): IconId {
  if (/\.(pdf|epub)$/i.test(name)) return "i-book";
  if (/\.(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(name)) return "image";
  return "i-note";
}

/** Inbox row text for a status. */
export function stepFor(status: CaptureStatus, folderPath?: string): { step: string; pct: number } {
  switch (status) {
    case "sending":
      return { step: t("Sending"), pct: 6 };
    case "inbox":
      return { step: t("In the queue"), pct: 18 };
    case "processing":
      return { step: t("AI processing"), pct: 60 };
    case "processed":
      return { step: folderPath ? t("Filed in {folder}", { folder: folderPath }) : t("Processed"), pct: 100 };
    case "error":
      return { step: t("Error"), pct: 100 };
  }
}

/** Poll delays: quick at first (notes finish in seconds), then every 4 s; give up after ~10 min. */
export const POLL_DELAYS_MS = [1200, 1800, 2500, 3000];
export const POLL_STEADY_MS = 4000;
export const POLL_MAX_MS = 10 * 60 * 1000;

type Item = NonNullable<IngestStatusResponse["item"]>;

/**
 * Polls `fetchStatus` until the item is processed or failed (or the time budget runs out).
 * Calls `onUpdate` on every status change. Resolves with the last item seen.
 */
export async function pollItem(
  fetchStatus: () => Promise<Item | undefined>,
  onUpdate: (item: Item) => void,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => number; signal?: AbortSignal } = {},
): Promise<Item | undefined> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  let last: Item | undefined;
  let failures = 0;
  for (let i = 0; now() - start < POLL_MAX_MS; i++) {
    await sleep(POLL_DELAYS_MS[i] ?? POLL_STEADY_MS);
    if (opts.signal?.aborted) return last;
    let item: Item | undefined;
    try {
      item = await fetchStatus();
      failures = 0;
    } catch (err) {
      // A few network hiccups are fine; a persistent failure ends the poll.
      if (++failures >= 5) throw err;
      continue;
    }
    if (!item) continue;
    if (!last || last.status !== item.status || last.title !== item.title) onUpdate(item);
    last = item;
    if (item.status === "processed" || item.status === "error" || item.status === "archived") return item;
  }
  return last;
}
