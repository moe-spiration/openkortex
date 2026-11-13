import { getLocale, ph } from "../i18n";
import { ExtractionError } from "../errors";
import { defaultFetch, request, requestJson, type FetchLike } from "../http";
import { createSafeFetch, readBodyLimited } from "../net/safe-fetch";
import type { AudioTranscriber, TranscriptSegment } from "./transcriber";

/** Transcribes audio that lives at a URL (podcast enclosures can be 100+ MB). */
export interface UrlTranscriber {
  readonly id: string;
  transcribeUrl(url: string, options?: { language?: string }): Promise<TranscriptSegment[]>;
}

export const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";

interface DeepgramUtterance {
  start: number;
  end: number;
  transcript: string;
  speaker?: number;
}

/**
 * Deepgram pre-recorded API with a remote URL (no download through our server). Optional direct
 * override (DEEPGRAM_API_KEY); without `model` Deepgram uses its account default (DEEPGRAM_MODEL).
 */
export function createDeepgramUrlTranscriber(options: {
  apiKey: string;
  fetch?: FetchLike;
  model?: string;
  timeoutMs?: number;
}): UrlTranscriber {
  const id = "deepgram";
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    id,
    async transcribeUrl(url, { language = getLocale() } = {}) {
      const q = new URLSearchParams({
        ...(options.model ? { model: options.model } : {}),
        smart_format: "true",
        diarize: "true",
        utterances: "true",
        language,
      });
      const res = await requestJson<{ results?: { utterances?: DeepgramUtterance[] } }>(
        fetchFn,
        id,
        `${DEEPGRAM_LISTEN_URL}?${q}`,
        {
          method: "POST",
          headers: { Authorization: `Token ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          timeoutMs: options.timeoutMs ?? 600_000,
        },
      );
      const utterances = res.results?.utterances ?? [];
      if (utterances.length === 0) throw new ExtractionError(id, "empty transcription");
      return utterances.map((u) => ({
        startSec: u.start,
        endSec: u.end,
        text: u.transcript.trim(),
        ...(typeof u.speaker === "number" ? { speaker: `${ph("speaker")} ${u.speaker + 1}` } : {}),
      }));
    },
  };
}

/** Groq's upload limit for whisper-large-v3-turbo. */
export const GROQ_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Adapts a byte-based transcriber (Groq Whisper): downloads the audio first, up to `maxBytes`. */
export function downloadThenTranscribe(
  transcriber: AudioTranscriber,
  options: { fetch?: FetchLike; maxBytes?: number } = {},
): UrlTranscriber {
  const fetchFn = options.fetch ?? defaultFetch;
  const maxBytes = options.maxBytes ?? GROQ_MAX_UPLOAD_BYTES;
  return {
    id: transcriber.id,
    async transcribeUrl(url, { language } = {}) {
      // Enclosure URLs come from feeds: public hosts only; the size cap is enforced while streaming.
      const res = await request(createSafeFetch({ fetch: fetchFn }), transcriber.id, url, {
        timeoutMs: 300_000,
      });
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        throw new ExtractionError(
          transcriber.id,
          `audio is ${Math.round(declared / 1e6)} MB, limit is ${Math.round(maxBytes / 1e6)} MB`,
        );
      }
      const data = await readBodyLimited(res, maxBytes);
      if (!data) {
        throw new ExtractionError(
          transcriber.id,
          `audio is larger than ${Math.round(maxBytes / 1e6)} MB`,
        );
      }
      const name = new URL(url).pathname.split("/").pop() || "episode.mp3";
      return transcriber.transcribe(
        {
          data,
          mimeType: res.headers.get("content-type")?.split(";")[0] || "audio/mpeg",
          fileName: name,
        },
        { language },
      );
    },
  };
}
