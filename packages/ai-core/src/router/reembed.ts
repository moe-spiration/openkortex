import { t } from "../i18n";
import {
  embeddingModelKey,
  getEmbeddingLock,
  setEmbeddingLock,
  toPgVector,
  type EmbeddingLock,
  type EmbeddingProvider,
  type Json,
  type KortexClient,
} from "@kortex/db";
import { embedTexts } from "../enrichment/embeddings";
import { createModelRouter, type ModelRouter } from "./model-router";

// Explicit switch of a user's embedding model: rewrite every chunk vector with the new model,
// then move kortex.user_settings.embedding_lock. Never runs on its own; the md-sync `reembed`
// script calls it (dry run by default).
//
// While it runs, searches still use the old lock and only see chunks of the old model (the RPC
// filters by model), so items already rewritten fall back to full-text until the lock moves.
// Resumable: chunks that already carry the target model are skipped.

const PAGE = 500;
const CHUNK_COLUMNS =
  "id,item_id,user_id,chunk_index,chunk_heading,page_or_timestamp,chunk_text,metadata" as const;

export interface ReembedTarget {
  provider: EmbeddingProvider;
  model_id: string;
}

export interface ReembedOptions {
  /** Service role or the user's session; every query filters by `userId`. */
  client: KortexClient;
  userId: string;
  target: ReembedTarget;
  /** Server env with the target provider's key. */
  env?: Record<string, string | undefined>;
  /** Router for the target model (tests). Default: createModelRouter locked to `target`. */
  models?: ModelRouter;
  /** Count only, write nothing (default true). */
  dryRun?: boolean;
  batchSize?: number;
  log?: (message: string) => void;
}

export interface ReembedResult {
  from: EmbeddingLock | null;
  to: string;
  chunks: number;
  /** Chunks that need (dry run) or got a new vector. */
  pending: number;
  reembedded: number;
  /** Rough input size (chars / 4) of the pending chunks, for a cost estimate. */
  tokenEstimate: number;
  lock: EmbeddingLock | null;
}

interface ChunkRow {
  id: string;
  item_id: string;
  user_id: string;
  chunk_index: number;
  chunk_heading: string | null;
  page_or_timestamp: string | null;
  chunk_text: string;
  metadata: Json | null;
}

const metaOf = (m: Json | null): Record<string, Json | undefined> =>
  m && typeof m === "object" && !Array.isArray(m) ? m : {};

async function loadChunks(client: KortexClient, userId: string): Promise<ChunkRow[]> {
  const out: ChunkRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("item_chunks")
      .select(CHUNK_COLUMNS)
      .eq("user_id", userId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load item_chunks: ${error.message}`);
    out.push(...((data ?? []) as ChunkRow[]));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

/** Re-embeds every chunk of `userId` with `target`, then moves the embedding lock to it. */
export async function reembedUser(opts: ReembedOptions): Promise<ReembedResult> {
  const { client, userId, target } = opts;
  const dryRun = opts.dryRun ?? true;
  const log = opts.log ?? (() => {});
  const to = embeddingModelKey(target);
  const from = await getEmbeddingLock(client, userId);
  const chunks = await loadChunks(client, userId);
  const pending = chunks.filter((c) => metaOf(c.metadata).embedding_model !== to);
  const tokenEstimate = Math.ceil(pending.reduce((n, c) => n + c.chunk_text.length, 0) / 4);
  const result: ReembedResult = {
    from,
    to,
    chunks: chunks.length,
    pending: pending.length,
    reembedded: 0,
    tokenEstimate,
    lock: from,
  };
  log(
    t("re-embed {from} → {to}: {pending} of {total} chunks, ~{tokens} tokens", {
      from: from ? embeddingModelKey(from) : `(${t("no lock")})`,
      to,
      pending: pending.length,
      total: chunks.length,
      tokens: tokenEstimate,
    }),
  );
  if (dryRun) return result;

  const models =
    opts.models ?? createModelRouter({ env: opts.env ?? {}, embeddingLock: { ...target, dimensions: 1536 } });
  const model = models.embedding();
  const batch = opts.batchSize ?? 64;
  for (let i = 0; i < pending.length; i += batch) {
    const rows = pending.slice(i, i + batch);
    const vectors = await embedTexts(
      rows.map((r) => r.chunk_text),
      { model },
    );
    const { error } = await client.from("item_chunks").upsert(
      rows.map((r, j) => ({
        ...r,
        embedding: toPgVector(vectors[j] as number[]),
        metadata: { ...metaOf(r.metadata), embedding_model: to } as Json,
      })),
      { onConflict: "id" },
    );
    if (error) throw new Error(`save item_chunks: ${error.message}`);
    result.reembedded += rows.length;
    log(`  ${result.reembedded}/${pending.length}`);
  }
  result.lock = await setEmbeddingLock(client, userId, target);
  log(`lock → ${to}`);
  return result;
}
