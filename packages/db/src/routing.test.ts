import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_TASKS,
  DEFAULT_AI_ROUTING,
  EMBEDDING_DIMENSIONS,
  embeddingModelKey,
  embeddingRouteDiffers,
  mergeAiRouting,
  parseEmbeddingLock,
  modelServesTask,
  parseAiRouting,
  resolveTaskRoute,
} from "./routing";

describe("DEFAULT_AI_ROUTING", () => {
  it("routes the text tasks to Anthropic on Auto with the ADR-06 modes", () => {
    expect(DEFAULT_AI_ROUTING.summarize).toEqual({ provider: "anthropic", model_id: null, auto_mode: "cost_efficient" });
    expect(DEFAULT_AI_ROUTING.auto_organize.auto_mode).toBe("cost_efficient");
    expect(DEFAULT_AI_ROUTING.meeting_coach.auto_mode).toBe("balanced");
    expect(DEFAULT_AI_ROUTING.chat_reasoning.auto_mode).toBe("max_quality");
    expect(DEFAULT_AI_ROUTING.vision_ocr.provider).toBe("openrouter");
    expect(DEFAULT_AI_ROUTING.audio_transcription.provider).toBe("edenai");
    expect(DEFAULT_AI_ROUTING.embeddings).toMatchObject({ provider: "openrouter", dimensions: EMBEDDING_DIMENSIONS });
  });

  it("matches the column default of the migration", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261024000000_ai_routing_config.sql", import.meta.url), "utf8");
    const json = /default '(\{[\s\S]*?\})'::jsonb;/.exec(sql)?.[1];
    expect(json).toBeDefined();
    expect(JSON.parse(json!)).toEqual(DEFAULT_AI_ROUTING);
  });

  it("has no hardcoded model ids", () => {
    for (const t of AI_TASKS) expect(DEFAULT_AI_ROUTING[t].model_id).toBeNull();
  });
});

describe("parseAiRouting", () => {
  it("fills missing and invalid tasks from the defaults and ignores unknown keys", () => {
    const cfg = parseAiRouting({
      chat_reasoning: { provider: "openrouter", model_id: "deepseek/deepseek-r1", auto_mode: "max_quality" },
      vision_ocr: { provider: "nope", model_id: null },
      legacy: true,
    });
    expect(cfg.chat_reasoning.model_id).toBe("deepseek/deepseek-r1");
    expect(cfg.vision_ocr).toEqual(DEFAULT_AI_ROUTING.vision_ocr);
    expect(cfg.summarize).toEqual(DEFAULT_AI_ROUTING.summarize);
    expect(Object.keys(cfg).sort()).toEqual([...AI_TASKS].sort());
  });

  it("never throws and always pins the embedding size", () => {
    expect(parseAiRouting(null)).toEqual(DEFAULT_AI_ROUTING);
    expect(parseAiRouting({ embeddings: { provider: "edenai", model_id: "x" } }).embeddings.dimensions).toBe(1536);
  });
});

describe("mergeAiRouting", () => {
  it("applies a partial patch", () => {
    const next = mergeAiRouting(DEFAULT_AI_ROUTING, { summarize: { model_id: "claude-haiku-4-5" } });
    expect(next.summarize).toEqual({ provider: "anthropic", model_id: "claude-haiku-4-5", auto_mode: "cost_efficient" });
    expect(next.chat_reasoning).toEqual(DEFAULT_AI_ROUTING.chat_reasoning);
  });

  it("resets the model to Auto when only the provider changes", () => {
    const pinned = mergeAiRouting(DEFAULT_AI_ROUTING, { summarize: { model_id: "claude-haiku-4-5" } });
    expect(mergeAiRouting(pinned, { summarize: { provider: "openrouter" } }).summarize.model_id).toBeNull();
  });

  it("rejects other embedding sizes, unknown tasks and providers that cannot serve a task", () => {
    expect(() => mergeAiRouting(DEFAULT_AI_ROUTING, { embeddings: { dimensions: 3072 } })).toThrow();
    expect(() => mergeAiRouting(DEFAULT_AI_ROUTING, { translate: { provider: "anthropic" } })).toThrow();
    expect(() => mergeAiRouting(DEFAULT_AI_ROUTING, { embeddings: { provider: "anthropic" } })).toThrow();
    expect(() => mergeAiRouting(DEFAULT_AI_ROUTING, { summarize: { auto_mode: "fastest" } })).toThrow();
  });
});

describe("catalog helpers", () => {
  it("only accepts 1536-dim embedding models for the embeddings task", () => {
    expect(modelServesTask({ capabilities: ["embeddings"], embedding_dimensions: 1536 }, "embeddings")).toBe(true);
    expect(modelServesTask({ capabilities: ["embeddings"], embedding_dimensions: 3072 }, "embeddings")).toBe(false);
    expect(modelServesTask({ capabilities: ["chat", "vision"], embedding_dimensions: null }, "vision_ocr")).toBe(true);
    expect(modelServesTask({ capabilities: ["chat"], embedding_dimensions: null }, "vision_ocr")).toBe(false);
  });

  it("resolves a task route with fallback", () => {
    expect(resolveTaskRoute(null, "meeting_coach")).toEqual(DEFAULT_AI_ROUTING.meeting_coach);
  });
});

describe("embedding lock", () => {
  const lock = { provider: "openrouter", model_id: "vendor/embed", dimensions: 1536, locked_at: "2026-10-25T00:00:00Z" } as const;

  it("parses only valid 1536-dim locks of an embeddings provider", () => {
    expect(parseEmbeddingLock(lock)).toEqual(lock);
    expect(parseEmbeddingLock(null)).toBeNull();
    expect(parseEmbeddingLock({ ...lock, dimensions: 768 })).toBeNull();
    expect(parseEmbeddingLock({ ...lock, provider: "anthropic" })).toBeNull();
    expect(parseEmbeddingLock({ ...lock, model_id: "" })).toBeNull();
  });

  it("keys a model as provider:model_id", () => {
    expect(embeddingModelKey(lock)).toBe("openrouter:vendor/embed");
  });

  it("flags a routing that names another model than the lock (Auto on the same provider is fine)", () => {
    const routing = parseAiRouting(null);
    const pl = parseEmbeddingLock(lock);
    expect(embeddingRouteDiffers(routing, null)).toBe(false);
    expect(embeddingRouteDiffers(routing, pl)).toBe(false);
    const exact = { ...routing, embeddings: { ...routing.embeddings, model_id: "vendor/embed" } };
    expect(embeddingRouteDiffers(exact, pl)).toBe(false);
    const other = { ...routing, embeddings: { ...routing.embeddings, model_id: "vendor/other" } };
    expect(embeddingRouteDiffers(other, pl)).toBe(true);
    const eden = { ...routing, embeddings: { ...routing.embeddings, provider: "edenai" as const } };
    expect(embeddingRouteDiffers(eden, pl)).toBe(true);
  });
});
