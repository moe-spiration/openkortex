import { acceptLanguage, byLocale, contentLanguages, ph, t } from "../i18n";
import type { AudioInput, AudioTranscriber, TranscriptSegment } from "../audio/transcriber";
import { AdapterDeclinedError, ExtractionError, NotImplementedAdapterError, errorMessage } from "../errors";
import {
  BROWSER_USER_AGENT,
  defaultFetch,
  requestJson,
  requestText,
  type FetchLike,
} from "../http";
import {
  clientSegments,
  clockStamp,
  generateMediaNotes,
  renderMediaNote,
  timedLines,
} from "../media/notes";
import type { ModelRouter } from "../router/model-router";
import type { ExtractedPayload, IngestionAdapter, RawIngestInput } from "./base-adapter";

const ID = "youtube";

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** "asr" for auto-generated captions. */
  kind?: string;
  name?: string;
}

export interface YouTubeVideoInfo {
  videoId: string;
  title: string;
  channel?: string;
  durationSec?: number;
  description?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  captionTracks: CaptionTrack[];
}

/** Where video details and captions come from. Default: the innertube data on the watch page. */
export interface YouTubeDataSource {
  getVideoInfo(videoId: string): Promise<YouTubeVideoInfo>;
  getTranscript(track: CaptionTrack): Promise<TranscriptSegment[]>;
}

/** Downloads the audio track for the Whisper fallback. */
export interface YouTubeAudioSource {
  fetchAudio(videoId: string): Promise<AudioInput>;
}

/**
 * Stub: downloading YouTube audio needs yt-dlp or a signed stream URL, which we
 * do not ship yet. Plug in a real source (e.g. a worker running yt-dlp) later.
 */
export const notImplementedYouTubeAudioSource: YouTubeAudioSource = {
  async fetchAudio() {
    throw new NotImplementedAdapterError(ID, "audio download for the Whisper fallback");
  },
};

export interface YouTubeAdapterOptions {
  fetch?: FetchLike;
  dataSource?: YouTubeDataSource;
  /** Whisper fallback when no captions exist. Without it, the item keeps only the description. */
  whisperFallback?: { audioSource: YouTubeAudioSource; transcriber: AudioTranscriber };
  /** Caption language preference, best first. */
  languages?: string[];
  /** Fallback chapter length when the description has no chapter list. */
  autoChapterSec?: number;
  /** Writes the summary, chapters and takeaways (routed `summarize`). Without it: transcript only. */
  models?: ModelRouter;
}

export function parseYouTubeVideoId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  const valid = (v: string | null | undefined) => (v && /^[\w-]{11}$/.test(v) ? v : undefined);
  if (host === "youtu.be") return valid(u.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return valid(u.searchParams.get("v"));
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    return valid(m?.[1]);
  }
  return undefined;
}

/** `youtube.com/clip/<id>`: a shared clip; its video id is only on the clip page. */
export function isYouTubeClipUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      /^(?:www\.|m\.)?youtube\.com$/.test(u.hostname) && /^\/clip\/[\w-]+/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/** Video id behind a clip URL (`"videoId":"…"` on the clip page), or undefined. */
export async function resolveClipVideoId(
  url: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<string | undefined> {
  try {
    const res = await fetchFn(url, { headers: { "accept-language": "en" } });
    if (!res.ok) return undefined;
    const html = await res.text();
    return /"videoId":"([\w-]{11})"/.exec(html)?.[1];
  } catch {
    return undefined;
  }
}

// --- Default data source: ytInitialPlayerResponse on the watch page ----------

/** Extracts the JSON object literal assigned after `marker` (balanced braces, string-aware). */
export function extractJsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  const start = html.indexOf("{", at + marker.length);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    shortDescription?: string;
    thumbnail?: { thumbnails?: Array<{ url: string; width?: number }> };
  };
  microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string } };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl: string;
        languageCode: string;
        kind?: string;
        name?: { simpleText?: string; runs?: Array<{ text: string }> };
      }>;
    };
  };
}

interface Json3Captions {
  events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
}

