import { getLocale, t } from "@/i18n";
import { KortexAiError, dropHallucinatedSegments, isEmptySpeech } from "@kortex/ai-core";
import { ApiError, badRequest, json } from "../api-error";
import { getUserSettings } from "../repo";
import { preflight, route, type DepsProvider } from "../route";
import { enforceLimits } from "../limits";

// POST /api/chat/transcribe — voice note from the footbar orb: audio in, plain text out.
// The web app then captures the text as a `note` (type_hint voice) through POST /api/ingest.

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/**
 * The desktop's final meeting pass sends up to 20 min of one channel (16 kHz mono WAV, ~38 MB) in
 * one piece, so the diarization keeps the same speaker numbers across the whole window.
 */
export const MAX_MEETING_AUDIO_BYTES = 48 * 1024 * 1024;
const AUDIO_TYPE = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|m4a|x-m4a|flac)(;.*)?$/i;

export interface TranscribeResponse {
  ok: true;
  text: string;
  /** "provider:model" or the transcriber id of the audio_transcription route. */
  model: string;
  duration_sec: number | null;
  /**
   * Timed segments with the diarization label ("Sprecher 1"), only when the form asks for them
   * (`segments=1`, desktop meeting transcript: who said what on the system channel).
   */
  segments?: TranscribeSegment[];
}

export interface TranscribeSegment {
  start_sec: number;
  end_sec: number | null;
  text: string;
  speaker: string | null;
}

/**
 * What a provider said when it refused the request: `<host> responded 400: <reason>` (ai-core
 * keeps the response body since the voice-capture bug), or null.
 */
export function providerRejection(err: unknown): { status: number; reason: string } | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /responded (\d{3})(?::\s*(.*))?$/s.exec(msg);
  if (!m) return null;
  let reason = (m[2] ?? "").trim();
  try {
    const parsed: unknown = JSON.parse(reason);
    if (Array.isArray(parsed)) reason = parsed.map(String).join("; ");
    else if (parsed && typeof parsed === "object") {
      const o = parsed as {
        error?: { message?: unknown } | string;
        message?: unknown;
        detail?: unknown;
      };
      const e = typeof o.error === "object" ? o.error?.message : o.error;
      reason = String(e ?? o.message ?? o.detail ?? reason);
    }
  } catch {
    /* plain text */
  }
  return { status: Number(m[1]), reason: reason.slice(0, 200) };
}

/** Provider ran out of credits (Eden AI answers 402 Payment Required). */
export function isPaymentRequired(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\b402\b|payment required|insufficient (credits|funds|balance)|no credits/i.test(msg))
      return true;
  }
  return false;
}

export function createTranscribeHandlers(getDeps: DepsProvider) {
  return {
    POST: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "transcribe");
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw badRequest(t("multipart/form-data with `audio` expected"));
      }
      const audio = form.get("audio");
      if (!(audio instanceof Blob) || audio.size === 0) throw badRequest(t("audio: file is missing"));
      const wantSegments = /^(1|true|yes)$/i.test(String(form.get("segments") ?? ""));
      const maxBytes = wantSegments ? MAX_MEETING_AUDIO_BYTES : MAX_AUDIO_BYTES;
      if (audio.size > maxBytes) throw badRequest(t("audio: larger than {mb} MB", { mb: maxBytes / 1024 / 1024 }));
      const type = audio.type || "audio/webm";
      if (!AUDIO_TYPE.test(type)) throw badRequest(t("audio: format {type} is not supported", { type }));
      const language = String(form.get("language") ?? getLocale()).slice(0, 8) || getLocale();

      const settings = await getUserSettings(auth.client, auth.userId);
      const catalog = await deps.loadCatalog();
      const models = deps.createModels(settings, catalog);
      const transcriber = models.transcriber?.();
      if (!transcriber)
        throw new ApiError(
          "not_configured",
          t("No transcription set up (routing: transcription)"),
          {
            details: { reason: "no_transcriber" },
          },
        );

      const name =
        audio instanceof File && audio.name
          ? audio.name
          : `sprachnotiz.${type.includes("mp4") ? "m4a" : "webm"}`;
      let segments;
      try {
        segments = await transcriber.transcribe(
          {
            data: new Uint8Array(await audio.arrayBuffer()),
            mimeType: type.split(";")[0]!,
            fileName: name,
          },
          { language },
        );
      } catch (err) {
        if (isPaymentRequired(err))
          throw new ApiError(
            "not_configured",
            t("Transcription not available: Eden AI has no credit left"),
            {
              status: 402,
              details: { reason: "payment_required", provider: transcriber.id },
              cause: err,
            },
          );
        // ai-core throws on an empty result (Groq: "empty transcription", Eden: "leere Transkription").
        if (
          err instanceof KortexAiError &&
          /empty transcription|leere transkription/i.test(err.message)
        )
          throw new ApiError("invalid_request", t("Nothing understood, the recording is empty"), {
            status: 422,
          });
        deps.log.error("transcribe failed", {
          provider: transcriber.id,
          type,
          bytes: audio.size,
          error: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof KortexAiError && /Audioformat nicht unterstützt|audio format (?:is )?not supported/i.test(err.message))
          throw new ApiError("invalid_request", err.message.replace(/^edenai:\s*/, ""), {
            status: 415,
            details: { reason: "unsupported_audio" },
          });
        const rejected = providerRejection(err);
        if (rejected && rejected.status >= 400 && rejected.status < 500)
          throw new ApiError(
            "invalid_request",
            rejected.reason
              ? t("The transcription rejected the recording: {reason}", { reason: rejected.reason })
              : t("The transcription rejected the recording"),
            {
              status: 422,
              details: {
                reason: "provider_rejected",
                provider: transcriber.id,
                provider_status: rejected.status,
              },
              cause: err,
            },
          );
        if (rejected)
          throw new ApiError(
            "server_error",
            t("The transcription service is not reachable right now, please try again in a moment"),
            {
              status: 502,
              details: {
                reason: "provider_unavailable",
                provider: transcriber.id,
                provider_status: rejected.status,
              },
              cause: err,
            },
          );
        if (err instanceof KortexAiError)
          throw new ApiError("server_error", t("Transcription failed: {error}", { error: err.message }), {
            status: 502,
            cause: err,
          });
        throw err;
      }
      // Whisper artefacts ("Untertitel der Amara.org-Community") and too-short results count as empty.
      const kept = dropHallucinatedSegments(segments);
      const text = kept
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!text || isEmptySpeech(text))
        throw new ApiError("invalid_request", t("Nothing understood"), {
          status: 422,
        });
      const end = segments.reduce((m, s) => Math.max(m, s.endSec ?? s.startSec), 0);
      return json<TranscribeResponse>({
        ok: true,
        text,
        model: transcriber.id,
        duration_sec: end || null,
        ...(wantSegments
          ? {
              segments: kept
                .filter((s) => s.text.trim())
                .map((s) => ({
                  start_sec: s.startSec,
                  end_sec: s.endSec ?? null,
                  text: s.text.trim(),
                  speaker: s.speaker ?? null,
                })),
            }
          : {}),
      });
    }),
    OPTIONS: preflight(getDeps),
  };
}
