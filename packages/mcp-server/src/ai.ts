import { t } from "./i18n";
import {
  ADAPTER_PRIORITY,
  ConfigError,
  createAiChatAdapter,
  createModelRouter,
  createTextNoteAdapter,
  createLiveUserModelRouter,
  createSupabaseUsageLedger,
  describeRoutes,
  embeddingModelKeyFor,
  embedTexts,
  ingest,
  IngestionRegistry,
  meterModelRouter,
  providerKeys,
  routingGuideFromAgentsGuide,
  staleOfflineFallbacks,
  type CatalogModel,
  type FetchLike,
  type ModelRouter,
  type UsageLedger,
} from "@kortex/ai-core";
import {
  connectorForType,
  isConnectorEnabled,
  placementDecision,
  placementOf,
  subscribeUserSettings,
  thresholdOf,
  type KortexClient,
} from "@kortex/db";
import { renderAgentsGuide } from "./agents-guide";
import type {
  BrainItem,
  EnrichableRepository,
  Embedder,
  EnrichmentOutcome,
  ItemEnricher,
  NewChunk,
} from "./repository";

type Env = Record<string, string | undefined>;

/** Routing part of agents.md for the organizer prompt (feedback G6b), built once. */
const ROUTING_GUIDE = routingGuideFromAgentsGuide(renderAgentsGuide({ heading: false }));

/**
 * Query embeddings for `brain_search` (1536 dims). `modelKey` names the model, so the search only
 * compares chunks embedded with it (the user's embedding lock).
 */
export function createAiCoreEmbedder(
  models: ModelRouter,
  opts: { beforeUse?: () => Promise<unknown> } = {},
): Embedder {
  return {
    // Getter: a live router can switch the locked model (after a re-embed) while we run.
    get modelKey() {
      return embeddingModelKeyFor(models);
    },
    async embed(text) {
      await opts.beforeUse?.();
      const [embedding] = await embedTexts([text], { model: models.embedding() });
      if (!embedding) throw new Error("embedding model returned nothing");
      return embedding;
    },
  };
}