export function createInnertubeDataSource(fetchFn: FetchLike = defaultFetch): YouTubeDataSource {
  return {
    async getVideoInfo(videoId) {
      const html = await requestText(
        fetchFn,
        ID,
        `https://www.youtube.com/watch?v=${videoId}&hl=de`,
        {
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            "Accept-Language": acceptLanguage(),
            // Skips the EU consent interstitial.
            Cookie: "CONSENT=YES+cb; SOCS=CAI",
          },
        },
      );
      const player = extractJsonAfter(html, "ytInitialPlayerResponse") as
        PlayerResponse | undefined;
      if (!player?.videoDetails) {
        throw new ExtractionError(ID, "watch page has no ytInitialPlayerResponse");
      }
      if (player.playabilityStatus?.status && player.playabilityStatus.status !== "OK") {
        throw new ExtractionError(
          ID,
          `video not playable: ${player.playabilityStatus.reason ?? player.playabilityStatus.status}`,
        );
      }
      const d = player.videoDetails;
      const thumbs = d.thumbnail?.thumbnails ?? [];
      const best = [...thumbs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      const mf = player.microformat?.playerMicroformatRenderer;
      return {
        videoId: d.videoId ?? videoId,
        title: d.title ?? videoId,
        channel: d.author,
        durationSec: d.lengthSeconds ? Number(d.lengthSeconds) : undefined,
        description: d.shortDescription,
        publishedAt: mf?.publishDate ?? mf?.uploadDate,
        thumbnailUrl: best?.url,
        captionTracks: (player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).map(
          (t) => ({
            baseUrl: t.baseUrl,
            languageCode: t.languageCode,
            kind: t.kind,
            name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text).join(""),
          }),
        ),
      };
    },

    async getTranscript(track) {
      // Web caption URLs need a PO token since 2025 (`exp=xpe`) and come back empty without one.
      const web = await json3Segments(fetchFn, track.baseUrl, BROWSER_USER_AGENT).catch(() => []);
      if (web.length) return web;
      // The Android app's player hands out caption URLs that still work without a token.
      const videoId = new URL(track.baseUrl, "https://www.youtube.com").searchParams.get("v");
      if (!videoId) throw new ExtractionError(ID, "captions: no video id in the track URL");
      const player = await requestJson<PlayerResponse>(fetchFn, ID, INNERTUBE_PLAYER_URL, {
        method: "POST",
        headers: { "User-Agent": ANDROID_USER_AGENT, "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: { ...ANDROID_CLIENT, ...byLocale({ en: { hl: "en", gl: "US" }, de: { hl: "de", gl: "DE" } }) },
          },
          videoId,
        }),
      });
      const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const alt =
        tracks.find((t) => t.languageCode === track.languageCode && t.kind === track.kind) ??
        tracks.find((t) => t.languageCode === track.languageCode);
      if (!alt) throw new ExtractionError(ID, "captions: track not offered to the app client");
      const segments = await json3Segments(fetchFn, alt.baseUrl, ANDROID_USER_AGENT);
      if (!segments.length) throw new ExtractionError(ID, "captions: empty caption track");
      return segments;
    },
  };
}

const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 };
const ANDROID_USER_AGENT = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";

/** Caption track in YouTube's json3 format → segments. */
async function json3Segments(
  fetchFn: FetchLike,
  baseUrl: string,
  userAgent: string,
): Promise<TranscriptSegment[]> {
  const url = new URL(baseUrl, "https://www.youtube.com");
  url.searchParams.set("fmt", "json3");
  const data = await requestJson<Json3Captions>(fetchFn, ID, url.toString(), {
    headers: { "User-Agent": userAgent },
  });
  const segments: TranscriptSegment[] = [];
  for (const ev of data.events ?? []) {
    const text = (ev.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const startSec = (ev.tStartMs ?? 0) / 1000;
    segments.push({ startSec, endSec: startSec + (ev.dDurationMs ?? 0) / 1000, text });
  }
  return segments;
}

// --- Chapters & formatting ---------------------------------------------------

export interface VideoChapter {
  title: string;
  startSec: number;
}

const TIMESTAMP = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/;

export const parseTimestamp = (ts: string): number | undefined => {
  const m = ts.match(TIMESTAMP);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/** YouTube-style chapter list in the description: first chapter at 0:00, at least two entries. */
export function parseChaptersFromDescription(description: string | undefined): VideoChapter[] {
  if (!description) return [];
  const chapters: VideoChapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(/^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|.]?\s*(.+?)\s*$/);
    if (!m?.[1] || !m[2]) continue;
    const startSec = parseTimestamp(m[1]);
    if (startSec === undefined) continue;
    const prev = chapters.at(-1);
    if (prev && startSec <= prev.startSec) continue;
    chapters.push({ title: m[2], startSec });
  }
  if (chapters.length < 2 || chapters[0]?.startSec !== 0) return [];
  return chapters;
}

