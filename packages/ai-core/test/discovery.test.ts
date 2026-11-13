import { describe, expect, it } from "vitest";
import { modelServesTask } from "@kortex/db";
import { describedDimensions, discoverModels } from "../src/providers/discovery";
import { ConfigError } from "../src/errors";
import {
  anthropicPage1,
  anthropicPage2,
  edenLlms,
  edenSubfeatures,
  openRouterEmbeddings,
  openRouterModels,
  PROBE_DIMS,
} from "./fixtures/provider-listings";
import { fakeFetch, json } from "./helpers";

const NOW = () => new Date("2026-10-24T08:00:00.000Z");

describe("discoverModels: anthropic", () => {
  it("pages through /v1/models and maps line, release date and capabilities", async () => {
    const fetch = fakeFetch([
      {
        match: (u) =>
          u.startsWith("https://api.anthropic.com/v1/models") && !u.includes("after_id"),
        respond: () => json(anthropicPage1),
      },
      { match: (u) => u.includes("after_id=fx-sonnet-9"), respond: () => json(anthropicPage2) },
    ]);
    const models = await discoverModels("anthropic", {
      env: { CLAUDE_API_KEY: "ak" },
      fetch,
      now: NOW,
    });
    expect(fetch.calls[0]?.headers).toMatchObject({
      "x-api-key": "ak",
      "anthropic-version": "2023-06-01",
    });
    expect(fetch.calls.map((c) => c.url).join(" ")).not.toContain("ak");
    expect(
      models.map((m) => [m.model_id, m.capabilities.join("+"), m.is_available, m.raw?.family]),
    ).toEqual([
      ["fx-haiku-9", "chat+vision+document_parsing", true, "haiku"],
      ["fx-sonnet-9", "chat+vision", true, "sonnet"],
      ["fx-opus-old", "chat+vision+document_parsing", false, "opus"],
      ["fx-legacy", "chat+vision+document_parsing", true, null],
    ]);
    expect(models[0]).toMatchObject({
      provider: "anthropic",
      display_name: "Fixture Haiku 9",
      context_length: 1_000_000,
      pricing: {},
      fetched_at: "2026-10-24T08:00:00.000Z",
      raw: { released_at: "2026-10-07T18:00:00Z" },
    });
  });

  it("needs a key", async () => {
    await expect(discoverModels("anthropic", { env: {} })).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("discoverModels: openrouter", () => {
  const routes = () =>
    fakeFetch([
      {
        match: (u) => u === "https://openrouter.ai/api/v1/models",
        respond: () => json(openRouterModels),
      },
      {
        match: (u) => u === "https://openrouter.ai/api/v1/embeddings/models",
        respond: () => json(openRouterEmbeddings),
      },
      {
        match: (u) => u === "https://openrouter.ai/api/v1/embeddings",
        respond: (_u, init) => {
          const { model } = JSON.parse(String(init?.body)) as { model: string };
          return json({ data: [{ embedding: new Array(PROBE_DIMS[model] ?? 8).fill(0) }] });
        },
      },
    ]);

  it("maps modalities to capabilities, prices to USD per million tokens, created to release date", async () => {
    const fetch = routes();
    const models = await discoverModels("openrouter", {
      env: { OPENROUTER_API_KEY: "ok" },
      fetch,
      now: NOW,
    });
    const chat = models.filter((m) => !m.capabilities.includes("embeddings"));
    expect(chat.map((m) => [m.model_id, m.capabilities.join("+"), m.is_available])).toEqual([
      ["fx/vision-model", "chat+vision+document_parsing", true],
      ["fx/audio-model", "chat+audio_transcription", true],
      ["openrouter/auto", "chat", true],
      ["fx/expired", "chat", false],
    ]);
    expect(chat[0]).toMatchObject({
      pricing: { input_per_mtok: 0.1, output_per_mtok: 0.5 },
      raw: { released_at: new Date(1_791_397_883 * 1000).toISOString() },
    });
    expect(chat[2]?.pricing).toEqual({}); // negative "-1" router prices are not prices
  });

  it("probes paid embedding models for 1536 dims (with data_collection: deny); only those serve the task", async () => {
    const fetch = routes();
    const models = await discoverModels("openrouter", {
      env: { OPENROUTER_API_KEY: "ok" },
      fetch,
      now: NOW,
    });
    const emb = models.filter((m) => m.capabilities.includes("embeddings"));
    expect(emb.map((m) => [m.model_id, m.embedding_dimensions])).toEqual([
      ["fx/emb-1536", 1536],
      ["fx/emb-3072", 3072],
      ["fx/emb-768", 768], // from the description, not probed
      ["fx/emb-free:free", null], // free models are not probed
    ]);
    expect(emb.filter((m) => modelServesTask(m, "embeddings")).map((m) => m.model_id)).toEqual([
      "fx/emb-1536",
    ]);
    const probes = fetch.calls.filter((c) => c.url.endsWith("/embeddings"));
    expect(probes.map((c) => (c.body as { model: string }).model).sort()).toEqual([
      "fx/emb-1536",
      "fx/emb-3072",
    ]);
    for (const p of probes) {
      expect(p.body).toMatchObject({ dimensions: 1536, provider: { data_collection: "deny" } });
      expect(p.headers.authorization).toBe("Bearer ok");
    }
  });

  it("can skip the probes", async () => {
    const fetch = routes();
    const models = await discoverModels("openrouter", {
      env: { OPENROUTER_API_KEY: "ok" },
      fetch,
      probeEmbeddings: false,
    });
    expect(fetch.calls.some((c) => c.url.endsWith("/v1/embeddings"))).toBe(false);
    expect(models.find((m) => m.model_id === "fx/emb-1536")?.embedding_dimensions).toBeNull();
  });

  it("reads sizes from descriptions", () => {
    expect(describedDimensions("A 1024-dim model")).toBe(1024);
    expect(describedDimensions("768 dimensional vectors")).toBe(768);
    expect(describedDimensions("3072-dimension embeddings")).toBe(3072);
    expect(describedDimensions("no size")).toBeNull();
  });
});

describe("discoverModels: edenai", () => {
  const routes = () =>
    fakeFetch([
      {
        match: (u) => u === "https://api.edenai.run/v2/info/provider_subfeatures",
        respond: () => json(edenSubfeatures),
      },
      { match: (u) => u === "https://api.edenai.run/v3/models", respond: () => json(edenLlms) },
    ]);

  it("maps STT, OCR, document parsing, embeddings (with sizes) and LLMs", async () => {
    const fetch = routes();
    const models = await discoverModels("edenai", {
      env: { EDENAI_API_KEY: "ek" },
      fetch,
      now: NOW,
    });
    expect(
      models.map((m) => [
        m.model_id,
        m.capabilities.join("+"),
        m.embedding_dimensions,
        m.is_available,
      ]),
    ).toEqual([
      ["speech_to_text_async/deepgram/fx-nova", "audio_transcription", null, true],
      ["speech_to_text_async/deepgram/fx-enhanced", "audio_transcription", null, true],
      ["ocr/google", "ocr", null, true],
      ["ocr_async/mistral/fx-ocr", "document_parsing+ocr", null, true],
      ["embeddings/openai/fx-small", "embeddings", 1536, true],
      ["embeddings/openai/1536__fx-ada", "embeddings", 1536, true],
      ["embeddings/mistral/1024__fx-embed", "embeddings", 1024, true],
      ["speech_to_text_async/amazon", "audio_transcription", null, false],
      ["llm/mistral/fx-small", "chat+vision", null, true],
    ]);
    const byId = Object.fromEntries(models.map((m) => [m.model_id, m]));
    expect(byId["speech_to_text_async/deepgram/fx-nova"]?.pricing).toEqual({
      per_unit: 0.0052 / 60,
      unit: "second",
    });
    expect(byId["speech_to_text_async/deepgram/fx-enhanced"]?.pricing).toEqual({
      per_unit: 0.0189 / 60,
      unit: "second",
    });
    expect(byId["ocr/google"]?.pricing).toEqual({ per_unit: 0.0015, unit: "page" });
    expect(byId["embeddings/openai/fx-small"]?.pricing).toEqual({ input_per_mtok: 0.02 });
    expect(byId["embeddings/openai/1536__fx-ada"]?.pricing).toEqual({ input_per_mtok: 0.1 });
    expect(byId["llm/mistral/fx-small"]).toMatchObject({
      pricing: { input_per_mtok: 0.15, output_per_mtok: 0.5 },
      context_length: 128_000,
    });
  });

  it("calls the public feature list without a token and the v3 model list with it", async () => {
    const fetch = routes();
    await discoverModels("edenai", { env: { EDENAI_API_KEY: "ek" }, fetch });
    const info = fetch.calls.find((c) => c.url.endsWith("/provider_subfeatures"));
    const llm = fetch.calls.find((c) => c.url.endsWith("/v3/models"));
    expect(info?.headers.authorization).toBeUndefined();
    expect(llm?.headers.authorization).toBe("Bearer ek");
  });
});
