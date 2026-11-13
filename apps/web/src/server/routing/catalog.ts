import { providerKeys, type CatalogModel, type CatalogRaw } from "@kortex/ai-core";
import {
  AI_PROVIDERS,
  loadModelCatalog,
  type AiProvider,
  type Json,
  type KortexClient,
  type ModelCatalogEntry,
} from "@kortex/db";
import type { ServerDeps } from "../deps";
import { CATALOG_TTL_MS, getModelDiscovery, type DiscoverModels } from "./discovery";

// Catalog for the model router (Auto picks from it). Read with the service role, kept in memory
// for a few minutes; a provider with a key and no rows is discovered right away, a stale one in
// the background.

const MEMORY_MS = 5 * 60 * 1000;

type CatalogDeps = Pick<ServerDeps, "clients" | "env" | "now" | "log" | "defer">;

/** Upserts a provider's discovered models; rows the provider no longer lists become unavailable. */
export async function saveCatalog(
  deps: Pick<ServerDeps, "clients" | "now">,
  provider: AiProvider,
  models: readonly (ModelCatalogEntry | CatalogModel)[],
): Promise<void> {
  if (!models.length) return;
  const service = deps.clients.service();
  const at = deps.now().toISOString();
  const rows = models.map((m) => ({
    provider,
    model_id: m.model_id,
    display_name: m.display_name,
    capabilities: m.capabilities,
    context_length: m.context_length,
    embedding_dimensions: m.embedding_dimensions,
    pricing: m.pricing as Json,
    is_available: m.is_available,
    fetched_at: at,
    raw: (("raw" in m && m.raw) || {}) as Json,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await service
      .from("ai_model_catalog")
      .upsert(rows.slice(i, i + 500), { onConflict: "provider,model_id" });
    if (error) throw new Error(`save ai_model_catalog: ${error.message}`);
  }
  const { error } = await service
    .from("ai_model_catalog")
    .update({ is_available: false })
    .eq("provider", provider)
    .lt("fetched_at", at);
  if (error) throw new Error(`retire ai_model_catalog: ${error.message}`);
}

/** Discovers one provider and stores the result. */
export async function refreshProvider(
  deps: CatalogDeps,
  provider: AiProvider,
  discover: DiscoverModels,
): Promise<CatalogModel[]> {
  const fresh = await discover(provider, { env: deps.env.raw });
  await saveCatalog(deps, provider, fresh);
  return fresh;
}

/** All available catalog rows (optionally of one provider), paged (shared @kortex/db reader). */
export function selectCatalog(client: KortexClient, provider?: AiProvider) {
  return loadModelCatalog(client, provider);
}

interface Memory {
  at: number;
  models: CatalogModel[];
}

/** Per-deps catalog loader with an in-memory cache. */
export function createCatalogLoader(
  deps: CatalogDeps,
  getDiscovery: () => DiscoverModels | null = getModelDiscovery,
) {
  let memory: Memory | undefined;
  let inflight: Promise<CatalogModel[]> | undefined;
  const refreshing = new Set<AiProvider>();

  const load = async (): Promise<CatalogModel[]> => {
    const rows = (await selectCatalog(deps.clients.service())).map(
      (r) => ({ ...r, raw: (r.raw ?? {}) as CatalogRaw }) as unknown as CatalogModel,
    );
    const keys = providerKeys(deps.env.raw);
    const discover = getDiscovery();
    const out: CatalogModel[] = [];
    for (const provider of AI_PROVIDERS) {
      const own = rows.filter((r) => r.provider === provider);
      if (!discover || !keys[provider]) {
        out.push(...own);
        continue;
      }
      if (!own.length) {
        try {
          out.push(
            ...(await refreshProvider(deps, provider, discover)).filter((m) => m.is_available),
          );
        } catch (err) {
          deps.log.error(
            `model discovery ${provider}`,
            err instanceof Error ? err.message : String(err),
          );
        }
        continue;
      }
      out.push(...own);
      const newest = own.reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), "");
      if (deps.now().getTime() - Date.parse(newest) > CATALOG_TTL_MS && !refreshing.has(provider)) {
        refreshing.add(provider);
        deps.defer(
          refreshProvider(deps, provider, discover)
            .then(() => (memory = undefined))
            .catch((err) =>
              deps.log.error(
                `model discovery ${provider}`,
                err instanceof Error ? err.message : String(err),
              ),
            )
            .finally(() => refreshing.delete(provider)),
        );
      }
    }
    return out;
  };

  return async function loadCatalog(): Promise<CatalogModel[]> {
    if (memory && deps.now().getTime() - memory.at < MEMORY_MS) return memory.models;
    inflight ??= load()
      .then((models) => {
        memory = { at: deps.now().getTime(), models };
        return models;
      })
      .catch((err) => {
        // No catalog: the router falls back to its marked offline list (with a warning).
        deps.log.error("load model catalog", err instanceof Error ? err.message : String(err));
        return [] as CatalogModel[];
      })
      .finally(() => (inflight = undefined));
    return inflight;
  };
}
