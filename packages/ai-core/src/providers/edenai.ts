import { ph, t } from "../i18n";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { AudioInput, AudioTranscriber, TranscriptSegment } from "../audio/transcriber";
import type { UrlTranscriber } from "../audio/url-transcriber";
import { isWebm, webmOpusToOgg } from "../audio/webm-to-ogg";
import { ExtractionError } from "../errors";
import { defaultFetch, requestJson, type FetchLike } from "../http";

// Eden AI: one key for speech-to-text, OCR / document parsing and embeddings (v2 feature API) and
// for chat/vision LLMs (v3, OpenAI compatible). Catalog ids encode the feature:
//   speech_to_text_async/<provider>[/<model>]   ocr/<provider>[/<model>]   ocr_async/<provider>[/<model>]
//   embeddings/<provider>[/<model>]              llm/<provider>/<model>

export const EDENAI_API = "https://api.edenai.run/v2";
export const EDENAI_LLM_API = "https://api.edenai.run/v3/llm";

export type EdenKind = "speech_to_text_async" | "ocr" | "ocr_async" | "embeddings" | "llm";
const KINDS: readonly EdenKind[] = [
  "speech_to_text_async",
  "ocr",
  "ocr_async",
  "embeddings",
  "llm",
];

export interface EdenModelRef {
  kind: EdenKind;
  /** Sub-provider at Eden AI (deepgram, mistral, openai …). */
  provider: string;
  /** Sub-provider model, if any (as listed by Eden AI). May contain "/". */
  model?: string;
}

export function parseEdenModelId(id: string): EdenModelRef {
  const [kind, provider, ...rest] = id.split("/");
  if (!kind || !KINDS.includes(kind as EdenKind) || !provider) {
    throw new ExtractionError("edenai", t("unknown Eden AI model ID \"{id}\"", { id }));
  }
  const model = rest.join("/");
  return { kind: kind as EdenKind, provider, ...(model ? { model } : {}) };
}

export const edenModelId = (ref: EdenModelRef) =>
  [ref.kind, ref.provider, ref.model].filter(Boolean).join("/");

export interface EdenOptions {
  apiKey: string;
  fetch?: FetchLike;
  /** Poll interval for async jobs. Default 3 s. */
  pollIntervalMs?: number;
  /** Give up on async jobs after this long. Default 20 min (long podcasts). */
  jobTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const auth = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });

interface EdenJob<R> {
  public_id?: string;
  status?: string;
  results?: Record<string, R & { status?: string; error?: unknown }>;
  error?: unknown;
}

const errText = (e: unknown) => (typeof e === "string" ? e : JSON.stringify(e)).slice(0, 300);

type EdenProviderResult = { status?: string; final_status?: string; error?: unknown };

/**
 * The provider's entry in an Eden response. Eden keys it by `provider` for provider-level ids
 * (`<kind>/<provider>`) but by `provider/model` when a model is set (`<kind>/<provider>/<model>`
 * → key `"<provider>/<model>"`; found in the WP-F live run with the default OCR route).
 */
export function edenResultFor<R>(
  results: Record<string, R> | null | undefined,
  ref: EdenModelRef,
): R | undefined {
  if (!results) return undefined;
  return (
    results[ref.provider] ??
    (ref.model ? results[`${ref.provider}/${ref.model}`] : undefined) ??
    Object.entries(results).find(([key]) => key.startsWith(`${ref.provider}/`))?.[1]
  );
}

const edenFailed = (r: EdenProviderResult | undefined) =>
  !r || r.status === "fail" || r.final_status === "failed";

