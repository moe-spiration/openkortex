import { describe, expect, it, vi } from "vitest";
import {
  AI_PROVIDERS,
  AI_TASKS,
  AUTO_MODES,
  DEFAULT_AI_ROUTING,
  modelServesTask,
  type AiProvider,
} from "@kortex/db";
import { ConfigError } from "../src/errors";
import {
  OFFLINE_FALLBACK,
  pickAutoModel,
  resolveRoute,
  staleOfflineFallbacks,
} from "../src/router/auto-select";
import {
  ANTHROPIC_CATALOG,
  EDEN_CATALOG,
  FULL_CATALOG,
  m,
  OPENROUTER_CATALOG,
} from "./fixtures/catalog";

const ALL_KEYS = { anthropic: "a", openrouter: "o", edenai: "e" };
const serving = (task: Parameters<typeof modelServesTask>[1], list = FULL_CATALOG) =>
  list.filter((m) => modelServesTask(m, task));

describe("pickAutoModel", () => {
  it("named lines: newest haiku / sonnet / opus per mode, retired models skipped", () => {
    const chat = serving("summarize", ANTHROPIC_CATALOG);
    expect(pickAutoModel(chat, "cost_efficient")?.model_id).toBe("fx-haiku-new");
    expect(pickAutoModel(chat, "balanced")?.model_id).toBe("fx-sonnet-new");
    // fx-opus-retired is newer but not available; fable is not an Auto line.
    expect(pickAutoModel(chat, "max_quality")?.model_id).toBe("fx-opus-new");
  });

  it("price-based without lines: cheapest, median, most expensive among recent models", () => {
    const vision = serving("vision_ocr", OPENROUTER_CATALOG);
    // excluded: :free variant, openrouter/auto meta router, a 2023 model outside the recency window
    expect(pickAutoModel(vision, "cost_efficient")?.model_id).toBe("fx/vision-cheap");
    expect(pickAutoModel(vision, "balanced")?.model_id).toBe("fx/vision-mid");
    expect(pickAutoModel(vision, "max_quality")?.model_id).toBe("fx/vision-pro");
  });

  it("embeddings: only 1536-dim models are candidates", () => {
    const emb = serving("embeddings", OPENROUTER_CATALOG);
    expect(emb.map((m) => m.model_id)).toEqual(["fx/emb-1536-cheap", "fx/emb-1536-pricey"]);
    expect(pickAutoModel(emb, "cost_efficient")?.model_id).toBe("fx/emb-1536-cheap");
    expect(pickAutoModel(serving("embeddings", EDEN_CATALOG), "balanced")?.model_id).toBe(
      "embeddings/openai/1536__fx-ada",
    );
  });

  it("per-unit prices (Eden AI speech-to-text) rank the same way", () => {
    const stt = serving("audio_transcription", EDEN_CATALOG);
    expect(pickAutoModel(stt, "cost_efficient")?.model_id).toBe(
      "speech_to_text_async/deepgram/fx-nova",
    );
    expect(pickAutoModel(stt, "balanced")?.model_id).toBe("speech_to_text_async/assembly");
    expect(pickAutoModel(stt, "max_quality")?.model_id).toBe("speech_to_text_async/google");
  });

  it("returns null when nothing qualifies", () => {
    expect(pickAutoModel([], "balanced")).toBeNull();
  });
});