/** Placeholder folder id for manual placements (ai-core wants an id; the path is what counts). */
const NO_FOLDER_ID = "00000000-0000-4000-8000-000000000000";
/** ai-core puts it on chunk rows; the repository replaces it with the real user id. */
const PIPELINE_USER = "mcp";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const parseVector = (v: unknown): number[] | null => {
  if (Array.isArray(v)) return v as number[];
  if (typeof v !== "string") return null;
  try {
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
};

/**
 * Gates in front of the organizer, the same as the web ingest route and md-sync: the item's
 * connector must be on (user_settings.enabled_connectors) and the daily AI budget not used up.
 * `threshold` is user_settings.auto_place_threshold: below it the organizer's folder is only
 * proposed (metadata.placement.folder_path), the item stays where it was saved.
 */
export interface EnrichGate {
  prepare(item: BrainItem): Promise<{ skip: string } | { threshold: number }>;
}

/** Gate on Supabase: settings row of the user + the usage ledger. */
export function createSupabaseEnrichGate(opts: {
  client: KortexClient;
  userId: string;
  ledger?: UsageLedger;
}): EnrichGate {
  return {
    async prepare(item) {
      const { data, error } = await opts.client
        .from("user_settings")
        .select("enabled_connectors,auto_place_threshold")
        .eq("user_id", opts.userId)
        .maybeSingle();
      if (error) throw new Error(`load user_settings: ${error.message}`);
      const connector = connectorForType(item.type);
      if (!isConnectorEnabled(connector, data?.enabled_connectors))
        return { skip: t("connector {connector} is switched off (Settings > Connectors)", { connector: String(connector) }) };
      const budget = await opts.ledger?.status();
      if (budget?.exceeded) {
        process.stderr.write(
          `[kortex-mcp] organizer skipped for ${item.id}: daily AI budget reached (${budget.spentEur.toFixed(2)} of ${budget.budgetEur} EUR)
`,
        );
        return { skip: "daily AI budget reached; the item is saved without AI enrichment" };
      }
      return { threshold: thresholdOf(data?.auto_place_threshold) };
    },
  };
}

/**
 * Runs the ai-core pipeline on a saved item: `ai-chat` adapter (agent memories, chat exports)
 * or `text-note`, then organizer (summary, tags, entities, cluster, folder), chunker and
 * embeddings. The agent's Markdown stays as written: the adapter's rewritten content only feeds
 * the chunks; title, slug and body are never changed. Folder/cluster stay when the item is a
 * manual placement or `keepFolder` is set. Extracted tasks are not created (agents use
 * `brain_manage_tasks` explicitly).
 */
export function createAiCoreEnricher(
  models: ModelRouter,
  opts: { beforeUse?: () => Promise<unknown>; gate?: EnrichGate } = {},
): ItemEnricher {
  const registry = new IngestionRegistry()
    .register(createAiChatAdapter({ models }), { priority: ADAPTER_PRIORITY["ai-chat"] })
    .register(createTextNoteAdapter(), { priority: ADAPTER_PRIORITY["text-note"] });

  const { beforeUse, gate } = opts;
  return {
    async enrich(item, repo: EnrichableRepository, opts = {}): Promise<EnrichmentOutcome> {
      const gated = await gate?.prepare(item);
      if (gated && "skip" in gated)
        return {
          status: "skipped",
          reason: gated.skip,
          chunks: 0,
          tags: item.tags,
          folder_path: item.folder_path,
          warnings: [],
        };
      // Without a gate (memory backend) the organizer files as before.
      const threshold = gated?.threshold ?? 0;
      await beforeUse?.();
      const keep = item.is_manual_placement || opts.keepFolder === true;
      const snapshot = { ...(await repo.getOrganizerContext()), routingGuide: ROUTING_GUIDE };
      const result = await ingest(
        {
          userId: PIPELINE_USER,
          itemId: item.id,
          rawText: item.content_md,
          typeHint: item.type,
          manualTags: item.tags,
          ...(keep ? { targetFolderId: NO_FOLDER_ID, targetFolderPath: item.folder_path } : {}),
        },
        snapshot,
        { registry, models },
      );

      const out = result.item;
      // Adapter facts the model could not extract come back as null (e.g. ai-chat `agent_name`);
      // they must not clobber what the caller already stored (brain_log_agent_memory metadata).
      const meta = Object.fromEntries(
        Object.entries(isRecord(out.metadata) ? out.metadata : {}).filter(
          ([k, v]) => v != null || item.metadata?.[k] == null,
        ),
      );
      const degraded = out.status !== "processed";
      const tags = [...new Set([...item.tags, ...result.tags])];
      const target = keep ? item.folder_path : (out.folder_path ?? item.folder_path);
      // Below the auto-place threshold the target is only proposed (web Inbox "Zur Prüfung").
      const held =
        target !== item.folder_path &&
        placementDecision(placementOf(out.metadata), false, threshold) === "review";
      const folderPath = held ? item.folder_path : target;
      if (held) meta.placement = { ...(isRecord(meta.placement) ? meta.placement : {}), folder_path: target, held: true };
      await repo.applyEnrichment(item.id, {
        summary: out.summary ?? null,
        tags,
        entities: out.entities ?? [],
        ...(!keep && out.cluster_name ? { cluster_name: out.cluster_name } : {}),
        ...(folderPath !== item.folder_path ? { folder_path: folderPath } : {}),
        status: out.status,
        metadata: {
          ...meta,
          ai_title: out.title,
          ingest: {
            ...(isRecord(meta.ingest) ? meta.ingest : {}),
            source: "mcp",
            state: degraded ? "degraded" : "done",
          },
        },
      });
      const chunks: NewChunk[] = result.chunks.map((c) => ({
        chunk_index: c.chunk_index,
        chunk_heading: c.chunk_heading ?? null,
        page_or_timestamp: c.page_or_timestamp ?? null,
        chunk_text: c.chunk_text,
        embedding: parseVector(c.embedding),
        metadata: isRecord(c.metadata) ? c.metadata : {},
      }));
      await repo.replaceChunks(item.id, chunks);
      return {
        status: degraded ? "degraded" : "done",
        chunks: chunks.length,
        tags,
        folder_path: folderPath,
        warnings: result.warnings,
        ...(held ? { proposed_folder: target } : {}),
      };
    },
  };
}

export interface AiWiring {
  embedder?: Embedder;
  enricher?: ItemEnricher;
  /** Human-readable startup notes (stderr). */
  notes: string[];
  /** Stops the live routing feed (createAiForUser). */
  close?: () => Promise<void>;
}

const isOff = (v: string | undefined) =>
  ["0", "false", "off"].includes((v ?? "").trim().toLowerCase());
const isOn = (v: string | undefined) =>
  ["1", "true", "on"].includes((v ?? "").trim().toLowerCase());

const NO_KEY_NOTE =
  "no AI provider key (ANTHROPIC_API_KEY / CLAUDE_API_KEY, OPENROUTER_API_KEY, EDENAI_API_KEY): full-text search only, no organizer";

interface Wanted {
  embeddings: boolean;
  organizer: boolean;
}

const wanted = (env: Env, vectorSearch: boolean | undefined): Wanted => ({
  embeddings: !isOff(env.KORTEX_MCP_EMBEDDINGS) && vectorSearch !== false,
  organizer: isOn(env.KORTEX_MCP_ORGANIZE),
});

const offNote = (env: Env, vectorSearch: boolean | undefined) =>
  vectorSearch === false
    ? "search: full-text only (vector search disabled)"
    : isOff(env.KORTEX_MCP_EMBEDDINGS)
      ? "search: full-text only (KORTEX_MCP_EMBEDDINGS=0)"
      : "search: full-text only";

/** Embedder + enricher from a router; a task the router cannot serve is left out with a note. */
function wire(
  models: ModelRouter,
  want: Wanted,
  notes: string[],
  env: Env,
  vectorSearch?: boolean,
  beforeUse?: () => Promise<unknown>,
  gates?: { gate: EnrichGate },
): AiWiring {
  const wiring: AiWiring = { notes };
  const use = beforeUse ? { beforeUse } : {};
  if (want.embeddings) {
    try {
      const r = models.route?.("embeddings");
      wiring.embedder = createAiCoreEmbedder(models, use);
      notes.push(`search: hybrid (embeddings ${r ? `${r.provider}:${r.modelId}, ${r.source}` : models.modelIds.embedding})`);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      notes.push(`search: full-text only (embeddings unavailable: ${e.message})`);
    }
  } else {
    notes.push(offNote(env, vectorSearch));
  }
  if (want.organizer) {
    wiring.enricher = createAiCoreEnricher(models, { ...use, ...gates });
    notes.push(`organizer on save: on (${describeRoutes(models, ["auto_organize"]).join("")})`);
  }
  return wiring;
}

/** Shown whenever the env-only router (no user, no catalog) is used. */
export const OFFLINE_ROUTING_NOTE =
  "routing: defaults without catalog (offline fallback, no user ai_routing_config) - memory backend/tests only";

/**
 * Builds the AI pieces from the environment alone (memory backend, tests): DEFAULT_AI_ROUTING and
 * no catalog, so Auto uses ai-core's offline fallback list. Only for contexts without a user (memory
 * backend, tests); every Supabase path (stdio, HTTP, remote/OAuth) uses `createAiForUser` with the
 * user's routing and the catalog. The fallback is announced in `notes` (warning with KORTEX_USER_ID). OpenRouter always gets `provider.data_collection = 'deny'`.
 *
 * - Embedder (hybrid `brain_search`): on with a key for the embeddings route, unless
 *   KORTEX_MCP_EMBEDDINGS=0 or `vectorSearch` is false.
 * - Enricher (organizer on save): only with KORTEX_MCP_ORGANIZE=1.
 */
export function createAiFromEnv(
  env: Env = process.env,
  opts: { vectorSearch?: boolean; fetch?: FetchLike; models?: ModelRouter } = {},
): AiWiring {
  const notes: string[] = [];
  const want = wanted(env, opts.vectorSearch);
  if (!want.embeddings && !want.organizer) {
    notes.push(offNote(env, opts.vectorSearch));
    return { notes };
  }
  if (!opts.models && Object.keys(providerKeys(env)).length === 0) {
    notes.push(NO_KEY_NOTE);
    return { notes };
  }
  if (!opts.models) notes.push(OFFLINE_ROUTING_NOTE);
  // A configured user means a real brain: its routing and catalog only come via createAiForUser.
  if (!opts.models && env.KORTEX_USER_ID)
    notes.push(
      "WARNING: KORTEX_USER_ID is set but the user routing is ignored here (no Supabase client); use the Supabase backend for ai_routing_config + catalog",
    );
  const models = opts.models ?? createModelRouter({ env, fetch: opts.fetch });
  return wire(models, want, notes, env, opts.vectorSearch);
}

/**
 * Builds the AI pieces for KORTEX_USER_ID with the shared ADR-06 resolver: the user's
 * ai_routing_config, the model catalog and the user's embedding lock (pinned now if nothing was
 * embedded yet), so query vectors match the chunks the web app and md-sync write.
 * `client` is the user-JWT client or the service role.
 */
export async function createAiForUser(
  env: Env,
  opts: {
    client: KortexClient;
    userId: string;
    vectorSearch?: boolean;
    fetch?: FetchLike;
    /** Realtime feed on user_settings (default on). */
    subscribe?: boolean;
    /** Catalog refresh interval (default 6 h, 0 = off). */
    refreshIntervalMs?: number;
  },
): Promise<AiWiring> {
  const notes: string[] = [];
  const want = wanted(env, opts.vectorSearch);
  if (!want.embeddings && !want.organizer) {
    notes.push(offNote(env, opts.vectorSearch));
    return { notes };
  }
  if (Object.keys(providerKeys(env)).length === 0) {
    notes.push(NO_KEY_NOTE);
    return { notes };
  }
  // Live: routing/lock changes and the periodic catalog refresh rebuild the router, no restart.
  const live = await createLiveUserModelRouter({
    client: opts.client,
    userId: opts.userId,
    env,
    ...(opts.subscribe === false
      ? {}
      : { subscribe: (cb: () => void) => subscribeUserSettings(opts.client, opts.userId, cb) }),
    ...(opts.refreshIntervalMs !== undefined ? { refreshIntervalMs: opts.refreshIntervalMs } : {}),
    onRebuild: (_u, reason) => process.stderr.write(`[kortex-mcp] ai routing reloaded (${reason})
`),
    onError: (e, reason) =>
      process.stderr.write(`[kortex-mcp] ai routing reload failed (${reason}): ${String(e)}
`),
    // Routing warnings can come later (first use of a task): stderr, never stdout (stdio channel).
    warn: (m) => process.stderr.write(`[kortex-mcp] ${m}
`),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const user = live.current();
  // Daily AI budget + usage log (kortex.ai_usage), priced like the web server. Writing usage needs
  // the service role; with a user JWT the budget is still checked, recording only logs the error.
  const ledger = createSupabaseUsageLedger({
    client: opts.client,
    userId: opts.userId,
    env,
    onError: (m, e) => process.stderr.write(`[kortex-mcp] ${m}: ${String(e)}
`),
  });
  const metered = meterModelRouter(live.models, {
    catalog: (): readonly CatalogModel[] => live.current().catalog,
    record: (entry) => ledger.record(entry),
  });
  const gate = createSupabaseEnrichGate({ client: opts.client, userId: opts.userId, ledger });
  notes.push(`routing: catalog ${user.catalogSize} models (live reload on)`);
  if (user.embeddings?.lockedNow) notes.push(`embedding model pinned: ${user.embeddings.key}`);
  const stale = staleOfflineFallbacks(user.catalog);
  if (stale.length)
    notes.push(
      `offline fallback ids missing from the catalog: ${stale.map((s) => `${s.provider}:${s.modelId}`).join(", ")}`,
    );
  const wiring = wire(metered, want, notes, env, opts.vectorSearch, () => live.ensureFresh(), {
    gate,
  });
  if (want.organizer) notes.push("organizer gates: connectors, daily AI budget, auto-place threshold");
  wiring.close = () => live.close();
  return wiring;
}
