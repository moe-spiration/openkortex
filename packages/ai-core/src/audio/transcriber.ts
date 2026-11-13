import { NO_SPEECH_PROB_MAX } from "./hallucination";
import { ExtractionError } from "../errors";
import { defaultFetch, requestJson, type FetchLike } from "../http";

export interface TranscriptSegment {
  startSec: number;
  endSec?: number;
  text: string;
  /** Speaker label from diarization ("Sprecher 1") when the transcriber provides one. */
  speaker?: string;
}

export interface AudioInput {
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
}

/** Speech-to-text port (Groq Whisper today, Deepgram later for meetings/podcasts). */
export interface AudioTranscriber {
  readonly id: string;
  transcribe(audio: AudioInput, options?: { language?: string }): Promise<TranscriptSegment[]>;
}

export const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

interface GroqVerboseJson {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string; no_speech_prob?: number }>;
}

export interface GroqWhisperOptions {
  apiKey: string;
  fetch?: FetchLike;
  model?: string;
  timeoutMs?: number;
}

/** Groq Whisper Large v3 Turbo via the OpenAI-compatible transcription endpoint. */
export function createGroqWhisperTranscriber(options: GroqWhisperOptions): AudioTranscriber {
  const id = "groq-whisper";
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    id,
    async transcribe(audio, { language } = {}) {
      const form = new FormData();
      const bytes = new Uint8Array(audio.data); // copy: Blob wants an ArrayBuffer-backed view
      form.append("file", new Blob([bytes], { type: audio.mimeType }), audio.fileName ?? "audio");
      form.append("model", options.model ?? GROQ_WHISPER_MODEL);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
      if (language) form.append("language", language);
      const res = await requestJson<GroqVerboseJson>(fetchFn, id, GROQ_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        timeoutMs: options.timeoutMs ?? 300_000,
      });
      if (res.segments && res.segments.length > 0) {
        // Whisper invents text on silence: segments it itself rates as non-speech are dropped.
        const speech = res.segments.filter((s) => !(typeof s.no_speech_prob === "number" && s.no_speech_prob >= NO_SPEECH_PROB_MAX));
        if (speech.length === 0) throw new ExtractionError(id, "empty transcription");
        return speech.map((s) => ({ startSec: s.start, endSec: s.end, text: s.text.trim() }));
      }
      if (res.text) return [{ startSec: 0, text: res.text.trim() }];
      throw new ExtractionError(id, "empty transcription");
    },
  };
}
