import {
  createIngestionPipeline,
  createLiveUserModelRouter,
  describeRoutes,
  meterModelRouter,
  staleOfflineFallbacks,
  type IngestionPipeline,
  type LiveUserModelRouter,
  type StorageGateway,
  type UsageLedger,
  type UserModelRouter,
} from "@kortex/ai-core";
import { subscribeUserSettings, type KortexClient } from "@kortex/db";
import type { Logger } from "./logger";

/** Vault files are Markdown: the text adapters never upload, so any upload is a bug. */
export const textOnlyStorage: StorageGateway = {
  upload: async () => {
    throw new Error("md-sync ingests Markdown only; file uploads are not supported");
  },
};

export interface VaultPipeline {
  pipeline: IngestionPipeline;
  /** Newest router build (routing, lock, catalog). */
  readonly user: UserModelRouter;
  live: LiveUserModelRouter;
  close(): Promise<void>;
}

function logRouting(user: UserModelRouter, log: Logger) {
  const routes = describeRoutes(user.models, ["summarize", "auto_organize", "embeddings"]);
  log.info("ai routing", { catalog: user.catalogSize, routes });
  if (user.embeddings?.lockedNow) log.info("embedding model pinned", { model: user.embeddings.key });
  if (!user.embeddings)
    log.warn("embeddings unavailable: chunks are saved without vectors", {
      reason: user.embeddingsError,
    });
}

/**
 * ai-core pipeline for vault ingest, routed exactly like the web app (ADR-06): the user's
 * ai_routing_config + the shared model catalog + the user's embedding lock (pinned here if this
 * is the first embedding). Routing/lock changes (Realtime on user_settings) and the periodic
 * catalog refresh rebuild the router without a restart; each ingest waits for a pending rebuild.
 */
export async function createVaultPipeline(opts: {
  client: KortexClient;
  userId: string;
  env: Record<string, string | undefined>;
  logger: Logger;
  /** Realtime feed on user_settings (default on). */
  subscribe?: boolean;
  /** Catalog refresh interval (default 6 h, 0 = off). */
  refreshIntervalMs?: number;
  /** Every AI call of the pipeline is recorded here (kortex.ai_usage), priced like the web server. */
  ledger?: UsageLedger;
}): Promise<VaultPipeline> {
  const { logger: log } = opts;
  const live = await createLiveUserModelRouter({
    client: opts.client,
    userId: opts.userId,
    env: opts.env,
    warn: (m) => log.warn(m),
    ...(opts.subscribe === false
      ? {}
      : { subscribe: (cb: () => void) => subscribeUserSettings(opts.client, opts.userId, cb) }),
    ...(opts.refreshIntervalMs !== undefined ? { refreshIntervalMs: opts.refreshIntervalMs } : {}),
    onRebuild: (u, reason) => {
      log.info("ai routing reloaded", { reason });
      logRouting(u, log);
    },
    onError: (error, reason) =>
      log.warn("ai routing reload failed, keeping the previous routes", {
        reason,
        error: String(error),
      }),
  });
  const user = live.current();
  logRouting(user, log);
  if (user.catalogSize === 0)
    log.warn("model catalog is empty: Auto uses the offline fallback list (open the web app's model settings to discover models)");
  const stale = staleOfflineFallbacks(user.catalog);
  if (stale.length)
    log.warn("offline fallback ids no longer in the catalog (refresh ai-core auto-select.ts)", {
      stale: stale.map((s) => `${s.provider}:${s.modelId}`),
    });
  const inner = createIngestionPipeline({
    storage: textOnlyStorage,
    env: opts.env,
    models: opts.ledger
      ? meterModelRouter(live.models, {
          catalog: () => live.current().catalog,
          record: (entry) => opts.ledger!.record(entry),
        })
      : live.models,
  });
  const pipeline: IngestionPipeline = {
    registry: inner.registry,
    models: inner.models,
    async ingest(input, context) {
      await live.ensureFresh();
      return inner.ingest(input, context);
    },
  };
  return {
    pipeline,
    get user() {
      return live.current();
    },
    live,
    close: () => live.close(),
  };
}
