import { embedMany, type EmbeddingModel } from "ai";
import { EmbeddingDimensionError } from "../errors";
import { EMBEDDING_DIMENSIONS } from "../router/model-router";

export interface EmbedOptions {
  model: EmbeddingModel;
  /** Texts per request. Default 64. */
  batchSize?: number;
  /** Batches in flight at once. Default 2. */
  maxParallelBatches?: number;
  dimensions?: number;
  abortSignal?: AbortSignal;
}

/** Batched embeddings with the routed embeddings model (ADR-06), validated to 1536 dims. */
export async function embedTexts(
  texts: readonly string[],
  options: EmbedOptions,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batchSize = Math.max(options.batchSize ?? 64, 1);
  const dims = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) batches.push(texts.slice(i, i + batchSize));

  const results: number[][][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      const { embeddings } = await embedMany({
        model: options.model,
        values: batches[i] as string[],
        dimensions: dims,
        maxParallelCalls: 1,
        abortSignal: options.abortSignal,
      });
      results[i] = embeddings;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.maxParallelBatches ?? 2, batches.length) }, worker),
  );

  const flat = results.flat();
  if (flat.length !== texts.length) {
    throw new EmbeddingDimensionError(`expected ${texts.length} embeddings, got ${flat.length}`);
  }
  for (const e of flat) {
    if (e.length !== dims)
      throw new EmbeddingDimensionError(`expected ${dims} dimensions, got ${e.length}`);
  }
  return flat;
}