describe("resolveRoute", () => {
  it("defaults resolve against the catalog: Anthropic for text, OpenRouter vision/embeddings, Eden AI audio/documents", () => {
    const pick = (task: keyof typeof DEFAULT_AI_ROUTING) =>
      resolveRoute({
        task,
        route: DEFAULT_AI_ROUTING[task],
        catalog: FULL_CATALOG,
        keys: ALL_KEYS,
      });
    expect(pick("summarize")).toEqual({
      task: "summarize",
      provider: "anthropic",
      modelId: "fx-haiku-new",
      source: "auto",
      autoMode: "cost_efficient",
    });
    expect(pick("auto_organize").modelId).toBe("fx-haiku-new");
    expect(pick("meeting_coach").modelId).toBe("fx-sonnet-new");
    expect(pick("chat_reasoning").modelId).toBe("fx-opus-new");
    expect(pick("vision_ocr")).toMatchObject({ provider: "openrouter", modelId: "fx/vision-mid" });
    expect(pick("audio_transcription")).toMatchObject({
      provider: "edenai",
      modelId: "speech_to_text_async/assembly",
    });
    expect(pick("document_parsing")).toMatchObject({
      provider: "edenai",
      modelId: "ocr_async/mistral/fx-ocr",
    });
    expect(pick("embeddings")).toMatchObject({
      provider: "openrouter",
      modelId: "fx/emb-1536-cheap",
    });
  });

  it("an exact model id is used as configured", () => {
    const r = resolveRoute({
      task: "summarize",
      route: { provider: "anthropic", model_id: "fx-any-model", auto_mode: "cost_efficient" },
      catalog: [],
      keys: ALL_KEYS,
    });
    expect(r).toEqual({
      task: "summarize",
      provider: "anthropic",
      modelId: "fx-any-model",
      source: "exact",
    });
  });

  it("falls back to another provider when the configured one has no key, and says so", () => {
    const warn = vi.fn();
    const r = resolveRoute({
      task: "meeting_coach",
      route: DEFAULT_AI_ROUTING.meeting_coach,
      catalog: FULL_CATALOG,
      keys: { openrouter: "o" },
      warn,
    });
    // chat candidates: text-only 0.075, vision-cheap 0.25, vision-mid 2.5, vision-pro 12.5 → median
    expect(r).toMatchObject({ provider: "openrouter", source: "auto", modelId: "fx/vision-cheap" });
    expect(r.note).toContain("anthropic: kein API-Key");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("weiter mit openrouter"));
  });

  it("uses the marked offline fallback only when the provider's catalog is empty, with a warning", () => {
    const warn = vi.fn();
    const r = resolveRoute({
      task: "summarize",
      route: DEFAULT_AI_ROUTING.summarize,
      catalog: [],
      keys: { anthropic: "a" },
      warn,
    });
    expect(r).toMatchObject({
      provider: "anthropic",
      source: "offline_fallback",
      modelId: OFFLINE_FALLBACK.anthropic?.chat?.cost_efficient,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Offline-Fallback"));

    // A non-empty catalog without a fitting model is trusted: no offline list.
    expect(() =>
      resolveRoute({
        task: "embeddings",
        route: DEFAULT_AI_ROUTING.embeddings,
        catalog: OPENROUTER_CATALOG.filter((m) => m.embedding_dimensions === 3072),
        keys: { openrouter: "o" },
      }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError naming every reason when no provider can serve the task", () => {
    expect(() =>
      resolveRoute({
        task: "audio_transcription",
        route: DEFAULT_AI_ROUTING.audio_transcription,
        catalog: FULL_CATALOG,
        keys: { anthropic: "a" },
      }),
    ).toThrow(/audio_transcription.*edenai: kein API-Key.*openrouter: kein API-Key/);
  });
});

describe("offline fallback (offline only)", () => {
  // One unrelated row per provider: the catalog "exists" but serves nothing useful.
  const stubCatalog = AI_PROVIDERS.map((p) => m(p, `fx-${p}-unrelated`, []));

  it("is never used while a catalog exists: any task, provider, mode or key set", () => {
    const keySets = [ALL_KEYS, { anthropic: "a" }, { openrouter: "o" }, { edenai: "e" }];
    for (const catalog of [FULL_CATALOG, stubCatalog]) {
      for (const task of AI_TASKS) {
        for (const provider of AI_PROVIDERS) {
          for (const auto_mode of AUTO_MODES) {
            for (const keys of keySets) {
              let source: string | undefined;
              try {
                source = resolveRoute({
                  task,
                  route: { provider, model_id: null, auto_mode },
                  catalog,
                  keys,
                }).source;
              } catch (err) {
                expect(err).toBeInstanceOf(ConfigError);
              }
              if (source === "offline_fallback")
                throw new Error(
                  `offline fallback used with a catalog: ${task} via ${provider} (${auto_mode})`,
                );
            }
          }
        }
      }
    }
  });

  it("staleOfflineFallbacks: current list → nothing; a dropped id is reported; empty providers skipped", () => {
    const listed = Object.entries(OFFLINE_FALLBACK).flatMap(([provider, caps]) =>
      Object.values(caps ?? {}).flatMap((modes) =>
        Object.values(modes as Record<string, string>).map((id) =>
          m(provider as AiProvider, id, []),
        ),
      ),
    );
    expect(staleOfflineFallbacks(listed)).toEqual([]);
    expect(staleOfflineFallbacks([])).toEqual([]);

    const embId = OFFLINE_FALLBACK.openrouter!.embeddings!.default;
    const withoutEmb = listed.map((x) =>
      x.model_id === embId ? { ...x, is_available: false } : x,
    );
    expect(staleOfflineFallbacks(withoutEmb)).toEqual([
      { provider: "openrouter", capability: "embeddings", mode: "default", modelId: embId },
    ]);
  });

  it("embeddings never switch provider: a missing key is a clear error, not another vector space", () => {
    expect(() =>
      resolveRoute({
        task: "embeddings",
        route: DEFAULT_AI_ROUTING.embeddings,
        catalog: FULL_CATALOG,
        keys: { edenai: "e" },
      }),
    ).toThrow(/embeddings.*openrouter: kein API-Key \(OPENROUTER_API_KEY fehlt\)/);
    // Text tasks still fall back (with a warning), as before.
    expect(
      resolveRoute({
        task: "summarize",
        route: DEFAULT_AI_ROUTING.summarize,
        catalog: FULL_CATALOG,
        keys: { edenai: "e" },
      }).provider,
    ).toBe("edenai");
  });
});
