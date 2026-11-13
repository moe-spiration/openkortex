import { ExtractionError, type AudioTranscriber, type UrlTranscriber } from "@kortex/ai-core";
import { describe, expect, it } from "vitest";
import { createTranscribeHandlers, isPaymentRequired, providerRejection } from "../chat/transcribe";
import { authed, mockRouter, setup } from "./helpers";

type Transcriber = AudioTranscriber & UrlTranscriber;

function make(transcriber?: Transcriber) {
  const models = Object.assign(mockRouter(), transcriber ? { transcriber: () => transcriber } : {});
  const s = setup({ models });
  return { ...s, h: createTranscribeHandlers(() => s.deps) };
}

const fakeTranscriber = (impl: Transcriber["transcribe"]): Transcriber => ({
  id: "edenai:deepgram",
  transcribe: impl,
  transcribeUrl: async () => [],
});

function audioRequest(blob: Blob | null, type = "audio/webm", extra: Record<string, string> = {}) {
  const form = new FormData();
  if (blob) form.append("audio", new File([blob], "sprachnotiz.webm", { type }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request(
    "http://localhost/api/chat/transcribe",
    authed({ method: "POST", body: form }),
  );
}

const audio = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });

describe("POST /api/chat/transcribe", () => {
  it("returns the joined transcript of the audio_transcription route", async () => {
    let seen: { mimeType: string; language?: string } | undefined;
    const { h } = make(
      fakeTranscriber(async (a, o) => {
        seen = { mimeType: a.mimeType, language: o?.language };
        return [
          { startSec: 0, endSec: 2.5, text: " Idee für den Sync. " },
          { startSec: 2.5, endSec: 4, text: "Checksums prüfen." },
        ];
      }),
    );
    const res = await h.POST(audioRequest(audio()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      text: "Idee für den Sync. Checksums prüfen.",
      model: "edenai:deepgram",
      duration_sec: 4,
    });
    expect(seen).toEqual({ mimeType: "audio/webm", language: "de" });
  });

  it("answers 402 with a clear message when Eden AI has no credits", async () => {
    const { h } = make(
      fakeTranscriber(async () => {
        throw new ExtractionError("edenai", "api.edenai.run responded 402");
      }),
    );
    const res = await h.POST(audioRequest(audio()));
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; message: string; details: { reason: string } };
    };
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toMatch(/kein Guthaben/);
    expect(body.error.details.reason).toBe("payment_required");
  });

  it("is not_configured without a transcription route", async () => {
    const { h } = make();
    const res = await h.POST(audioRequest(audio()));
    expect(res.status).toBe(503);
  });

  it("rejects missing or non-audio uploads", async () => {
    const { h } = make(fakeTranscriber(async () => [{ startSec: 0, text: "x" }]));
    expect((await h.POST(audioRequest(null))).status).toBe(400);
    expect((await h.POST(audioRequest(new Blob(["%PDF"]), "application/pdf"))).status).toBe(400);
  });

  it("maps an empty transcript to 422", async () => {
    const { h } = make(fakeTranscriber(async () => [{ startSec: 0, text: "  " }]));
    expect((await h.POST(audioRequest(audio()))).status).toBe(422);
    const eden = make(
      fakeTranscriber(async () => {
        throw new ExtractionError("edenai", "leere Transkription");
      }),
    );
    expect((await eden.h.POST(audioRequest(audio()))).status).toBe(422);
  });

  it.each([
    "Untertitel der Amara.org-Community",
    "Untertitelung des ZDF, 2020",
    "Vielen Dank fürs Zuschauen!",
    "Thanks for watching",
    "ja",
  ])("answers 422 'Nichts verstanden' for the Whisper artefact %j", async (phrase) => {
    const { h } = make(fakeTranscriber(async () => [{ startSec: 0, text: phrase }]));
    const res = await h.POST(audioRequest(audio()));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("Nichts verstanden");
  });

  it("returns timed segments with the speaker label when asked (desktop meeting transcript)", async () => {
    const { h } = make(
      fakeTranscriber(async () => [
        { startSec: 0, endSec: 2, text: " Wer entscheidet? ", speaker: "Sprecher 1" },
        { startSec: 2.5, endSec: 4, text: "Das Board.", speaker: "Sprecher 2" },
        { startSec: 5, text: "Untertitel der Amara.org-Community" },
      ]),
    );
    const res = await h.POST(audioRequest(audio(), "audio/webm", { segments: "1" }));
    const body = await res.json();
    expect(body.text).toBe("Wer entscheidet? Das Board.");
    expect(body.segments).toEqual([
      { start_sec: 0, end_sec: 2, text: "Wer entscheidet?", speaker: "Sprecher 1" },
      { start_sec: 2.5, end_sec: 4, text: "Das Board.", speaker: "Sprecher 2" },
    ]);
    // Voice notes do not ask: the answer stays as it was.
    const plain = await (await h.POST(audioRequest(audio()))).json();
    expect(plain.segments).toBeUndefined();
  });

  it("drops an artefact segment but keeps the real speech", async () => {
    const { h } = make(
      fakeTranscriber(async () => [
        { startSec: 0, text: "Idee für den Sync." },
        { startSec: 3, text: "Untertitel der Amara.org-Community" },
      ]),
    );
    const res = await h.POST(audioRequest(audio()));
    expect((await res.json()).text).toBe("Idee für den Sync.");
  });
});

describe("provider errors", () => {
  const failing = (message: string) =>
    make(
      fakeTranscriber(async () => {
        throw new ExtractionError("edenai", message);
      }),
    );

  it("a provider 4xx becomes 422 with the provider's reason (the voice-capture bug)", async () => {
    const { h, errors } = failing(
      'api.edenai.run responded 400: ["File unrecognized or corrupted"]',
    );
    const res = await h.POST(audioRequest(audio()));
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { message: string; details: { reason: string; provider_status: number } };
    };
    expect(body.error.message).toBe(
      "Die Transkription hat die Aufnahme abgelehnt: File unrecognized or corrupted",
    );
    expect(body.error.details).toMatchObject({ reason: "provider_rejected", provider_status: 400 });
    expect(errors.some((e) => e.message === "transcribe failed")).toBe(true);
  });

  it("a provider 5xx is a temporary 502", async () => {
    const res = await failing("api.edenai.run responded 503: Service Unavailable").h.POST(
      audioRequest(audio()),
    );
    expect(res.status).toBe(502);
    expect(
      ((await res.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe("provider_unavailable");
  });

  it("an unsupported recording format is 415 with a clear message", async () => {
    const res = await failing(
      "Audioformat nicht unterstützt (WebM ohne Opus: no Opus track). Bitte als MP3, M4A, OGG oder WAV senden.",
    ).h.POST(audioRequest(audio()));
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /^Audioformat nicht unterstützt/,
    );
  });

  it("reads JSON error bodies", () => {
    expect(
      providerRejection(new Error('x responded 400: {"error":{"message":"bad language"}}')),
    ).toEqual({ status: 400, reason: "bad language" });
    expect(providerRejection(new Error("x responded 400"))).toEqual({ status: 400, reason: "" });
    expect(providerRejection(new Error("timeout"))).toBeNull();
  });
});

describe("isPaymentRequired", () => {
  it("finds 402 in the error or its cause", () => {
    expect(
      isPaymentRequired(new Error("x", { cause: new Error("api.edenai.run responded 402") })),
    ).toBe(true);
    expect(isPaymentRequired(new Error("api.edenai.run responded 500"))).toBe(false);
  });
});
