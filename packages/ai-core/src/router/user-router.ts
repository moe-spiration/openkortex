import { t } from "../i18n";
import {
  embeddingModelKey,
  embeddingRouteDiffers,
  loadRoutingContext,
  lockEmbeddingModel,
  type AiRoutingConfig,
  type AiTask,
  type CatalogRow,
  type EmbeddingLock,
  type EmbeddingProvider,
  type KortexClient,
} from "@kortex/db";
import { ConfigError } from "../errors";
import type { FetchLike } from "../http";
import type { CatalogModel } from "../providers/catalog";
import type { EdenOptions } from "../providers/edenai";
import { providerKeys } from "../providers/keys";
import { PROVIDER_KEY_ENV, type RouteSource } from "./auto-select";
import { createModelRouter, type ModelRouter } from "./model-router";

// ONE resolver for every Kortex process (web, md-sync, MCP server): the user's ai_routing_config,
// the shared model catalog and the user's embedding lock → an ai-core ModelRouter. Whoever embeds
// first pins the embedding model; everyone after that embeds (and searches) with exactly it.

export interface UserModelRouterOptions {
  /**
   * The user's own session (web, MCP in JWT mode) or the service role (md-sync, MCP): every query
   * filters by `userId`. Locking needs UPDATE on the user's kortex.user_settings row.
   */
  client: KortexClient;
  userId: string;
  /** Server env: ANTHROPIC_API_KEY (alias CLAUDE_API_KEY), OPENROUTER_API_KEY, EDENAI_API_KEY. */
  env?: Record<string, string | undefined>;
  /** Catalog the caller already holds (the web app caches it); loaded (paged) when omitted. */
  catalog?: readonly CatalogModel[];
  /** Change the routing before the router is built (e.g. a one-off chat model override). */
  adjustRouting?: (routing: AiRoutingConfig) => AiRoutingConfig;
  /**
   * Pin the embedding model now if none is pinned (default true). Writers must lock before their
   * first vector; read-only callers (a search) may pass false.
   */
  lockEmbeddings?: boolean;
  fetch?: FetchLike;
  warn?: (message: string) => void;
  eden?: Pick<EdenOptions, "pollIntervalMs" | "jobTimeoutMs" | "sleep">;
}

export interface EmbeddingRouteInfo {
  provider: EmbeddingProvider;
  modelId: string;
  /** "<provider>:<model_id>": stored on chunks, used as the search filter. */
  key: string;
  source: RouteSource;
  /** This call wrote the lock (first embedding of this user). */
  lockedNow: boolean;
}

export interface UserModelRouter {
  models: ModelRouter;
  routing: AiRoutingConfig;
  embeddingLock: EmbeddingLock | null;
  /** Null when no provider can serve embeddings; `embeddingsError` says why. */
  embeddings: EmbeddingRouteInfo | null;
  embeddingsError?: string;
  /** The catalog the router picks from (for staleOfflineFallbacks and logs). */
  catalog: readonly CatalogModel[];
  catalogSize: number;
}

const allKeysHint = () => Object.values(PROVIDER_KEY_ENV).join(", ");

/**
 * Loads routing + catalog + embedding lock for `userId` and returns the router every task should
 * use. Throws ConfigError when no ADR-06 provider key is set at all; a task whose routed provider
 * has no key fails with a ConfigError naming the missing variable when it is used. Embeddings never
 * switch provider: without a usable embeddings route `embeddings` is null (search full-text only).
 */
export async function createUserModelRouter(
  opts: UserModelRouterOptions,
): Promise<UserModelRouter> {
  const env = opts.env ?? {};
  const keys = providerKeys(env);
  if (!keys.anthropic && !keys.openrouter && !keys.edenai)
    throw new ConfigError(t("No AI provider configured ({keys})", { keys: allKeysHint() }));

  const warned = new Set<string>();
  const warn =
    opts.warn ??
    ((m: string) => {
      if (warned.has(m)) return;
      warned.add(m);
      console.warn(m);
    });

  const ctx = await loadRoutingContext(
    opts.client,
    opts.userId,
    opts.catalog ? { catalog: opts.catalog as unknown as CatalogRow[] } : {},
  );
  const routing = opts.adjustRouting ? opts.adjustRouting(ctx.routing) : ctx.routing;
  const catalog = ctx.catalog as unknown as CatalogModel[];
  const build = (lock: EmbeddingLock | null) =>
    createModelRouter({
      env,
      routing,
      catalog,
      embeddingLock: lock,
      warn,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.eden ? { eden: opts.eden } : {}),
    });

  let lock = ctx.embeddingLock;
  let models = build(lock);
  let lockedNow = false;
  if (lock && embeddingRouteDiffers(ctx.routing, lock)) {
    const r = ctx.routing.embeddings;
    warn(
      `[ai-routing] embeddings: ${t("the routing names {route}, the vectors use {model}. It applies only after a re-embed (pnpm --filter @kortex/md-sync reembed).", { route: `${r.provider}:${r.model_id ?? "Auto"}`, model: embeddingModelKey(lock) })}`,
    );
  }

  let embeddings: EmbeddingRouteInfo | null = null;
  let embeddingsError: string | undefined;
  try {
    if (!lock && opts.lockEmbeddings !== false) {
      const first = models.route!("embeddings");
      if (first.source === "offline_fallback")
        warn(
          `[ai-routing] embeddings: ${t("catalog empty, the embedding model is pinned to the offline fallback {model}", { model: first.modelId })}`,
        );
      const winner = await lockEmbeddingModel(opts.client, opts.userId, {
        provider: first.provider as EmbeddingProvider,
        model_id: first.modelId,
      });
      lockedNow = winner.provider === first.provider && winner.model_id === first.modelId;
      lock = winner;
      models = build(lock);
    }
    const r = models.route!("embeddings");
    embeddings = {
      provider: r.provider as EmbeddingProvider,
      modelId: r.modelId,
      key: embeddingModelKey({ provider: r.provider, model_id: r.modelId }),
      source: r.source,
      lockedNow,
    };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    embeddingsError = err.message;
  }

  return {
    models,
    routing,
    embeddingLock: lock,
    embeddings,
    ...(embeddingsError ? { embeddingsError } : {}),
    catalog,
    catalogSize: catalog.length,
  };
}

/** One line per task: provider, model and where it came from (startup logs). */
export function describeRoutes(models: ModelRouter, tasks: readonly AiTask[]): string[] {
  return tasks.map((task) => {
    try {
      const r = models.route!(task);
      return `${task}: ${r.provider}:${r.modelId} (${r.source}${r.note ? `; ${r.note}` : ""})`;
    } catch (err) {
      return t("{task}: not available ({reason})", {
        task,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