/** Starts an async Eden job and polls it until it is finished. Returns the provider's result. */
async function runJob<R>(
  o: EdenOptions,
  feature: string,
  ref: EdenModelRef,
  input: FormData | Record<string, unknown>,
): Promise<R> {
  const fetchFn = o.fetch ?? defaultFetch;
  const url = `${EDENAI_API}/${feature}`;
  const isForm = input instanceof FormData;
  const started = await requestJson<EdenJob<R>>(fetchFn, "edenai", url, {
    method: "POST",
    headers: isForm ? auth(o.apiKey) : { ...auth(o.apiKey), "Content-Type": "application/json" },
    body: isForm ? input : JSON.stringify(input),
    timeoutMs: 120_000,
  });
  if (!started.public_id)
    throw new ExtractionError(
      "edenai",
      t("{feature}: no job started ({reason})", { feature, reason: errText(started.error ?? started) }),
    );
  const deadline = Date.now() + (o.jobTimeoutMs ?? 20 * 60_000);
  const sleep = o.sleep ?? wait;
  for (;;) {
    const job = await requestJson<EdenJob<R>>(fetchFn, "edenai", `${url}/${started.public_id}`, {
      headers: auth(o.apiKey),
      timeoutMs: 60_000,
    });
    const result = edenResultFor(job.results, ref);
    if (job.status === "finished" || job.status === "success") {
      if (!result || edenFailed(result)) {
        throw new ExtractionError(
          "edenai",
          t("{feature} ({provider}) failed: {reason}", {
            feature,
            provider: ref.provider,
            reason: errText(result?.error ?? job.error ?? t("no result")),
          }),
        );
      }
      return result;
    }
    if (job.status === "failed" || job.status === "fail") {
      throw new ExtractionError(
        "edenai",
        t("{feature} ({provider}) failed: {reason}", {
          feature,
          provider: ref.provider,
          reason: errText(result?.error ?? job.error ?? job.status),
        }),
      );
    }
    if (Date.now() > deadline)
      throw new ExtractionError("edenai", t("{feature}: timed out waiting for the job", { feature }));
    await sleep(o.pollIntervalMs ?? 3_000);
  }
}

const settingsFor = (ref: EdenModelRef) =>
  ref.model ? { settings: { [ref.provider]: ref.model } } : {};

// --- Speech to text -------------------------------------------------------------------------