export const formatTimestamp = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

/** Groups caption segments into timestamped lines (~30 s each) under their chapter. */
export function buildTranscriptSections(
  segments: readonly TranscriptSegment[],
  chapters: readonly VideoChapter[],
  lineSec = 30,
): Array<{ chapter: VideoChapter; lines: string[] }> {
  const sections = chapters.map((chapter) => ({ chapter, lines: [] as string[] }));
  let current: { start: number; parts: string[]; section: number } | undefined;
  const flush = () => {
    if (current && current.parts.length > 0) {
      sections[current.section]?.lines.push(
        `[${formatTimestamp(current.start)}] ${current.parts.join(" ")}`,
      );
    }
    current = undefined;
  };
  for (const seg of segments) {
    let idx = 0;
    for (let i = 0; i < chapters.length; i++) {
      if ((chapters[i]?.startSec ?? 0) <= seg.startSec) idx = i;
    }
    if (!current || current.section !== idx || seg.startSec - current.start >= lineSec) {
      flush();
      current = { start: seg.startSec, parts: [], section: idx };
    }
    current.parts.push(seg.text);
  }
  flush();
  return sections;
}

function pickTrack(
  tracks: readonly CaptionTrack[],
  languages: readonly string[],
): CaptionTrack | undefined {
  const score = (t: CaptionTrack) => {
    const lang = languages.findIndex((l) => t.languageCode.toLowerCase().startsWith(l));
    return (lang < 0 ? languages.length : lang) * 2 + (t.kind === "asr" ? 1 : 0);
  };
  return [...tracks].sort((a, b) => score(a) - score(b))[0];
}

// --- Adapter -----------------------------------------------------------------

export const YOUTUBE_OEMBED_URL = "https://www.youtube.com/oembed";

/**
 * Title, channel and thumbnail via oEmbed. Works from data-center IPs, where YouTube answers the
 * watch page and every innertube client with "Sign in to confirm you're not a bot".
 */
