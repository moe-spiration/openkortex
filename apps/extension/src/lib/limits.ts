// Client-side enforcement of the server's field limits (apps/web/src/server/ingest/contract.ts,
// INGEST_LIMITS; a web test asserts both tables are identical). A capture is trimmed instead of
// being refused, and the user is told what was cut.
import { intlLocale, t } from "../i18n";
import type { IngestRequest, Transcript } from "./api";

export const LIMITS = {
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

/** Transcript text cap (shared contract with the media pipeline); not part of INGEST_LIMITS. */
export const TRANSCRIPT_MAX_CHARS = 400_000;

const ELLIPSIS = "…";
const fmt = (n: number) => n.toLocaleString(intlLocale());

export function truncate(text: string, max: number): { value: string; cut: boolean } {
  if (text.length <= max) return { value: text, cut: false };
  return { value: `${text.slice(0, max - 1).trimEnd()}${ELLIPSIS}`, cut: true };
}

/** http(s) only and short enough; anything else (data: URIs, blob:, huge URLs) is dropped. */
export function fitImageUrl(value: string | null | undefined): string | null {
  if (!value || value.length > LIMITS.imageUrl) return null;
  try {
    return /^https?:$/.test(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
}

/** Over-long URLs lose fragment and query first (tracking noise); null when still too long. */
export function fitUrl(value: string): string | null {
  if (value.length <= LIMITS.url) return value;
  try {
    const u = new URL(value);
    u.hash = "";
    if (u.toString().length > LIMITS.url) u.search = "";
    return u.toString().length <= LIMITS.url ? u.toString() : null;
  } catch {
    return null;
  }
}

const TRANSCRIPT_NOTICE = (max: number) => `\n\n> ${t("Note: export shortened (limit {max} characters)", { max: fmt(max) })}`;

/** Cuts a `### User` / `### Assistant` transcript at a message boundary and appends a note. */
export function fitTranscript(md: string, max: number = LIMITS.contentMd): { value: string; cut: boolean } {
  if (md.length <= max) return { value: md, cut: false };
  const notice = TRANSCRIPT_NOTICE(max);
  let head = md.slice(0, max - notice.length);
  const boundary = Math.max(head.lastIndexOf("\n\n### User"), head.lastIndexOf("\n\n### Assistant"));
  if (boundary > 0) head = head.slice(0, boundary);
  return { value: `${head.trimEnd()}${notice}`, cut: true };
}

const transcriptCutNote = () => `\n\n[${t("Transcript shortened")}]`;

/** Cuts a transcript at a segment boundary (or word) so the text stays within `max`, with a visible note. */
export function fitTranscriptText(tr: Transcript, max: number = TRANSCRIPT_MAX_CHARS): { value: Transcript; cut: boolean } {
  if (tr.text.length <= max) return { value: tr, cut: false };
  const note = transcriptCutNote();
  const room = max - note.length;
  let text = tr.text.slice(0, room);
  const space = text.lastIndexOf(" ");
  if (space > room * 0.9) text = text.slice(0, space);
  text = text.trimEnd();
  let segments: Transcript["segments"];
  if (tr.segments) {
    let used = 0;
    segments = [];
    for (const s of tr.segments) {
      used += s.text.length + 1;
      if (used > text.length) break;
      segments.push(s);
    }
  }
  return { value: { ...tr, text: text + note, ...(segments ? { segments } : {}) }, cut: true };
}

export function fitTags(tags: readonly string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  return [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= LIMITS.tagLength))].slice(
    0,
    LIMITS.tags,
  );
}

export interface Fitted {
  request: IngestRequest;
  /** User-visible notes about what was shortened. */
  notices: string[];
  /** Set when the request cannot be made to fit (shown instead of sending). */
  error?: string;
}

/** Returns a copy of the request that satisfies the server limits. Never mutates the input. */
export function applyLimits(input: IngestRequest): Fitted {
  const notices: string[] = [];
  const cut = (label: string, max: number) => notices.push(t("{field} shortened to {max} characters", { field: label, max: fmt(max) }));
  const fit = (value: string, max: number, label: string): string => {
    const r = truncate(value, max);
    if (r.cut) cut(label, max);
    return r.value;
  };

  if (input.kind === "note") {
    const body = fitTranscript(input.content_md);
    if (body.cut) notices.push(t("Text shortened to {max} characters", { max: fmt(LIMITS.contentMd) }));
    return {
      notices,
      request: { ...input, title: fit(input.title.trim(), LIMITS.title, t("Title")), content_md: body.value, tags: fitTags(input.tags) },
    };
  }

  const url = fitUrl(input.url);
  if (!url) return { request: input, notices, error: t("The address is longer than {max} characters.", { max: fmt(LIMITS.url) }) };
  if (url !== input.url) notices.push(t("Address saved without parameters (too long)"));

  switch (input.kind) {
    case "web_clip": {
      if (input.folder_path && input.folder_path.length > LIMITS.folderPath) {
        return { request: input, notices, error: t("The folder path is longer than {max} characters.", { max: LIMITS.folderPath }) };
      }
      const transcript = input.transcript ? fitTranscriptText(input.transcript) : null;
      if (transcript?.cut) notices.push(t("Transcript shortened to {max} characters", { max: fmt(TRANSCRIPT_MAX_CHARS) }));
      return {
        notices,
        request: {
          ...input,
          ...(transcript ? { transcript: transcript.value } : {}),
          url,
          title: fit(input.title.trim(), LIMITS.title, t("Title")),
          description: input.description ? fit(input.description, LIMITS.description, t("Description")) : null,
          image_url: fitImageUrl(input.image_url),
          site_name: input.site_name ? truncate(input.site_name, LIMITS.siteName).value : null,
          note: input.note ? fit(input.note, LIMITS.note, t("Note")) : null,
          tags: fitTags(input.tags),
        },
      };
    }
    case "highlight": {
      if (input.quote_text.length > LIMITS.quote) {
        return { request: input, notices, error: t("The selection is longer than {max} characters.", { max: fmt(LIMITS.quote) }) };
      }
      return {
        notices,
        request: {
          ...input,
          url,
          page_title: fit(input.page_title.trim(), LIMITS.title, t("Page title")),
          note_text: input.note_text ? fit(input.note_text, LIMITS.noteText, t("Note")) : null,
        },
      };
    }
    case "ai_chat": {
      const transcript = fitTranscript(input.content_md);
      if (transcript.cut) notices.push(t("Chat shortened to {max} characters (the rest is dropped)", { max: fmt(LIMITS.contentMd) }));
      return {
        notices,
        request: {
          ...input,
          url,
          title: fit(input.title.trim(), LIMITS.title, t("Title")),
          content_md: transcript.value,
          tags: fitTags(input.tags),
        },
      };
    }
  }
}
