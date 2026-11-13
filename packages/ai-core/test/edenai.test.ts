import { embedMany } from "ai";
import { describe, expect, it } from "vitest";
import {
  createEdenDocumentParser,
  createEdenEmbeddingModel,
  createEdenTranscriber,
  edenModelId,
  edenSegments,
  parseEdenModelId,
} from "../src/providers/edenai";
import { ExtractionError } from "../src/errors";
import { fakeFetch, json } from "./helpers";

const fast = { apiKey: "ek", pollIntervalMs: 1, sleep: async () => {} };
const STT = "https://api.edenai.run/v2/audio/speech_to_text_async";

describe("Eden AI model ids", () => {
  it("round-trips kind/provider/model, models may contain slashes", () => {
    expect(parseEdenModelId("speech_to_text_async/deepgram/nova-x")).toEqual({
      kind: "speech_to_text_async",
      provider: "deepgram",
      model: "nova-x",
    });
    expect(parseEdenModelId("ocr/google")).toEqual({ kind: "ocr", provider: "google" });
    const ref = parseEdenModelId("llm/meta/llama/fx");
    expect(ref.model).toBe("llama/fx");
    expect(edenModelId(ref)).toBe("llm/meta/llama/fx");
    expect(() => parseEdenModelId("translate/deepl")).toThrow(ExtractionError);
  });
});

