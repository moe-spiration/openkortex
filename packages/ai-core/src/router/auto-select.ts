import { t } from "../i18n";
import {
  modelServesTask,
  TASK_CAPABILITY,
  TASK_PROVIDERS,
  type AiProvider,
  type AiTask,
  type AutoMode,
  type ModelCapability,
  type TaskRoute,
} from "@kortex/db";
import { ConfigError } from "../errors";
import { familyOf, priceOf, releasedAt, type CatalogModel } from "../providers/catalog";
import type { ProviderKeys } from "../providers/keys";

// ADR-06 Auto: pick a concrete model for a task route from the discovered catalog. No model ids
// live in this logic; the only ids in ai-core are the clearly marked OFFLINE_FALLBACK below.

/** Model lines per Auto mode, for providers that name their lines (Anthropic `line`). */
export const FAMILY_FOR_MODE: Record<AutoMode, readonly string[]> = {
  cost_efficient: ["haiku"],
  balanced: ["sonnet"],
  max_quality: ["opus"],
};

/** Models older than this (relative to the newest candidate) are ignored by the price-based pick. */
export const RECENCY_WINDOW_MS = 548 * 24 * 60 * 60 * 1000; // ~18 months

/** Free variants route through providers that may train on data; meta routers pick models themselves. */
const excludedFromAuto = (m: CatalogModel) =>
  m.model_id.endsWith(":free") || m.model_id.startsWith("openrouter/");

const newestFirst = (a: CatalogModel, b: CatalogModel) =>
  releasedAt(b) - releasedAt(a) || a.model_id.localeCompare(b.model_id);

/**
 * Auto choice among models that can already serve the task:
 * 1. If the provider names model lines (Anthropic), take the newest model of the line for the mode
 *    (cost_efficient → haiku, balanced → sonnet, max_quality → opus).
 * 2. Otherwise by price among recent models (within ~18 months of the newest): cheapest,
 *    median or most expensive; newer wins ties. Unpriced models only when nothing is priced.
 */
export function pickAutoModel(
  candidates: readonly CatalogModel[],
  mode: AutoMode,
): CatalogModel | null {
  const pool = candidates.filter((m) => m.is_available && !excludedFromAuto(m));
  if (pool.length === 0) return null;

  const wanted = FAMILY_FOR_MODE[mode];
  const inFamily = pool.filter((m) => {
    const f = familyOf(m);
    return f !== null && wanted.includes(f);
  });
  if (inFamily.length) return [...inFamily].sort(newestFirst)[0] ?? null;

  const newest = Math.max(...pool.map(releasedAt));
  const recent =
    newest > 0
      ? pool.filter((m) => releasedAt(m) === 0 || newest - releasedAt(m) <= RECENCY_WINDOW_MS)
      : pool;
  const priced = recent.filter((m) => (priceOf(m) ?? 0) > 0);
  const ranked = (priced.length ? priced : recent)
    .slice()
    .sort((a, b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity) || newestFirst(a, b));
  if (!ranked.length) return null;
  if (mode === "cost_efficient") return ranked[0] ?? null;
  if (mode === "max_quality") return ranked[ranked.length - 1] ?? null;
  return ranked[Math.floor((ranked.length - 1) / 2)] ?? null;
}

/*
 * ─── OFFLINE FALLBACK ─── OFFLINE ONLY ───────────────────────────────────────────────────────
 * Used ONLY when a provider's catalog is EMPTY (discovery never ran or failed) and a key for that
 * provider exists. Every use logs a warning. Never consulted while the provider has catalog rows
 * (test "offline fallback is never used while a catalog exists" guards this). The catalog
 * (kortex.ai_model_catalog, 24 h TTL) is the source of truth.
 *
 * Refreshed 2026-10-23 from a live discovery: each id is the current Auto pick of its provider for
 * that capability/mode, and all were listed and available. `staleOfflineFallbacks(catalog)` reports
 * ids that drop out of a loaded catalog (md-sync and the MCP server log it at startup); refresh
 * this list then. The embeddings entries do not change existing users: their vectors are pinned by
 * kortex.user_settings.embedding_lock.
 */
export const OFFLINE_FALLBACK: Partial<
  Record<
    AiProvider,
    Partial<Record<ModelCapability, Partial<Record<AutoMode, string>> & { default: string }>>
  >
> = {
  anthropic: {
    chat: {
      default: "claude-sonnet-5-5",
      cost_efficient: "claude-haiku-5-5",
      max_quality: "claude-opus-5-5",
    },
    vision: { default: "claude-sonnet-5-5", cost_efficient: "claude-haiku-5-5" },
    document_parsing: { default: "claude-sonnet-5-5" },
  },
  openrouter: {
    chat: { default: "qwen/qwen3.8-27b" },
    vision: { default: "qwen/qwen3.5-397b-a17b" },
    embeddings: { default: "qwen/qwen3-embedding-8b" },
  },
  edenai: {
    audio_transcription: { default: "speech_to_text_async/assembly" },
    document_parsing: { default: "ocr_async/mistral/mistral-ocr-4" },
    ocr: { default: "ocr/mistral/mistral-ocr-3-0" },
    embeddings: { default: "embeddings/openai/1536__text-embedding-ada-002" },
  },
};

