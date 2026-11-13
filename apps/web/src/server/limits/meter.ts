import { wrapEmbeddingModel, wrapLanguageModel, type EmbeddingModel, type LanguageModel } from "ai";
import type { AiTask } from "@kortex/db";
import { tokenPriceOf, type CatalogModel, type ModelRouter } from "@kortex/ai-core";
import type { ServerDeps } from "../deps";
import { estimateCost, providerOf, tokenCounts } from "./pricing";
import { currentUsageContext, recordUsage, type UsageContext } from "./usage";

/*
 * Metering of AI calls (S2a): wraps the models a ModelRouter hands out so every generate, stream
 * and embed call records its tokens and a cost estimate in kortex.ai_usage. The payer is the
 * explicit `ctx` or, when omitted, the request's usage context (set by the route wrapper /
 * `withUsageContext`). Calls without a payer are not recorded.
 */

type MeterDeps = Pick<ServerDeps, "clients" | "env" | "log" | "now" | "loadCatalog">;

async function record(deps: MeterDeps, payer: UsageContext | undefined, task: string, model: { provider?: string; modelId?: string }, usage: unknown, kind: "text" | "embedding") {
  if (!payer) return;
  const tokens = tokenCounts(usage);
  if (!tokens.input && !tokens.output) return;
  const provider = providerOf(model.provider);
  let catalog: readonly CatalogModel[] = [];
  try {
    catalog = await deps.loadCatalog();
  } catch {
    /* priced with the default */
  }
  const cost = estimateCost(tokens, tokenPriceOf(catalog, provider, model.modelId ?? ""), kind);
  await recordUsage(deps, {
    userId: payer.userId,
    provider,
    task,
    modelId: model.modelId ?? null,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    costUsd: cost.usd,
    estimated: cost.estimated,
  });
}

export function meterLanguageModel(deps: MeterDeps, model: LanguageModel, task: string, ctx?: UsageContext): LanguageModel {
  if (typeof model === "string") return model;
  const info = model as { provider?: string; modelId?: string };
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const payer = ctx ?? currentUsageContext();
        const result = await doGenerate();
        await record(deps, payer, task, info, result.usage, "text");
        return result;
      },
      wrapStream: async ({ doStream }) => {
        // Capture the payer now: the stream is read later, outside the request's async context.
        const payer = ctx ?? currentUsageContext();
        const { stream, ...rest } = await doStream();
        let usage: unknown = null;
        const tap = new TransformStream({
          transform(part, controller) {
            if ((part as { type?: string }).type === "finish") usage = (part as { usage?: unknown }).usage;
            controller.enqueue(part);
          },
          async flush() {
            await record(deps, payer, task, info, usage, "text");
          },
        });
        return { stream: stream.pipeThrough(tap), ...rest };
      },
    },
  }) as LanguageModel;
}

export function meterEmbeddingModel(deps: MeterDeps, model: EmbeddingModel, ctx?: UsageContext): EmbeddingModel {
  if (typeof model === "string") return model;
  const info = model as { provider?: string; modelId?: string };
  return wrapEmbeddingModel({
    model: model as Parameters<typeof wrapEmbeddingModel>[0]["model"],
    middleware: {
      wrapEmbed: async ({ doEmbed }) => {
        const payer = ctx ?? currentUsageContext();
        const result = await doEmbed();
        await record(deps, payer, "embeddings", info, result.usage, "embedding");
        return result;
      },
    },
  }) as EmbeddingModel;
}

/**
 * The same router, with every language and embedding model metered. Transcription and document
 * parsing (Eden AI, billed per unit) are passed through unmetered for now.
 */
export function meterRouter(deps: MeterDeps, router: ModelRouter, ctx?: UsageContext): ModelRouter {
  const lm = (task: AiTask, m: LanguageModel) => meterLanguageModel(deps, m, task, ctx);
  return {
    ...router,
    modelIds: router.modelIds,
    fast: () => lm("summarize", router.fast()),
    chat: () => lm("chat_reasoning", router.chat()),
    vision: () => lm("vision_ocr", router.vision()),
    embedding: () => meterEmbeddingModel(deps, router.embedding(), ctx),
    ...(router.forTask ? { forTask: (task) => lm(task, router.forTask!(task)) } : {}),
    ...(router.route ? { route: (task) => router.route!(task) } : {}),
    ...(router.transcriber ? { transcriber: () => router.transcriber!() } : {}),
    ...(router.documentParser ? { documentParser: () => router.documentParser!() } : {}),
  };
}
