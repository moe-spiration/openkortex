"use client";

import { t } from "@/i18n";
import { useEffect, useRef } from "react";
import type { ApiFailure } from "@/lib/api/client";
import type { TranscribeResponse } from "@/server/chat/transcribe";
import { isLiveData } from "@/lib/workspace-data";
import { fmtSec } from "./copilot";
import type { RecPurpose } from "./orbit";
import { useShell, type VoiceRecorder } from "./store";
import { createVoiceSession, type RecorderLike } from "./voice-core";

/*
 * Voice from the Orbit-Bar orb (tap or push-to-talk, Ctrl+Shift+Space) in live mode:
 * MediaRecorder → POST /api/chat/transcribe → the transcript goes to the bar (deliverTranscript),
 * which routes it by intent (W9): a Diktat is saved like a typed capture, a Sprachfrage lands in
 * the field or is sent. The microphone stream is shared with the live wave (setRecStream).
 * Degrades gracefully: no microphone, no transcription route or no Eden AI credits (402) end with
 * a clear inbox row and toast instead of a silent failure.
 */

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

async function transcribe(
  blob: Blob,
): Promise<
  { ok: true; text: string } | { ok: false; status: number; message: string; reason?: string }
> {
  const form = new FormData();
  form.append(
    "audio",
    new File([blob], blob.type.includes("mp4") ? "sprachnotiz.m4a" : "sprachnotiz.webm", {
      type: blob.type || "audio/webm",
    }),
  );
  form.append("language", "de");
  try {
    const res = await fetch("/api/chat/transcribe", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => null)) as TranscribeResponse | ApiFailure | null;
    if (res.ok && body && body.ok) return { ok: true, text: body.text };
    const err = body && !body.ok ? body.error : null;
    const reason = (err?.details as { reason?: string } | undefined)?.reason;
    return { ok: false, status: res.status, message: err?.message ?? `HTTP ${res.status}`, reason };
  } catch {
    return { ok: false, status: 0, message: t("No connection to the server") };
  }
}

/** Mount once (AppShell). Registers the live recorder with the shell store. */
export function useVoiceRecorder() {
  const {
    setRecorder,
    cancelRec,
    upsertCapture,
    dismissCapture,
    showToast,
    setRecStream,
    deliverTranscript,
  } = useShell();
  const live = isLiveData();
  // Latest callbacks for the long-lived recorder object.
  const cb = useRef({
    cancelRec,
    upsertCapture,
    dismissCapture,
    showToast,
    setRecStream,
    deliverTranscript,
  });
  cb.current = {
    cancelRec,
    upsertCapture,
    dismissCapture,
    showToast,
    setRecStream,
    deliverTranscript,
  };

  useEffect(() => {
    if (!live) return;
    // Set by stop(), read when the recorder has flushed its last chunk.
    let ending: { sec: number; purpose: RecPurpose } = { sec: 0, purpose: "dictation" };

    const finished = (chunks: Blob[], mimeType: string, save: boolean) => {
      if (!save) {
        cb.current.showToast(t("Recording discarded"));
        return;
      }
      const { sec, purpose } = ending;
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      const title = purpose === "voiceQuestion" ? t("Voice question {duration}", { duration: fmtSec(sec) }) : t("Voice memo {duration}", { duration: fmtSec(sec) });
      const id = `voice-${Date.now().toString(36)}`;
      const job = { id, itemId: null, createdAt: Date.now(), title, icon: "mic" as const };
      if (blob.size < 800) {
        cb.current.showToast(t("Recording too short"));
        return;
      }
      cb.current.upsertCapture(id, {
        ...job,
        status: "sending",
        step: t("Transcribing"),
        pct: 10,
      });
      cb.current.showToast(t("{title} is being transcribed", { title }));
      void transcribe(blob).then((r) => {
        if (r.ok) {
          cb.current.dismissCapture(id);
          cb.current.deliverTranscript({ text: r.text, purpose, title });
          return;
        }
        const error =
          r.status === 402 || r.reason === "payment_required"
            ? t("Transcription not available: Eden AI has no credit")
            : r.reason === "no_transcriber"
              ? t("No transcription set up in the routing")
              : r.message;
        cb.current.upsertCapture(id, { status: "error", error, step: error, pct: 100 });
        cb.current.showToast(title + ": " + error);
        setTimeout(() => cb.current.dismissCapture(id), 12_000);
      });
    };

    // N5 #2: the session stops a stream that arrives after stop, a second start or the unmount.
    const session = createVoiceSession<MediaStream>({
      mime: typeof navigator.mediaDevices?.getUserMedia === "function" ? pickMime() : undefined,
      getUserMedia: () =>
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        }),
      createRecorder: (stream, mimeType) =>
        new MediaRecorder(stream, { mimeType }) as unknown as RecorderLike,
      onStream: (s) => cb.current.setRecStream(s),
      onUnsupported: () => {
        cb.current.cancelRec();
        cb.current.showToast(t("Voice recording is not supported by this browser"));
      },
      onDenied: () => {
        cb.current.cancelRec();
        cb.current.showToast(t("No microphone access. Please allow it in the browser."));
      },
      onNothingRecorded: (save) =>
        cb.current.showToast(save ? t("Recording too short") : t("Recording discarded")),
      onFinished: finished,
    });

    const recorder: VoiceRecorder = {
      start: () => session.start(),
      stop: (save, sec, purpose) => {
        ending = { sec, purpose };
        session.stop(save);
      },
    };
    setRecorder(recorder);
    return () => {
      setRecorder(null);
      session.dispose();
    };
  }, [live, setRecorder]);
}
