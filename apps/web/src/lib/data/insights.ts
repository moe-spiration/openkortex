"use server";

import { createUserModelRouter, modelFor, modelIdFor } from "@kortex/ai-core";
import type { Json, KortexClient } from "@kortex/db";
import type { InsightsData } from "@/lib/mock/insights";
import { getServerDeps } from "@/server/deps";
import { basisLine, computeInsights, type VaultFact } from "@/server/insights/compute";
import {
  buildImpulseInput,
  generateImpulses,
  inputHash,
  MIN_ITEMS,
  needsRefresh,
  type ImpulseCache,
} from "@/server/insights/impulses";
import { computeLife } from "@/server/life/compute";
import type { LifeSource } from "@/server/life/source";
import { readInsights, writeInsight, type InsightRow } from "@/server/life/state";
import { runData, sourceFor, type DataCtx, type DataResult } from "./run";

/*
 * Insights, live (WP-I). `loadInsights` is cheap and never calls a model: figures from the DB plus
 * the cached impulses. When those are missing or stale the view calls `refreshImpulses`, which runs
 * the routed `summarize` model once and caches the result (server/insights/impulses.ts).
 */

async function vaultFacts(client: KortexClient, userId: string): Promise<VaultFact[]> {
  const out: VaultFact[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await client
      .from("knowledge_items")
      .select("type,source_platform")
      .eq("user_id", userId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`load item facts: ${error.message}`);
    out.push(...(data ?? []).map((r) => ({ type: r.type, platform: r.source_platform })));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

const cacheOf = (row: InsightRow | undefined): (ImpulseCache & { hash: string | null }) | null => {
  const p = row?.payload as Partial<ImpulseCache> | undefined;
  return p && Array.isArray(p.recommendations) && typeof p.generated_at === "string"
    ? {
        recommendations: p.recommendations,
        top: Array.isArray(p.top) ? p.top : [],
        generated_at: p.generated_at,
        model: String(p.model ?? ""),
        hash: row!.input_hash,
      }
    : null;
};

async function prepare(ctx: DataCtx) {
  const [src, vault, rows] = await Promise.all([
    sourceFor(ctx),
    vaultFacts(ctx.client, ctx.userId),
    readInsights(ctx.client, ctx.userId, "impulses"),
  ]);
  const life = computeLife(src);
  const input = buildImpulseInput(src, life);
  return {
    src,
    vault,
    life,
    input,
    hash: inputHash(input),
    cache: cacheOf(rows.find((r) => r.key === "")),
  };
}

type Impulses = Pick<InsightsData, "recommendations" | "top" | "impulses" | "basis">;

function impulsesState(
  src: LifeSource,
  p: Awaited<ReturnType<typeof prepare>>,
  counts: Record<string, number>,
  now: Date,
): Impulses {
  if (p.input.items.length < MIN_ITEMS && !p.cache)
    return {
      recommendations: [],
      top: [],
      impulses: "too_little",
      basis: basisLine(counts, null, src.timeZone),
    };
  if (!p.cache)
    return {
      recommendations: [],
      top: [],
      impulses: "none",
      basis: basisLine(counts, null, src.timeZone),
    };
  const stale =
    p.input.items.length >= MIN_ITEMS &&
    needsRefresh({ at: p.cache.generated_at, hash: p.cache.hash }, p.hash, now);
  return {
    recommendations: p.cache.recommendations,
    top: p.cache.top,
    impulses: stale ? "stale" : "fresh",
    basis: basisLine(counts, p.cache.generated_at, src.timeZone),
  };
}

export async function loadInsights(): Promise<DataResult<InsightsData>> {
  return runData("loadInsights", async (ctx) => {
    const p = await prepare(ctx);
    const { counts, ...figures } = computeInsights(p.src, p.vault, ctx.now);
    return { ...figures, ...impulsesState(p.src, p, counts, ctx.now) };
  });
}

/** Regenerates the impulses when needed (one routed `summarize` call) and returns them. */
export async function refreshImpulses(force = false): Promise<DataResult<Impulses>> {
  return runData("refreshImpulses", async (ctx) => {
    const p = await prepare(ctx);
    const { counts } = computeInsights(p.src, p.vault, ctx.now);
    if (p.input.items.length < MIN_ITEMS) return impulsesState(p.src, p, counts, ctx.now);
    if (
      !force &&
      p.cache &&
      !needsRefresh({ at: p.cache.generated_at, hash: p.cache.hash }, p.hash, ctx.now)
    )
      return impulsesState(p.src, p, counts, ctx.now);

    const deps = getServerDeps();
    const router = await createUserModelRouter({
      client: ctx.client,
      userId: ctx.userId,
      env: deps.env.raw,
      catalog: await deps.loadCatalog(),
      lockEmbeddings: false,
      warn: (m) => deps.log.info(`routing: ${m}`),
    });
    const { recommendations, top } = await generateImpulses(
      modelFor(router.models, "summarize"),
      p.input,
    );
    const cache: ImpulseCache = {
      recommendations,
      top,
      generated_at: ctx.now.toISOString(),
      model: modelIdFor(router.models, "summarize"),
    };
    await writeInsight(ctx.client, ctx.userId, {
      kind: "impulses",
      key: "",
      payload: cache as unknown as Json,
      input_hash: p.hash,
    });
    return {
      recommendations,
      top,
      impulses: "fresh",
      basis: basisLine(counts, cache.generated_at, p.src.timeZone),
    };
  });
}