interface EdenSttResult {
  text?: string;
  diarization?: {
    entries?: Array<{
      segment?: string;
      start_time?: string | number;
      end_time?: string | number;
      speaker?: number | string;
    }>;
  };
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Diarization entries (often word level) → readable segments (same speaker, gaps < 1.5 s). */
export function edenSegments(r: EdenSttResult): TranscriptSegment[] {
  const entries = r.diarization?.entries ?? [];
  // Providers number speakers from 0 or from 1; show "Sprecher 1" for the first either way.
  const offset = entries.some(
    (e) => num(e.speaker) === 0 && e.speaker !== undefined && e.speaker !== null,
  )
    ? 1
    : 0;
  const label = (s: unknown) => {
    if (s === undefined || s === null || s === "") return undefined;
    const n = Number(s);
    return Number.isInteger(n) ? `${ph("speaker")} ${n + offset}` : String(s);
  };
  const out: TranscriptSegment[] = [];
  for (const e of entries) {
    const text = (e.segment ?? "").trim();
    if (!text) continue;
    const start = num(e.start_time);
    const end = num(e.end_time) || start;
    const speaker = label(e.speaker);
    const prev = out.at(-1);
    if (
      prev &&
      prev.speaker === speaker &&
      start - (prev.endSec ?? prev.startSec) < 1.5 &&
      prev.text.length < 400
    ) {
      prev.text = `${prev.text} ${text}`;
      prev.endSec = end;
    } else {
      out.push({ startSec: start, endSec: end, text, ...(speaker ? { speaker } : {}) });
    }
  }
  if (out.length) return out;
  const text = r.text?.trim();
  return text ? [{ startSec: 0, text }] : [];
}

/**
 * Audio in a container Eden AI accepts. Its upload check rejects WebM ("File unrecognized or
 * corrupted", HTTP 400, for every sub-provider), which is what browsers record with
 * MediaRecorder; Opus in WebM is remuxed into Ogg (lossless, no ffmpeg). Detected by content,
 * since clients label recordings inconsistently.
 */
export function edenAudio(audio: AudioInput): AudioInput {
  const data = new Uint8Array(audio.data);
  if (!isWebm(data)) return audio;
  try {
    const base = (audio.fileName ?? "audio").replace(/\.[^.]+$/, "");
    return { data: webmOpusToOgg(data), mimeType: "audio/ogg", fileName: `${base}.ogg` };
  } catch (err) {
    throw new ExtractionError(
      "edenai",
      t("Audio format not supported (WebM without Opus: {reason}). Please send MP3, M4A, OGG or WAV.", {
        reason: err instanceof Error ? err.message : String(err),
      }),
      { cause: err },
    );
  }
}

/** Eden AI speech-to-text (async job; Deepgram, Google, AssemblyAI … as sub-provider). */
export function createEdenTranscriber(
  modelId: string,
  o: EdenOptions,
): AudioTranscriber & UrlTranscriber {
  const ref = parseEdenModelId(modelId);
  const id = `edenai:${ref.provider}`;
  const base = (language?: string) => ({
    providers: ref.provider,
    ...settingsFor(ref),
    ...(language ? { language } : {}),
    speakers: 0,
    show_original_response: false,
  });
  const finish = (r: EdenSttResult) => {
    const segments = edenSegments(r);
    if (!segments.length) throw new ExtractionError("edenai", t("Empty transcription"));
    return segments;
  };
  return {
    id,
    async transcribe(input: AudioInput, { language } = {}) {
      const audio = edenAudio(input);
      const form = new FormData();
      for (const [k, v] of Object.entries(base(language))) {
        form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      form.append(
        "file",
        new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }),
        audio.fileName ?? "audio",
      );
      return finish(await runJob<EdenSttResult>(o, "audio/speech_to_text_async", ref, form));
    },
    async transcribeUrl(url, { language } = {}) {
      return finish(
        await runJob<EdenSttResult>(o, "audio/speech_to_text_async", ref, {
          ...base(language),
          file_url: url,
        }),
      );
    },
  };
}

// --- OCR / document parsing -----------------------------------------------------------------

export type DocumentInput =
  { data: Uint8Array; mimeType: string; fileName?: string } | { url: string };

export interface ParsedDocument {
  text: string;
  /** Text per page when the provider reports pages. */
  pages?: string[];
}

/** Text extraction for scanned PDFs and images (routed task `document_parsing`). */
export interface DocumentParser {
  readonly id: string;
  parse(input: DocumentInput, options?: { language?: string }): Promise<ParsedDocument>;
}

interface EdenOcrResult {
  text?: string;
  raw_text?: string;
  pages?: Array<{ lines?: Array<{ text?: string }>; text?: string; raw_text?: string }>;
}

export function edenDocumentText(r: EdenOcrResult): ParsedDocument {
  const pages = (r.pages ?? [])
    .map((p) =>
      (p.text ?? p.raw_text ?? (p.lines ?? []).map((l) => l.text ?? "").join("\n")).trim(),
    )
    .filter(Boolean);
  const text = (r.raw_text ?? r.text ?? pages.join("\n\n")).trim();
  return pages.length ? { text, pages } : { text };
}

