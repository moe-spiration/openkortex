import { wrapEmbeddingModel, wrapLanguageModel, type EmbeddingModel, type LanguageModel } from "ai";
import type { AiTask } from "@kortex/db";
import type { CatalogModel } from "../providers/catalog";
import type { ModelRouter } from "../router/model-router";
import type { UsageEntry } from "./budget";
import { estimateCost, tokenPriceOf, providerOf, tokenCounts } from "./pricing";

/*
 * Metering for callers without a web request (md-sync, MCP organizer): the same router, with
 * every generate/stream/embed call reported to `record` with tokens and a cost estimate. The web
 * server has its own wrapper (request-scoped payer) built on the same pricing.
 */

export interface MeterOptions {
  /** Catalog for prices; a model without a price is charged the conservative default. */
  catalog?: () => readonly CatalogModel[] | Promise<readonly CatalogModel[]>;
  record: (entry: Omit<UsageEntry, "userId">) => Promise<void> | void;
}

type ModelInfo = { provider?: string; modelId?: string };

async function report(
  opts: MeterOptions,
  task: string,
  model: ModelInfo,
  usage: unknown,
  kind: "text" | "embedding",
): Promise<void> {
  const tokens = tokenCounts(usage);
  if (!tokens.input && !tokens.output) return;
  const provider = providerOf(model.provider);
  let catalog: readonly CatalogModel[] = [];
  try {
    catalog = (await opts.catalog?.()) ?? [];
  } catch {
    /* priced with the default */
  }
  const cost = estimateCost(tokens, tokenPriceOf(catalog, provider, model.modelId ?? ""), kind);
  try {
    await opts.record({
      provider,
      task,
      modelId: model.modelId ?? null,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      costUsd: cost.usd,
      estimated: cost.estimated,
    });
  } catch {
    /* metering never breaks the call */
  }
}

export function meterLanguageModelWith(
  model: LanguageModel,
  task: string,
  opts: MeterOptions,
): LanguageModel {
  if (typeof model === "string") return model;
  const info = model as ModelInfo;
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        await report(opts, task, info, result.usage, "text");
        return result;
      },
      wrapStream: async ({ doStream }) => {
        const { stream, ...rest } = await doStream();
        let usage: unknown = null;
        const tap = new TransformStream({
          transform(part, controller) {
            if ((part as { type?: string }).type === "finish")
              usage = (part as { usage?: unknown }).usage;
            controller.enqueue(part);
          },
          async flush() {
            await report(opts, task, info, usage, "text");
          },
        });
        return { stream: stream.pipeThrough(tap), ...rest };
      },
    },
  }) as LanguageModel;
}

export function meterEmbeddingModelWith(model: EmbeddingModel, opts: MeterOptions): EmbeddingModel {
  if (typeof model === "string") return model;
  const info = model as ModelInfo;
  return wrapEmbeddingModel({
    model: model as Parameters<typeof wrapEmbeddingModel>[0]["model"],
    middleware: {
      wrapEmbed: async ({ doEmbed }) => {
        const result = await doEmbed();
        await report(opts, "embeddings", info, result.usage, "embedding");
        return result;
      },
    },
  }) as EmbeddingModel;
}

/**
 * The same router with every language and embedding model metered. Live routers stay live: each
 * accessor asks the wrapped router again. Transcription and document parsing (Eden AI, billed per
 * unit) pass through unmetered, as in the web server.
 */
export function meterModelRouter(router: ModelRouter, opts: MeterOptions): ModelRouter {
  const lm = (task: AiTask, m: LanguageModel) => meterLanguageModelWith(m, task, opts);
  return {
    get modelIds() {
      return router.modelIds;
    },
    fast: () => lm("summarize", router.fast()),
    chat: () => lm("chat_reasoning", router.chat()),
    vision: () => lm("vision_ocr", router.vision()),
    embedding: () => meterEmbeddingModelWith(router.embedding(), opts),
    ...(router.forTask ? { forTask: (task) => lm(task, router.forTask!(task)) } : {}),
    ...(router.route ? { route: (task) => router.route!(task) } : {}),
    ...(router.transcriber ? { transcriber: () => router.transcriber!() } : {}),
    ...(router.documentParser ? { documentParser: () => router.documentParser!() } : {}),
  };
}
