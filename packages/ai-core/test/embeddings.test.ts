import { describe, expect, it } from "vitest";
import { embedTexts } from "../src/enrichment/embeddings";
import { EmbeddingDimensionError } from "../src/errors";
import { mockEmbeddingModel } from "./helpers";

describe("embedTexts", () => {
  it("batches requests and keeps the input order", async () => {
    const model = mockEmbeddingModel();
    const texts = Array.from({ length: 150 }, (_, i) => "x".repeat(i + 1));
    const out = await embedTexts(texts, { model, batchSize: 64 });
    expect(model.doEmbedCalls.map((c) => c.values.length)).toEqual([64, 64, 22]);
    expect(out).toHaveLength(150);
    expect(out.map((e) => e[0])).toEqual(texts.map((t) => t.length));
    expect(out.every((e) => e.length === 1536)).toBe(true);
    expect(model.doEmbedCalls[0]?.dimensions).toBe(1536);
  });

  it("rejects embeddings with the wrong dimension", async () => {
    await expect(embedTexts(["a"], { model: mockEmbeddingModel(768) })).rejects.toBeInstanceOf(
      EmbeddingDimensionError,
    );
  });

  it("does nothing for an empty list", async () => {
    const model = mockEmbeddingModel();
    expect(await embedTexts([], { model })).toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);
  });
});
