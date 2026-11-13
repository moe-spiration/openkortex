import { randomUUID } from "node:crypto";
import { after } from "next/server";
import {
  createIngestionPipeline,
  createModelRouter,
  createUserModelRouter,
  type CatalogModel,
  type IngestionPipeline,
  type ModelRouter,
  type ModelSettings,
  type PodcastAdapterOptions,
  type StorageGateway,
  type UserModelRouter,
} from "@kortex/ai-core";
import type { KortexClient } from "@kortex/db";
import { createBootstrapper, type Bootstrapper } from "./auth";
import { readServerEnv, type ServerEnv } from "./env";
import type { IngestQueue } from "./ingest/queue";
import { ingestRuntime, startIngestWorker } from "./ingest/runtime";
import { meterRouter } from "./limits/meter";
import { createCatalogLoader } from "./routing/catalog";
import { createSupabaseClients, type SupabaseClients } from "./supabase";

export interface Logger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** Everything a route needs from the outside world. Tests pass fakes. */
export interface ServerDeps {
  env: ServerEnv;
  clients: SupabaseClients;
  bootstrap: Bootstrapper;
  /** Ingest jobs: durable (kortex.ingest_jobs + worker) in production, in-process in tests. */
  queue: IngestQueue;
  /** Keeps background work alive after the response is sent (Next.js `after()`). */
  defer(work: Promise<unknown>): void;
  /** Discovered models (kortex.ai_model_catalog) for Auto routing; cached in memory. */
  loadCatalog(): Promise<readonly CatalogModel[]>;
  /**
   * The shared ADR-06 resolver (same as md-sync and the MCP server): routing + catalog + the
   * user's embedding lock, which it pins on the first embedding. Use it wherever vectors are
   * written.
   */
  resolveModels(ctx: { client: KortexClient; userId: string }): Promise<UserModelRouter>;
  /** Ingestion pipeline from @kortex/ai-core, routed by the user's ai_routing_config (ADR-06). */
  createPipeline(options: {
    storage: StorageGateway;
    /** Router from `resolveModels` (preferred: honours the embedding lock). */
    models?: ModelRouter;
    userSettings?: ModelSettings | null;
    catalog?: readonly CatalogModel[];
    /** Cost guard before paid speech-to-text of long media (ingest/media-guard.ts). */
    beforeTranscribe?: PodcastAdapterOptions["beforeTranscribe"];
  }): IngestionPipeline;
  /** Model router from @kortex/ai-core (Anthropic / OpenRouter with data_collection: 'deny' / Eden AI). */
  createModels(userSettings?: ModelSettings | null, catalog?: readonly CatalogModel[]): ModelRouter;
  now(): Date;
  uuid(): string;
  log: Logger;
}

const consoleLogger: Logger = {
  info: (m, meta) => console.info(`[kortex-api] ${m}`, meta ?? ""),
  error: (m, meta) => console.error(`[kortex-api] ${m}`, meta ?? ""),
};

function deferWithAfter(work: Promise<unknown>): void {
  try {
    after(work);
  } catch {
    // Outside a request scope (scripts): the promise just runs on its own.
    void work;
  }
}

let singleton: ServerDeps | undefined;

/** Process-wide deps (one queue, one bootstrap cache). Env is read on first use. */
export function getServerDeps(): ServerDeps {
  if (singleton) return singleton;
  const env = readServerEnv();
  const log = consoleLogger;
  const warned = new Set<string>();
  const warn = (m: string) => {
    if (warned.has(m)) return;
    warned.add(m);
    log.info(`routing: ${m}`);
  };
  const deps: ServerDeps = {
    env,
    clients: createSupabaseClients(env),
    bootstrap: createBootstrapper((m, e) => log.error(m, e)),
    // Set right below: the durable queue needs the deps it is part of.
    queue: undefined as unknown as IngestQueue,
    defer: deferWithAfter,
    loadCatalog: () => loadCatalog(),
    // Every router handed out is metered (S2a): calls are charged to the request's user
    // (server/limits usage context) and recorded in kortex.ai_usage.
    resolveModels: async ({ client, userId }) => {
      const r = await createUserModelRouter({
        client,
        userId,
        env: env.raw,
        catalog: await loadCatalog(),
        warn,
      });
      return { ...r, models: meterRouter(deps, r.models) };
    },
    createPipeline: ({ storage, models, userSettings, catalog, beforeTranscribe }) =>
      createIngestionPipeline({
        storage,
        env: env.raw,
        ...(beforeTranscribe ? { podcast: { beforeTranscribe } } : {}),
        // A router passed in comes from resolveModels() and is metered already; wrapping it again
        // recorded every ingest call twice in ai_usage.
        models:
          models ??
          meterRouter(
            deps,
            createModelRouter({
              env: env.raw,
              routing: userSettings?.ai_routing_config,
              embeddingLock: userSettings?.embedding_lock,
              ...(catalog ? { catalog } : {}),
              warn,
            }),
          ),
        warn,
      }),
    // Reads only: honours the pinned embedding model but never pins one.
    createModels: (userSettings, catalog) =>
      meterRouter(
        deps,
        createModelRouter({
          env: env.raw,
          routing: userSettings?.ai_routing_config,
          embeddingLock: userSettings?.embedding_lock,
          ...(catalog ? { catalog } : {}),
          warn,
        }),
      ),
    now: () => new Date(),
    uuid: randomUUID,
    log,
  };
  const loadCatalog = createCatalogLoader(deps);
  deps.queue = ingestRuntime(deps).queue;
  singleton = deps;
  // Picks up queued and interrupted jobs (also started on boot by src/instrumentation.ts).
  startIngestWorker(deps);
  return singleton;
}
