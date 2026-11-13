// Shared readers for ADR-06 model routing: the model catalog (paged past PostgREST's row limit)
// and everything a model router needs for one user. Used by the web app, md-sync and the MCP
// server so all three resolve models (and the embedding model) the same way.
import { KORTEX_SCHEMA, type KortexClient } from "./client";
import {
  getAiRouting,
  getEmbeddingLock,
  type AiProvider,
  type AiRoutingConfig,
  type EmbeddingLock,
  type ModelCatalogEntry,
} from "./routing";

export const CATALOG_COLUMNS =
  "provider,model_id,display_name,capabilities,context_length,embedding_dimensions,pricing,is_available,fetched_at,raw" as const;

/** A catalog row as stored, including `raw` (release date, model family: Auto uses them). */
export type CatalogRow = ModelCatalogEntry & { raw: Record<string, unknown> };

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000;

/** All available catalog rows (optionally of one provider). Works with any role that can read the table. */
export async function loadModelCatalog(client: KortexClient, provider?: AiProvider): Promise<CatalogRow[]> {
  const out: CatalogRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from("ai_model_catalog").select(CATALOG_COLUMNS).eq("is_available", true);
    if (provider) q = q.eq("provider", provider);
    const { data, error } = await q
      .order("provider")
      .order("model_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load ai_model_catalog: ${error.message}`);
    const rows = (data ?? []) as unknown as CatalogRow[];
    out.push(...rows.map((r) => ({ ...r, raw: r.raw ?? {} })));
    if (rows.length < PAGE) return out;
  }
}

export interface RoutingContext {
  /** kortex.user_settings.ai_routing_config (defaults for missing tasks). */
  routing: AiRoutingConfig;
  /** Pinned embedding model; null until the first embedding. */
  embeddingLock: EmbeddingLock | null;
  /** Available catalog rows; Auto picks from here. */
  catalog: CatalogRow[];
}

/**
 * Routing, embedding lock and catalog for one user. `client` is the user's session (web, MCP in
 * JWT mode) or the service role (md-sync, MCP): every query filters by `userId` explicitly.
 * Pass `catalog` when the caller already holds a cached copy.
 */
export async function loadRoutingContext(
  client: KortexClient,
  userId: string,
  opts: { catalog?: readonly CatalogRow[] } = {},
): Promise<RoutingContext> {
  const [routing, embeddingLock, catalog] = await Promise.all([
    getAiRouting(client, userId),
    getEmbeddingLock(client, userId),
    opts.catalog ? Promise.resolve([...opts.catalog]) : loadModelCatalog(client),
  ]);
  return { routing, embeddingLock, catalog };
}

/**
 * Realtime feed for one user's kortex.user_settings row (routing, embedding lock). Calls `onChange`
 * on every INSERT/UPDATE; returns the unsubscribe function. Needs the table in the
 * `supabase_realtime` publication (migration 20261030050000). Service-role clients see the row via
 * the filter, user-JWT clients via RLS.
 */
export function subscribeUserSettings(
  client: KortexClient,
  userId: string,
  onChange: () => void,
): () => Promise<void> {
  const channel = client
    .channel(`kortex-user-settings:${userId}:${Math.random().toString(36).slice(2, 8)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: KORTEX_SCHEMA, table: "user_settings", filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .subscribe();
  return async () => {
    await client.removeChannel(channel);
  };
}
