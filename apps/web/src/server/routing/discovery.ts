import { discoverModels, type CatalogModel } from "@kortex/ai-core";
import type { AiProvider } from "@kortex/db";

/*
 * ADR-06 model discovery. `GET /api/models` and the catalog loader (./catalog.ts) serve
 * kortex.ai_model_catalog and, when it is empty, stale or `?refresh=1`, ask the provider through
 * a `DiscoverModels` function (ai-core `discoverModels`) and write the result back with the
 * service role:
 *   - anthropic:  GET /v1/models (key ANTHROPIC_API_KEY, alias CLAUDE_API_KEY)
 *   - openrouter: GET /api/v1/models + /api/v1/embeddings/models (1536 dims probed, data_collection: deny)
 *   - edenai:     public /v2/info/provider_subfeatures (STT, OCR, embeddings) + /v3/models (LLMs)
 * Keys travel in headers only, never in a URL or a log line.
 */

export interface DiscoverModelsOptions {
  /** Server env (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, EDENAI_API_KEY ...). */
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** Live listing of one provider's models, normalised for kortex.ai_model_catalog (incl. `raw`). */
export type DiscoverModels = (
  provider: AiProvider,
  options: DiscoverModelsOptions,
) => Promise<CatalogModel[]>;

/** Catalog entries older than this are refreshed on the next request. */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

const discover: DiscoverModels = (provider, { env, fetch, signal }) =>
  discoverModels(provider, { env, ...(fetch ? { fetch } : {}), ...(signal ? { signal } : {}) });

/** The provider discovery (ai-core). Tests inject their own. */
export function getModelDiscovery(): DiscoverModels | null {
  return discover;
}
