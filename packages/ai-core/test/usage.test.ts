import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  budgetDay,
  budgetStatusFrom,
  estimateCost,
  meterModelRouter,
  tokenPriceOf,
  usageRow,
  type UsageEntry,
} from "../src/usage";
import type { ModelRouter } from "../src/router/model-router";
import { jsonResult, mockEmbeddingModel } from "./helpers";

describe("usage: budget and pricing (shared by web, md-sync, MCP)", () => {
  it("computes the day's status in EUR", () => {
    const s = budgetStatusFrom({ day: "2026-10-31", costsUsd: [1.08, "1.08"], budgetRaw: null, env: {} });
    expect(s).toMatchObject({ budgetEur: 2, exceeded: true, remainingEur: 0 });
    expect(s.spentEur).toBeCloseTo(2);
    expect(budgetStatusFrom({ day: "d", costsUsd: [], budgetRaw: "5", env: {} }).exceeded).toBe(false);
  });

  it("uses the Kortex time zone for the budget day", () => {
    expect(budgetDay({}, new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(budgetDay({ KORTEX_TIMEZONE: "UTC" }, new Date("2026-10-31T23:30:00Z"))).toBe("2026-10-31");
  });

  it("builds clean ai_usage rows and prices unknown models conservatively", () => {
    const row = usageRow(
      { userId: "u", provider: "anthropic", task: "summarize", modelId: "m", inputTokens: 10.6, outputTokens: -1, costUsd: -2, estimated: true },
      "2026-10-31",
    );
    expect(row).toMatchObject({ input_tokens: 11, output_tokens: 0, cost_usd: 0, day: "2026-10-31" });
    expect(tokenPriceOf([], "openrouter", "x")).toBeNull();
    expect(estimateCost({ input: 1e6, output: 0 }, null).estimated).toBe(true);
  });
});

describe("meterModelRouter", () => {
  it("reports every generate call with task, tokens and cost, and keeps the router live", async () => {
    const entries: Omit<UsageEntry, "userId">[] = [];
    let modelId = "a";
    const model = new MockLanguageModelV4({ provider: "openrouter.chat", modelId: "mock", doGenerate: async () => jsonResult("hi") });
    const base: ModelRouter = {
      get modelIds() {
        return { fast: modelId, chat: modelId, vision: modelId, embedding: modelId };
      },
      fast: () => model,
      chat: () => model,
      vision: () => model,
      embedding: () => mockEmbeddingModel(),
    };
    const metered = meterModelRouter(base, {
      catalog: () => [{ provider: "openrouter", model_id: "mock", pricing: { input_per_mtok: 1, output_per_mtok: 2 } } as never],
      record: (e) => {
        entries.push(e);
      },
    });
    await generateText({ model: metered.fast(), prompt: "x" });
    expect(entries).toEqual([
      { provider: "openrouter", task: "summarize", modelId: "mock", inputTokens: 10, outputTokens: 10, costUsd: 0.00003, estimated: false },
    ]);
    modelId = "b";
    expect(metered.modelIds.fast).toBe("b");
  });
});
