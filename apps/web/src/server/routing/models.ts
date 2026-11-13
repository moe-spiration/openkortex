import { t } from "@/i18n";
import { z } from "zod";
import {
  AI_PROVIDERS,
  AiProviderSchema,
  AiTaskSchema,
  modelServesTask,
  type AiProvider,
  type ModelCatalogEntry,
} from "@kortex/db";
import { json } from "../api-error";
import { preflight, route, type DepsProvider } from "../route";
import { saveCatalog, selectCatalog } from "./catalog";
import { CATALOG_TTL_MS, getModelDiscovery, type DiscoverModels } from "./discovery";
import { enforceLimits } from "../limits";

export const ModelsQuerySchema = z.object({
  provider: AiProviderSchema.optional(),
  task: AiTaskSchema.optional(),
  refresh: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export interface ProviderModels {
  provider: AiProvider;
  /** "live": just discovered; "cache": from kortex.ai_model_catalog. */
  source: "live" | "cache";
  fetched_at: string | null;
  /** Set when discovery failed or is not implemented yet; the cache is returned instead. */
  warning?: string;
  models: ModelCatalogEntry[];
}

export interface ModelsResponse {
  ok: true;
  providers: ProviderModels[];
}

/**
 * `GET /api/models[?provider=anthropic|openrouter|edenai][&task=<AiTask>][&refresh=1]`
 * Models per provider for the settings' model picker. `task` keeps only models that can serve
 * it (capability, and 1536 dimensions for embeddings).
 */
export function createModelsHandlers(
  getDeps: DepsProvider,
  getDiscovery: () => DiscoverModels | null = getModelDiscovery,
) {
  return {
    GET: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "models");
      const params = Object.fromEntries(new URL(request.url).searchParams);
      const q = ModelsQuerySchema.parse(params);
      const providers = q.provider ? [q.provider] : [...AI_PROVIDERS];
      const discover = getDiscovery();

      const out: ProviderModels[] = [];
      for (const provider of providers) {
        let models = (await selectCatalog(auth.client, provider)) as unknown as ModelCatalogEntry[];
        let source: ProviderModels["source"] = "cache";
        let warning: string | undefined;
        const newest = models.reduce<string | null>(
          (m, r) => (m && m > r.fetched_at ? m : r.fetched_at),
          null,
        );
        const stale = !newest || deps.now().getTime() - Date.parse(newest) > CATALOG_TTL_MS;

        if (q.refresh || stale) {
          if (!discover) warning = t("No model discovery configured; using the cache");
          else {
            try {
              const fresh = await discover(provider, { env: deps.env.raw, signal: request.signal });
              await saveCatalog(deps, provider, fresh);
              models = fresh.filter((m) => m.is_available);
              source = "live";
            } catch (err) {
              warning = t("Discovery for {provider} failed: {error}", { provider, error: err instanceof Error ? err.message : String(err) });
              deps.log.error(`model discovery ${provider}`, err);
            }
          }
        }
        if (q.task) models = models.filter((m) => modelServesTask(m, q.task!));
        out.push({
          provider,
          source,
          fetched_at: source === "live" ? deps.now().toISOString() : newest,
          ...(warning ? { warning } : {}),
          models,
        });
      }
      return json<ModelsResponse>({ ok: true, providers: out });
    }),
    OPTIONS: preflight(getDeps),
  };
}