/** Eden AI OCR: `ocr/…` (sync, images) or `ocr_async/…` (multi-page PDFs). */
export function createEdenDocumentParser(modelId: string, o: EdenOptions): DocumentParser {
  const ref = parseEdenModelId(modelId);
  if (ref.kind !== "ocr" && ref.kind !== "ocr_async")
    throw new ExtractionError("edenai", t("{model} is not an OCR model", { model: modelId }));
  const fetchFn = o.fetch ?? defaultFetch;
  const body = (input: DocumentInput, language?: string): FormData | Record<string, unknown> => {
    const fields = {
      providers: ref.provider,
      ...settingsFor(ref),
      ...(language ? { language } : {}),
    };
    if ("url" in input) return { ...fields, file_url: input.url };
    const form = new FormData();
    for (const [k, v] of Object.entries(fields))
      form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    form.append(
      "file",
      new Blob([new Uint8Array(input.data)], { type: input.mimeType }),
      input.fileName ?? "document",
    );
    return form;
  };
  return {
    id: `edenai:${ref.provider}`,
    async parse(input, { language } = {}) {
      let result: EdenOcrResult;
      if (ref.kind === "ocr_async") {
        result = await runJob<EdenOcrResult>(o, "ocr/ocr_async", ref, body(input, language));
      } else {
        const b = body(input, language);
        const isForm = b instanceof FormData;
        const res = await requestJson<
          Record<string, EdenOcrResult & { status?: string; error?: unknown }>
        >(fetchFn, "edenai", `${EDENAI_API}/ocr/ocr`, {
          method: "POST",
          headers: isForm
            ? auth(o.apiKey)
            : { ...auth(o.apiKey), "Content-Type": "application/json" },
          body: isForm ? b : JSON.stringify(b),
          timeoutMs: 120_000,
        });
        const r = edenResultFor(res, ref);
        if (!r || edenFailed(r))
          throw new ExtractionError(
            "edenai",
            t("{feature} ({provider}) failed: {reason}", {
              feature: "OCR",
              provider: ref.provider,
              reason: errText(r?.error ?? t("no result")),
            }),
          );
        result = r;
      }
      const doc = edenDocumentText(result);
      if (!doc.text) throw new ExtractionError("edenai", t("OCR without text"));
      return doc;
    },
  };
}

// --- Embeddings -----------------------------------------------------------------------------

/** Eden AI text embeddings as an AI SDK embedding model (works with embed/embedMany). */
export function createEdenEmbeddingModel(modelId: string, o: EdenOptions): EmbeddingModel {
  const ref = parseEdenModelId(modelId);
  if (ref.kind !== "embeddings")
    throw new ExtractionError("edenai", t("{model} is not an embedding model", { model: modelId }));
  const fetchFn = o.fetch ?? defaultFetch;
  const model = {
    specificationVersion: "v4" as const,
    provider: "edenai",
    modelId,
    maxEmbeddingsPerCall: 96,
    supportsParallelCalls: true,
    async doEmbed({ values, abortSignal }: { values: string[]; abortSignal?: AbortSignal }) {
      const res = await requestJson<
        Record<
          string,
          { items?: Array<{ embedding?: number[] }>; status?: string; error?: unknown }
        >
      >(fetchFn, "edenai", `${EDENAI_API}/text/embeddings`, {
        method: "POST",
        headers: { ...auth(o.apiKey), "Content-Type": "application/json" },
        body: JSON.stringify({ providers: ref.provider, texts: values, ...settingsFor(ref) }),
        ...(abortSignal ? { signal: abortSignal } : {}),
        timeoutMs: 120_000,
      });
      const r = edenResultFor(res, ref);
      if (!r || edenFailed(r))
        throw new ExtractionError(
          "edenai",
          t("{feature} ({provider}) failed: {reason}", {
            feature: "Embeddings",
            provider: ref.provider,
            reason: errText(r?.error ?? t("no result")),
          }),
        );
      return { embeddings: (r.items ?? []).map((i) => i.embedding ?? []), warnings: [] };
    },
  };
  return model as unknown as EmbeddingModel;
}

// --- Chat / vision (v3, OpenAI compatible) ----------------------------------------------------

export function createEdenChatModel(modelId: string, o: EdenOptions): LanguageModel {
  const ref = parseEdenModelId(modelId);
  if (ref.kind !== "llm" || !ref.model)
    throw new ExtractionError("edenai", t("{model} is not an LLM", { model: modelId }));
  const provider = createOpenAICompatible({
    name: "edenai",
    baseURL: EDENAI_LLM_API,
    apiKey: o.apiKey,
    fetch: (o.fetch ?? defaultFetch) as typeof fetch,
  });
  return provider.chatModel(`${ref.provider}/${ref.model}`);
}