export async function oembedVideoInfo(
  videoId: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<YouTubeVideoInfo> {
  const o = await requestJson<{ title?: string; author_name?: string; thumbnail_url?: string }>(
    fetchFn,
    ID,
    `${YOUTUBE_OEMBED_URL}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
  );
  return {
    videoId,
    title: o.title?.trim() || videoId,
    channel: o.author_name,
    thumbnailUrl: o.thumbnail_url,
    captionTracks: [],
  };
}

/** Why a server could not read the video page (bot wall, consent, removed …). */
const blockedReason = (err: unknown) => {
  const m = errorMessage(err);
  return /not a bot|LOGIN_REQUIRED|no ytInitialPlayerResponse|consent/i.test(m)
    ? "youtube_blocked"
    : "player_failed";
};

export function createYouTubeAdapter(options: YouTubeAdapterOptions = {}): IngestionAdapter {
  const fetchFn = options.fetch ?? defaultFetch;
  const source = options.dataSource ?? createInnertubeDataSource(fetchFn);
  // Read per call: one adapter instance serves users of both languages.
  const languagePreference = () => options.languages ?? contentLanguages();

  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      parseYouTubeVideoId(input.url) !== undefined || isYouTubeClipUrl(input.url),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const videoId =
        parseYouTubeVideoId(input.url) ?? (await resolveClipVideoId(input.url as string, fetchFn));
      if (!videoId) throw new AdapterDeclinedError(ID, t("Clip link without a recognizable video"));
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const warnings: string[] = [];

      // 1. Video details: the watch page, else oEmbed (+ what the client sent).
      let info: YouTubeVideoInfo;
      let blocked: string | null = null;
      try {
        info = await source.getVideoInfo(videoId);
      } catch (err) {
        blocked = blockedReason(err);
        warnings.push(`player: ${errorMessage(err)}`);
        info = await oembedVideoInfo(videoId, fetchFn).catch((e: unknown) => {
          warnings.push(`oembed: ${errorMessage(e)}`);
          return { videoId, title: videoId, captionTracks: [] } as YouTubeVideoInfo;
        });
      }
      const media = input.media;
      const channel = info.channel ?? media?.channel;
      const publishedAt = info.publishedAt ?? media?.published_at;

      // 2. Transcript: from the client (browser captions) > server captions > Whisper fallback.
      let segments: TranscriptSegment[] = clientSegments(input.transcript);
      let transcriptSource = segments.length ? `client:${input.transcript!.source}` : "none";
      let transcriptLanguage = segments.length ? input.transcript!.lang : undefined;
      if (!segments.length && !blocked) {
        const track = pickTrack(info.captionTracks, languagePreference());
        if (track) {
          try {
            segments = await source.getTranscript(track);
            transcriptSource = "youtube_captions";
            transcriptLanguage = track.languageCode;
          } catch (err) {
            blocked = "captions_failed";
            warnings.push(`captions: ${errorMessage(err)}`);
          }
        } else warnings.push("captions: none available");
      }
      if (!segments.length && options.whisperFallback) {
        try {
          const audio = await options.whisperFallback.audioSource.fetchAudio(videoId);
          segments = await options.whisperFallback.transcriber.transcribe(audio);
          transcriptSource = "whisper";
        } catch (err) {
          warnings.push(`whisper: ${errorMessage(err)}`);
        }
      }

      const last = segments.at(-1);
      const duration =
        info.durationSec ?? media?.duration_sec ?? last?.endSec ?? last?.startSec ?? 0;
      const descChapters = parseChaptersFromDescription(info.description);

      // 3. Structured notes (summary, chapters, takeaways, quotes) when there is something to read.
      const lines = timedLines(segments);
      const notes =
        options.models && (lines.length || info.description?.trim())
          ? await generateMediaNotes(
              options.models,
              { kind: "video", title: info.title, channel, description: info.description, lines },
              warnings,
            )
          : null;

      const notice = segments.length
        ? undefined
        : blocked === "youtube_blocked"
          ? t("No transcript: YouTube does not let the Kortex server read the captions. Clip with the Kortex browser extension, it sends the captions directly.")
          : blocked === "captions_failed"
            ? t("No transcript: The captions could not be loaded on the server. Clip with the Kortex browser extension, it sends the captions directly.")
            : undefined;
      const rendered = renderMediaNote({
        title: info.title,
        facts: [
          channel ? `${ph("channel")}: ${channel}` : null,
          duration ? `${ph("duration")}: ${clockStamp(duration)}` : null,
          publishedAt ? `${ph("published")}: ${publishedAt.slice(0, 10)}` : null,
          `[${ph("watchOnYouTube")}](${watchUrl})`,
        ].filter((x): x is string => !!x),
        jump: (sec) => `${watchUrl}&t=${Math.floor(sec)}s`,
        notes,
        sourceChapters: descChapters,
        description: info.description,
        segments,
        notice,
      });

      return {
        type: "video",
        sourcePlatform: "youtube",
        titleHint: info.title,
        contentMd: rendered.contentMd,
        // Verified and stored by the caller; maxres is missing for some videos (hqdefault then).
        coverImageUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        sourceUrl: watchUrl,
        structuralChunks: rendered.chunks.length ? rendered.chunks : undefined,
        metadata: {
          video_id: videoId,
          channel: channel ?? null,
          duration_sec: duration || null,
          published_at: publishedAt ?? null,
          chapters: rendered.chapters,
          chapters_source: descChapters.length
            ? "description"
            : notes?.chapters.length
              ? "ai"
              : "none",
          transcript_source: transcriptSource,
          transcript_language: transcriptLanguage ?? null,
          transcript_missing: segments.length ? null : (blocked ?? "no_captions"),
          key_takeaways: notes?.key_takeaways ?? [],
          learnings: notes?.learnings ?? [],
          quotes: notes?.quotes ?? [],
          resources: notes?.resources ?? [],
          cover_candidates: [
            info.thumbnailUrl,
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          ].filter(Boolean),
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    },
  };
}