export interface StaleFallback {
  provider: AiProvider;
  capability: ModelCapability;
  mode: AutoMode | "default";
  modelId: string;
}

/**
 * Offline-fallback ids that a loaded catalog no longer lists as available. Providers without
 * catalog rows are skipped (nothing to compare against). Empty result = the list is current.
 */
export function staleOfflineFallbacks(catalog: readonly CatalogModel[]): StaleFallback[] {
  const out: StaleFallback[] = [];
  for (const [provider, caps] of Object.entries(OFFLINE_FALLBACK) as Array<
    [AiProvider, NonNullable<(typeof OFFLINE_FALLBACK)[AiProvider]>]
  >) {
    const own = catalog.filter((m) => m.provider === provider);
    if (!own.length) continue;
    const available = new Set(own.filter((m) => m.is_available).map((m) => m.model_id));
    for (const [capability, modes] of Object.entries(caps) as Array<
      [ModelCapability, Record<string, string>]
    >) {
      for (const [mode, modelId] of Object.entries(modes)) {
        if (!available.has(modelId))
          out.push({ provider, capability, mode: mode as AutoMode | "default", modelId });
      }
    }
  }
  return out;
}

/** Env variables that carry each provider's key (for error messages). */
export const PROVIDER_KEY_ENV: Record<AiProvider, string> = {
  get anthropic() {
    return t("ANTHROPIC_API_KEY (or CLAUDE_API_KEY)");
  },
  openrouter: "OPENROUTER_API_KEY",
  edenai: "EDENAI_API_KEY",
};

/** `locked`: the embeddings model pinned by kortex.user_settings.embedding_lock. */
export type RouteSource = "exact" | "auto" | "offline_fallback" | "locked";

export interface ResolvedRoute {
  task: AiTask;
  provider: AiProvider;
  modelId: string;
  source: RouteSource;
  autoMode?: AutoMode;
  /** Why the result differs from the configured route (missing key, fallback provider …). */
  note?: string;
}

export interface ResolveRouteOptions {
  task: AiTask;
  route: TaskRoute;
  catalog: readonly CatalogModel[];
  keys: ProviderKeys;
  warn?: (message: string) => void;
  /**
   * Only the configured provider, never another one. Default: true for `embeddings` (switching
   * provider would switch the vector space), false otherwise.
   */
  strict?: boolean;
}

/**
 * TaskRoute → concrete provider + model. The configured provider comes first; when its key is
 * missing (or it has nothing that serves the task) the other providers allowed for the task are
 * tried on Auto, except for strict routes (embeddings). Throws ConfigError, naming the missing key
 * variables, when no provider with a key can serve the task.
 */
export function resolveRoute({
  task,
  route,
  catalog,
  keys,
  warn,
  strict = task === "embeddings",
}: ResolveRouteOptions): ResolvedRoute {
  const mode: AutoMode = route.auto_mode ?? "balanced";
  const order = strict
    ? [route.provider]
    : [route.provider, ...TASK_PROVIDERS[task].filter((p) => p !== route.provider)];
  const reasons: string[] = [];

  for (const provider of order) {
    const switched = provider !== route.provider;
    if (!keys[provider]) {
      reasons.push(
        t("{provider}: no API key ({key} is missing)", { provider, key: PROVIDER_KEY_ENV[provider] }),
      );
      continue;
    }
    const note = switched
      ? t("{from} not usable ({reasons}), continuing with {to}", {
          from: route.provider,
          reasons: reasons.join("; "),
          to: provider,
        })
      : undefined;
    if (!switched && route.model_id) {
      return { task, provider, modelId: route.model_id, source: "exact" };
    }
    const own = catalog.filter((m) => m.provider === provider);
    const pick = pickAutoModel(
      own.filter((m) => modelServesTask(m, task)),
      mode,
    );
    if (pick) {
      if (note) warn?.(`[ai-routing] ${task}: ${note}`);
      return {
        task,
        provider,
        modelId: pick.model_id,
        source: "auto",
        autoMode: mode,
        ...(note ? { note } : {}),
      };
    }
    if (own.length === 0) {
      const entry = OFFLINE_FALLBACK[provider]?.[TASK_CAPABILITY[task]];
      const modelId = entry?.[mode] ?? entry?.default;
      if (modelId) {
        warn?.(
          `[ai-routing] ${task}: ${t("the model catalog for {provider} is empty, using the offline fallback {model}. GET /api/models?refresh=1 loads the catalog.", { provider, model: modelId })}`,
        );
        return {
          task,
          provider,
          modelId,
          source: "offline_fallback",
          autoMode: mode,
          ...(note ? { note } : {}),
        };
      }
    }
    reasons.push(t("{provider}: no model in the catalog for {task}", { provider, task }));
  }
  throw new ConfigError(
    t("No AI model available for \"{task}\" ({reasons})", { task, reasons: reasons.join("; ") }),
  );
}