describe("Eden AI speech to text", () => {
  const jobRoutes = (finalStatus = "finished") => {
    let polls = 0;
    return fakeFetch([
      {
        match: (u, i) => u === STT && i?.method === "POST",
        respond: () => json({ public_id: "job-1", status: "processing" }),
      },
      {
        match: (u) => u === `${STT}/job-1`,
        respond: () =>
          ++polls < 2
            ? json({ public_id: "job-1", status: "processing", results: {} })
            : json({
                public_id: "job-1",
                status: finalStatus,
                results: {
                  deepgram: {
                    status: finalStatus === "finished" ? "success" : "fail",
                    error: finalStatus === "finished" ? undefined : "bad audio",
                    text: "Hallo zusammen. Danke.",
                    diarization: {
                      entries: [
                        { segment: "Hallo", start_time: "0.0", end_time: "0.4", speaker: 0 },
                        { segment: "zusammen.", start_time: "0.5", end_time: "1.0", speaker: 0 },
                        { segment: "Danke.", start_time: "1.2", end_time: "1.6", speaker: 1 },
                      ],
                    },
                  },
                },
              }),
      },
    ]);
  };

  it("uploads bytes as multipart, polls the job and merges diarized words into speaker segments", async () => {
    const fetch = jobRoutes();
    const t = createEdenTranscriber("speech_to_text_async/deepgram/nova-x", { ...fast, fetch });
    expect(t.id).toBe("edenai:deepgram");
    const segs = await t.transcribe(
      { data: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg", fileName: "a.mp3" },
      { language: "de" },
    );
    expect(segs).toEqual([
      { startSec: 0, endSec: 1, text: "Hallo zusammen.", speaker: "Sprecher 1" },
      { startSec: 1.2, endSec: 1.6, text: "Danke.", speaker: "Sprecher 2" },
    ]);
    const start = fetch.calls[0]!;
    expect(start.headers.authorization).toBe("Bearer ek");
    expect(start.body).toBeInstanceOf(FormData);
    const form = start.body as FormData;
    expect(form.get("providers")).toBe("deepgram");
    expect(form.get("settings")).toBe(JSON.stringify({ deepgram: "nova-x" }));
    expect(form.get("language")).toBe("de");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(fetch.calls.filter((c) => c.url.endsWith("/job-1"))).toHaveLength(2);
    expect(fetch.calls.every((c) => !c.url.includes("ek"))).toBe(true);
  });

  it("sends a file_url as JSON for URL transcription", async () => {
    const fetch = jobRoutes();
    const t = createEdenTranscriber("speech_to_text_async/deepgram", { ...fast, fetch });
    await t.transcribeUrl("https://cdn.example.com/ep.mp3");
    expect(fetch.calls[0]?.body).toMatchObject({
      providers: "deepgram",
      file_url: "https://cdn.example.com/ep.mp3",
      speakers: 0,
    });
    expect(fetch.calls[0]?.body).not.toHaveProperty("settings");
  });

  it("reports provider failures", async () => {
    const t = createEdenTranscriber("speech_to_text_async/deepgram", {
      ...fast,
      fetch: jobRoutes("failed"),
    });
    await expect(t.transcribeUrl("https://x.test/a.mp3")).rejects.toThrow(/bad audio/);
  });

  it("falls back to plain text without diarization", () => {
    expect(edenSegments({ text: " nur Text " })).toEqual([{ startSec: 0, text: "nur Text" }]);
    expect(
      edenSegments({
        diarization: { entries: [{ segment: "Hi", start_time: 2, end_time: 3, speaker: 1 }] },
      }),
    ).toEqual([{ startSec: 2, endSec: 3, text: "Hi", speaker: "Sprecher 1" }]);
  });
});

describe("Eden AI OCR", () => {
  it("sync OCR posts the image and returns the provider text", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === "https://api.edenai.run/v2/ocr/ocr",
        respond: () => json({ google: { status: "success", text: "KORTEX 42" } }),
      },
    ]);
    const p = createEdenDocumentParser("ocr/google", { ...fast, fetch });
    expect(await p.parse({ data: new Uint8Array([137, 80]), mimeType: "image/png" })).toEqual({
      text: "KORTEX 42",
    });
    expect((fetch.calls[0]?.body as FormData).get("providers")).toBe("google");
  });

  it("async OCR runs a job and keeps the pages", async () => {
    const fetch = fakeFetch([
      {
        match: (u, i) => u === "https://api.edenai.run/v2/ocr/ocr_async" && i?.method === "POST",
        respond: () => json({ public_id: "o1" }),
      },
      {
        match: (u) => u.endsWith("/ocr_async/o1"),
        respond: () =>
          json({
            status: "finished",
            results: {
              mistral: {
                status: "success",
                pages: [{ lines: [{ text: "Seite" }, { text: "eins" }] }, { text: "Seite zwei" }],
              },
            },
          }),
      },
    ]);
    const p = createEdenDocumentParser("ocr_async/mistral/fx-ocr", { ...fast, fetch });
    expect(await p.parse({ url: "https://x.test/scan.pdf" })).toEqual({
      text: "Seite\neins\n\nSeite zwei",
      pages: ["Seite\neins", "Seite zwei"],
    });
    expect(fetch.calls[0]?.body).toMatchObject({
      providers: "mistral",
      settings: { mistral: "fx-ocr" },
      file_url: "https://x.test/scan.pdf",
    });
  });

  it("finds results keyed by provider/model (live Eden response shape, WP-F)", async () => {
    const fetch = fakeFetch([
      {
        match: (u, i) => u === "https://api.edenai.run/v2/ocr/ocr_async" && i?.method === "POST",
        // Recorded shape: Eden answers the POST with the finished job already.
        respond: () =>
          json({
            public_id: "o2",
            status: "finished",
            error: null,
            results: {
              "mistral/fx-ocr": {
                error: null,
                final_status: "succeeded",
                cost: 0.004,
                pages: [{ lines: [{ text: "KORTEX OCR 2026" }] }],
                raw_text: "KORTEX OCR 2026",
                number_of_pages: 1,
              },
            },
          }),
      },
      {
        match: (u) => u.endsWith("/ocr_async/o2"),
        respond: () =>
          json({
            status: "finished",
            results: {
              "mistral/fx-ocr": {
                final_status: "succeeded",
                pages: [{ lines: [{ text: "KORTEX OCR 2026" }] }],
              },
            },
          }),
      },
    ]);
    const p = createEdenDocumentParser("ocr_async/mistral/fx-ocr", { ...fast, fetch });
    expect((await p.parse({ url: "https://x.test/scan.png" })).text).toBe("KORTEX OCR 2026");
  });

  it("treats final_status 'failed' as a failure", async () => {
    const fetch = fakeFetch([
      {
        match: (u, i) => u === "https://api.edenai.run/v2/ocr/ocr_async" && i?.method === "POST",
        respond: () => json({ public_id: "o3" }),
      },
      {
        match: (u) => u.endsWith("/ocr_async/o3"),
        respond: () =>
          json({
            status: "finished",
            results: { "mistral/fx-ocr": { final_status: "failed", error: "bad file" } },
          }),
      },
    ]);
    const p = createEdenDocumentParser("ocr_async/mistral/fx-ocr", { ...fast, fetch });
    await expect(p.parse({ url: "https://x.test/scan.png" })).rejects.toThrow(/bad file/);
  });

  it("rejects non-OCR ids and empty results", async () => {
    expect(() => createEdenDocumentParser("embeddings/openai", fast)).toThrow(ExtractionError);
    const fetch = fakeFetch([
      { match: () => true, respond: () => json({ google: { status: "success", text: "  " } }) },
    ]);
    await expect(
      createEdenDocumentParser("ocr/google", { ...fast, fetch }).parse({
        url: "https://x.test/a.png",
      }),
    ).rejects.toThrow(/ohne Text/);
  });
});

describe("Eden AI embeddings", () => {
  it("works with embedMany and sends provider + model settings", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === "https://api.edenai.run/v2/text/embeddings",
        respond: (_u, init) => {
          const { texts } = JSON.parse(String(init?.body)) as { texts: string[] };
          return json({
            openai: { status: "success", items: texts.map((_, i) => ({ embedding: [i, 0.5] })) },
          });
        },
      },
    ]);
    const model = createEdenEmbeddingModel("embeddings/openai/1536__fx-ada", { ...fast, fetch });
    const { embeddings } = await embedMany({ model, values: ["a", "b"] });
    expect(embeddings).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
    expect(fetch.calls[0]?.body).toEqual({
      providers: "openai",
      texts: ["a", "b"],
      settings: { openai: "1536__fx-ada" },
    });
  });

  it("surfaces provider errors", async () => {
    const fetch = fakeFetch([
      {
        match: () => true,
        respond: () => json({ openai: { status: "fail", error: { message: "quota" } } }),
      },
    ]);
    const model = createEdenEmbeddingModel("embeddings/openai", { ...fast, fetch });
    await expect(embedMany({ model, values: ["a"], maxRetries: 0 })).rejects.toThrow(/quota/);
  });
});
