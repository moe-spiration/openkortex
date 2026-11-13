import { t } from "../../i18n";
import type { TranscriptSegment } from "../api";
import { isoDate, meta } from "./dom";
import type { Extracted, Extractor, ExtractContext } from "./types";

/* YouTube: video id from the address, cover from i.ytimg.com, details and caption tracks from the
   player response (inline in the page, or fetched fresh from the watch page after in-app navigation),
   captions as json3 from the page's own origin. */

export function videoIdOf(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export const thumbnailCandidates = (id: string) =>
  ["maxresdefault", "sddefault", "hqdefault"].map((n) => `https://i.ytimg.com/vi/${id}/${n}.jpg`);

/** `{...}` starting at the first `{` at or after `from`, string- and escape-aware; null if unbalanced. */
export function jsonObjectAt(source: string, from: number): string | null {
  const start = source.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** `asr` = automatically generated. */
  kind?: string;
  name?: { simpleText?: string };
}

export interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string; author?: string; lengthSeconds?: string; shortDescription?: string };
  microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string; ownerChannelName?: string; lengthSeconds?: string } };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[]; audioTracks?: { defaultCaptionTrackIndex?: number }[] };
  };
}

export function parsePlayerResponse(source: string): PlayerResponse | null {
  const at = source.search(/ytInitialPlayerResponse\s*=/);
  if (at < 0) return null;
  const raw = jsonObjectAt(source, at);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlayerResponse;
  } catch {
    return null;
  }
}

/** Manual captions in German, then English, then any manual one; then the automatic ones the same way. */
export function pickTrack(tracks: readonly CaptionTrack[]): CaptionTrack | null {
  const rank = (t: CaptionTrack) => {
    const manual = t.kind !== "asr";
    const lang = t.languageCode.toLowerCase().split("-")[0];
    const langRank = lang === "de" ? 0 : lang === "en" ? 1 : 2;
    return (manual ? 0 : 3) + langRank;
  };
  return [...tracks].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}

export function parseJson3(raw: string): TranscriptSegment[] {
  let data: Json3;
  try {
    data = JSON.parse(raw) as Json3;
  } catch {
    return [];
  }
  const out: TranscriptSegment[] = [];
  for (const e of data.events ?? []) {
    const line = (e.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!line || e.tStartMs === undefined) continue;
    out.push({
      start: Math.round(e.tStartMs) / 1000,
      ...(e.dDurationMs ? { dur: Math.round(e.dDurationMs) / 1000 } : {}),
      text: line,
    });
  }
  return out;
}

export function durationMinutes(segments: readonly TranscriptSegment[], text: string): number {
  const last = segments[segments.length - 1];
  const sec = last ? last.start + (last.dur ?? 0) : (text.split(/\s+/).length / 150) * 60;
  return Math.max(1, Math.round(sec / 60));
}

/* --- fallback: the transcript panel -----------------------------------------------------------------
   Since 2025 the caption URLs of the page answer 200 with an empty body unless the request carries a
   proof-of-origin token that only the player can mint. The "Transkript anzeigen" panel loads through
   the page's own code (tokens included), so opening it and reading the lines works without one. */

/** "1:02:05" / "0:18" to seconds; null for anything else. */
export function parseClock(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const SEGMENT = "transcript-segment-view-model, ytd-transcript-segment-renderer";

/** Lines of an open transcript panel (new view-model markup and the older renderer). */
export function readPanelSegments(doc: Document): TranscriptSegment[] {
  const raw: { start: number; text: string }[] = [];
  for (const el of doc.querySelectorAll(SEGMENT)) {
    const start = parseClock(el.querySelector(".ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp")?.textContent ?? "");
    const text = (el.querySelector(".ytAttributedStringHost, .yt-core-attributed-string, .segment-text")?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (start !== null && text) raw.push({ start, text });
  }
  return raw.map((s, i) => {
    const next = raw[i + 1];
    return { start: s.start, ...(next && next.start > s.start ? { dur: next.start - s.start } : {}), text: s.text };
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Opens the transcript panel when needed, waits until the lines stop growing, closes it again. */
export async function readTranscriptPanel(doc: Document, wait: (ms: number) => Promise<void> = sleep, budgetMs = 9000): Promise<TranscriptSegment[]> {
  let opened = false;
  if (!doc.querySelector(SEGMENT)) {
    doc.querySelector<HTMLElement>("tp-yt-paper-button#expand, #description-inline-expander #expand")?.click();
    let open: HTMLElement | null = null;
    for (let i = 0; i < 10 && !open; i++) {
      await wait(300);
      open = doc.querySelector<HTMLElement>("ytd-video-description-transcript-section-renderer button");
    }
    if (!open) return [];
    open.click();
    opened = true;
  }
  let last = -1;
  for (let waited = 0; waited < budgetMs; waited += 300) {
    await wait(300);
    const n = doc.querySelectorAll(SEGMENT).length;
    if (n > 0 && n === last) break;
    last = n;
  }
  const segments = readPanelSegments(doc);
  if (opened) {
    doc.querySelector<HTMLElement>('ytd-engagement-panel-section-list-renderer[target-id*="transcript"] #visibility-button button')?.click();
    doc.querySelector<HTMLElement>("tp-yt-paper-button#collapse, #description-inline-expander #collapse")?.click();
  }
  return segments;
}

async function loadPlayerResponse(ctx: ExtractContext, id: string): Promise<PlayerResponse | null> {
  const inline = [...ctx.doc.querySelectorAll("script:not([src])")]
    .map((s) => s.textContent ?? "")
    .filter((t) => t.includes("ytInitialPlayerResponse"))
    .map(parsePlayerResponse)
    .find((r) => r?.videoDetails?.videoId === id);
  if (inline) return inline;
  // In-app navigation leaves the first page's player data behind: read the watch page afresh.
  try {
    const html = await ctx.fetchText(`https://www.youtube.com/watch?v=${id}`);
    const fresh = parsePlayerResponse(html);
    return fresh?.videoDetails?.videoId === id ? fresh : null;
  } catch {
    return null;
  }
}

export const youtube: Extractor = {
  id: "youtube",
  matches: (url) => videoIdOf(url) !== null,
  async extract(ctx) {
    const id = videoIdOf(new URL(ctx.url))!;
    const out: Extracted = { images: thumbnailCandidates(id), site_name: "YouTube" };
    const player = await loadPlayerResponse(ctx, id);
    const details = player?.videoDetails;
    const micro = player?.microformat?.playerMicroformatRenderer;
    const duration = Number(details?.lengthSeconds ?? micro?.lengthSeconds);
    const channel = details?.author ?? micro?.ownerChannelName ?? meta(ctx.doc, "author") ?? undefined;
    const published = isoDate(micro?.publishDate ?? micro?.uploadDate) ?? isoDate(meta(ctx.doc, "datePublished", "uploadDate"));
    out.media = {
      kind: "video",
      provider: "youtube",
      ...(duration > 0 ? { duration_sec: duration } : {}),
      ...(channel ? { channel } : {}),
      ...(published ? { published_at: published } : {}),
    };
    if (details?.title) out.title = details.title;
    if (details?.shortDescription) out.description = details.shortDescription.slice(0, 600);

    const track = pickTrack(player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
    if (!track) {
      out.notes = [t("No captions found")];
      return out;
    }
    let segments: TranscriptSegment[] = [];
    let lang = track.languageCode;
    try {
      const url = new URL(track.baseUrl);
      url.searchParams.set("fmt", "json3");
      segments = parseJson3(await ctx.fetchText(url.href));
    } catch {
      /* fall through to the panel */
    }
    if (segments.length === 0) {
      segments = await readTranscriptPanel(ctx.doc).catch(() => []);
      // the panel shows the video's default caption track, not necessarily the one picked above
      const list = player?.captions?.playerCaptionsTracklistRenderer;
      const index = list?.audioTracks?.[0]?.defaultCaptionTrackIndex;
      lang = (index !== undefined ? list?.captionTracks?.[index]?.languageCode : undefined) ?? lang;
    }
    if (segments.length === 0) {
      out.notes = [t("Captions could not be loaded")];
      return out;
    }
    out.transcript = {
      text: segments.map((s) => s.text).join(" "),
      lang,
      source: "youtube-captions",
      segments,
    };
    return out;
  },
};
