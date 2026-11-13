import { PRODUCT_NAME, t } from "../i18n";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { EmbeddingModel, LanguageModel } from "ai";
import {
  AI_PROVIDERS,
  embeddingModelKey,
  parseAiRouting,
  parseEmbeddingLock,
  resolveTaskRoute,
  TASK_PROVIDERS,
  type AiProvider,
  type AiRoutingConfig,
  type AiTask,
  type UserSettings,
} from "@kortex/db";
import type { AudioTranscriber } from "../audio/transcriber";
import type { UrlTranscriber } from "../audio/url-transcriber";
import { ConfigError, ZeroDataRetentionError } from "../errors";
import { defaultFetch, type FetchLike } from "../http";
import type { CatalogModel } from "../providers/catalog";
import {
  createEdenChatModel,
  createEdenDocumentParser,
  createEdenEmbeddingModel,
  createEdenTranscriber,
  type DocumentParser,
  type EdenOptions,
} from "../providers/edenai";
import { providerKeys } from "../providers/keys";
import { createLlmDocumentParser, createLlmTranscriber } from "../providers/llm-tools";
import { PROVIDER_KEY_ENV, resolveRoute, type ResolvedRoute } from "./auto-select";

// ADR-06 multi-provider router. This file is the ONLY place in ai-core allowed to import
// @openrouter/ai-sdk-provider (a test enforces it); every OpenRouter request carries
// `provider.data_collection = 'deny'`. No model ids live here: they come from the user's routing
// or from Auto (router/auto-select.ts) over the discovered catalog.

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const ZERO_DATA_RETENTION = { data_collection: "deny" } as const;

/** Vector size of kortex.item_chunks.embedding (see @kortex/db EMBEDDING_DIMENSIONS). */
export const EMBEDDING_DIMENSIONS = 1536;

/** Resolved model ids behind the legacy accessors (fast = summarize, chat = chat_reasoning, vision = vision_ocr). */
export interface ModelIds {
  fast: string;
  chat: string;
  vision: string;
  embedding: string;
}

/** What the rest of ai-core uses to get models. Never build a provider elsewhere. */
export interface ModelRouter {
  readonly modelIds: ModelIds;
  /** Route `summarize` (cheap text work: TL;DR, recipes, takeaways). */
  fast(): LanguageModel;
  /** Route `chat_reasoning` (copilot, editor actions, digests). */
  chat(): LanguageModel;
  /** Route `vision_ocr` (screenshots, whiteboards, keyframes). */
  vision(): LanguageModel;
  /** Route `embeddings`, always 1536 dimensions. */
  embedding(): EmbeddingModel;
  /** Routed model for any language task (ADR-06). Optional so older router mocks stay valid. */
  forTask?(task: LanguageTask): LanguageModel;
  /** Which provider and model serve a task, and why. */
  route?(task: AiTask): ResolvedRoute;
  /** `audio_transcription` route (bytes and URLs); undefined when no provider can serve it. */
  transcriber?(): (AudioTranscriber & UrlTranscriber) | undefined;
  /** `document_parsing` route (scanned PDFs, images); undefined when no provider can serve it. */
  documentParser?(): DocumentParser | undefined;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Wraps fetch so every request body leaving for OpenRouter carries
 * `provider.data_collection = 'deny'`, overriding anything set upstream.
 * Fails closed: a body we cannot parse and rewrite is never sent.
 */
export function enforceZeroDataRetention(baseFetch: FetchLike): FetchLike {
  return async (input, init) => {
    if (init?.body == null) return baseFetch(input, init);
    if (typeof init.body !== "string") {
      throw new ZeroDataRetentionError(
        "Refusing to send a non-JSON request body to OpenRouter (cannot enforce data_collection: 'deny')",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body);
    } catch (cause) {
      throw new ZeroDataRetentionError(
        "Refusing to send an unparseable request body to OpenRouter",
        { cause },
      );
    }
    if (!isPlainObject(parsed)) {
      throw new ZeroDataRetentionError("OpenRouter request body must be a JSON object");
    }
    const provider = isPlainObject(parsed.provider) ? parsed.provider : {};
    parsed.provider = { ...provider, ...ZERO_DATA_RETENTION };
    return baseFetch(input, { ...init, body: JSON.stringify(parsed) });
  };
}

/**
 * OpenRouter embedding requests ask for EMBEDDING_DIMENSIONS (models with flexible sizes, e.g.
 * Matryoshka models, then return 1536; discovery probes exactly this).
 */
export function requestEmbeddingDimensions(baseFetch: FetchLike): FetchLike {
  return async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!/\/embeddings$/.test(new URL(url).pathname) || typeof init?.body !== "string")
      return baseFetch(input, init);
    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      return baseFetch(input, init);
    }
    if (!isPlainObject(parsed) || parsed.dimensions !== undefined) return baseFetch(input, init);
    return baseFetch(input, {
      ...init,
      body: JSON.stringify({ ...parsed, dimensions: EMBEDDING_DIMENSIONS }),
    });
  };
}

/** Fails instead of returning vectors that do not fit kortex.item_chunks.embedding. */
function requireDimensions(model: EmbeddingModel): EmbeddingModel {
  const m = model as unknown as {
    doEmbed(o: unknown): Promise<{ embeddings: number[][] }>;
    modelId: string;
  };
  const doEmbed = m.doEmbed.bind(m);
  return new Proxy(m, {
    get(target, prop, receiver) {
      if (prop !== "doEmbed") return Reflect.get(target, prop, receiver);
      return async (o: unknown) => {
        const res = await doEmbed(o);
        const bad = res.embeddings.find((e) => e.length !== EMBEDDING_DIMENSIONS);
        if (bad)
          throw new ConfigError(
            t("embeddings: {model} returns {actual} instead of {expected} dimensions", {
              model: m.modelId,
              actual: bad.length,
              expected: EMBEDDING_DIMENSIONS,
            }),
          );
        return res;
      };
    },
  }) as unknown as EmbeddingModel;
}

/** Language tasks a router hands out models for (embeddings, STT and OCR have their own accessors). */
export type LanguageTask = Exclude<AiTask, "embeddings" | "audio_transcription">;

/** Settings shape the router reads: `ai_routing_config` and `embedding_lock` (ADR-06). */
export type ModelSettings = { ai_routing_config?: unknown; embedding_lock?: unknown } & Partial<
  Pick<UserSettings, "preferred_chat_model" | "preferred_fast_model" | "embedding_model">
>;

export interface ModelRouterOptions {
  /** Server env: ANTHROPIC_API_KEY (alias CLAUDE_API_KEY), OPENROUTER_API_KEY, EDENAI_API_KEY. */
  env?: Record<string, string | undefined>;
  /** kortex.user_settings.ai_routing_config (raw JSON is fine; missing tasks use DEFAULT_AI_ROUTING). */
  routing?: unknown;
  /** Discovered models (kortex.ai_model_catalog); Auto picks from here. */
  catalog?: readonly CatalogModel[];
  fetch?: FetchLike;
  /** Where routing warnings go (fallback provider, offline list). Default console.warn, once per message. */
  warn?: (message: string) => void;
  /** Eden AI async job polling (tests). */
  eden?: Pick<EdenOptions, "pollIntervalMs" | "jobTimeoutMs" | "sleep">;
  baseURL?: string;
  /** @deprecated Use env.OPENROUTER_API_KEY. Still accepted as the OpenRouter key. */
  apiKey?: string;
  /** @deprecated Only `ai_routing_config` is read; use `routing`. */
  userSettings?: ModelSettings | null;
  /**
   * kortex.user_settings.embedding_lock: the model the user's vectors use. When set, `embeddings`
   * always resolves to exactly this model (source `locked`) and fails with ConfigError if its
   * provider has no key, instead of switching to another vector space. Raw JSON is fine.
   */
  embeddingLock?: unknown;
}

const LEGACY_TASK = { fast: "summarize", chat: "chat_reasoning", vision: "vision_ocr" } as const;

/** Routed model for a language task, also for routers that only implement the legacy accessors. */
export function modelFor(models: ModelRouter, task: LanguageTask): LanguageModel {
  if (models.forTask) return models.forTask(task);
  if (task === "vision_ocr") return models.vision();
  if (task === "chat_reasoning") return models.chat();
  return models.fast();
}

/** Model id used for a task (for metadata such as `model_used`). */
export function modelIdFor(models: ModelRouter, task: AiTask): string {
  if (models.route) {
    try {
      return models.route(task).modelId;
    } catch {
      return "";
    }
  }
  if (task === "embeddings") return models.modelIds.embedding;
  if (task === "vision_ocr") return models.modelIds.vision;
  if (task === "chat_reasoning") return models.modelIds.chat;
  return models.modelIds.fast;
}

/**
 * Identity of the embeddings model a router uses ("<provider>:<model_id>", see @kortex/db
 * `embeddingModelKey`): stored on every chunk and passed as the hybrid-search filter, so queries
 * only meet vectors of the same model. Null when embeddings are not routable (or for a router
 * without `route`, e.g. old test mocks).
 */
export function embeddingModelKeyFor(models: ModelRouter): string | null {
  if (!models.route) return null;
  try {
    const r = models.route("embeddings");
    return embeddingModelKey({ provider: r.provider, model_id: r.modelId });
  } catch {
    return null;
  }
}

/**
 * A one-off model choice (e.g. the copilot's model switch). "provider:model" names the provider;
 * otherwise the id's shape decides: Eden AI ids start with a feature ("llm/…"), OpenRouter ids
 * are "vendor/model", Anthropic ids have no slash.
 */
export function parseModelOverride(value: string): { provider: AiProvider; model_id: string } {
  const v = value.trim();
  const colon = v.indexOf(":");
  const named = colon > 0 ? v.slice(0, colon) : "";
  if ((AI_PROVIDERS as readonly string[]).includes(named)) {
    return { provider: named as AiProvider, model_id: v.slice(colon + 1) };
  }
  if (/^(llm|speech_to_text_async|ocr|ocr_async|embeddings)\//.test(v))
    return { provider: "edenai", model_id: v };
  if (v.includes("/")) return { provider: "openrouter", model_id: v };
  return { provider: "anthropic", model_id: v };
}

/** The user's routing with one task pinned to an exact model. Throws ConfigError if that provider cannot serve the task. */
export function withModelOverride(
  routing: unknown,
  task: AiTask,
  value?: string | null,
): AiRoutingConfig {
  const cfg = parseAiRouting(routing);
  if (!value?.trim()) return cfg;
  const o = parseModelOverride(value);
  if (!o.model_id) throw new ConfigError(t("{task}: empty model ID", { task }));
  if (!TASK_PROVIDERS[task].includes(o.provider))
    throw new ConfigError(t("{provider} cannot do {task}", { provider: o.provider, task }));
  return { ...cfg, [task]: { ...cfg[task], provider: o.provider, model_id: o.model_id } };
}

/** Eden AI catalog ids carry their feature; an exact LLM id may be given without the prefix. */
const edenLlmId = (id: string) =>
  /^(llm|speech_to_text_async|ocr|ocr_async|embeddings)\//.test(id) ? id : `llm/${id}`;

/**
 * ADR-06 router: every task follows the user's routing (exact model or Auto from the catalog).
 * Throws ConfigError when no provider key is configured at all; a task whose providers all lack
 * keys throws when it is used.
 */
export function createModelRouter(options: ModelRouterOptions = {}): ModelRouter {
  const env = options.env ?? {};
  const keys = providerKeys(env);
  if (options.apiKey && !keys.openrouter) keys.openrouter = options.apiKey;
  if (!keys.anthropic && !keys.openrouter && !keys.edenai) {
    throw new ConfigError(
      t("No AI provider configured ({keys})", {
        keys: t("ANTHROPIC_API_KEY, OPENROUTER_API_KEY or EDENAI_API_KEY"),
      }),
    );
  }
  const routing = parseAiRouting(options.routing ?? options.userSettings?.ai_routing_config);
  const catalog = options.catalog ?? [];
  const fetchFn = options.fetch ?? defaultFetch;
  const seen = new Set<string>();
  const warn =
    options.warn ??
    ((m: string) => {
      if (seen.has(m)) return;
      seen.add(m);
      console.warn(m);
    });

  const lock = parseEmbeddingLock(options.embeddingLock ?? options.userSettings?.embedding_lock);
  const resolved = new Map<AiTask, ResolvedRoute>();
  const route = (task: AiTask): ResolvedRoute => {
    let r = resolved.get(task);
    if (!r) {
      if (task === "embeddings" && lock) {
        if (!keys[lock.provider])
          throw new ConfigError(
            t("embeddings: the vectors use {model}, {key} is missing for it", {
              model: embeddingModelKey(lock),
              key: PROVIDER_KEY_ENV[lock.provider],
            }),
          );
        r = { task, provider: lock.provider, modelId: lock.model_id, source: "locked" };
      } else {
        r = resolveRoute({ task, route: resolveTaskRoute(routing, task), catalog, keys, warn });
      }
      resolved.set(task, r);
    }
    return r;
  };

  let anthropic: ReturnType<typeof createAnthropic> | undefined;
  let openrouter: ReturnType<typeof createOpenRouter> | undefined;
  const providerSettings = { provider: { ...ZERO_DATA_RETENTION } };
  const getAnthropic = () =>
    (anthropic ??= createAnthropic({
      apiKey: keys.anthropic as string,
      fetch: fetchFn as typeof fetch,
    }));
  const getOpenRouter = () =>
    (openrouter ??= createOpenRouter({
      apiKey: keys.openrouter as string,
      baseURL: options.baseURL ?? OPENROUTER_BASE_URL,
      compatibility: "strict",
      headers: { "X-Title": PRODUCT_NAME },
      // Belt and braces: the provider adds it to the body, the fetch wrapper guarantees it.
      extraBody: { provider: { ...ZERO_DATA_RETENTION } },
      fetch: enforceZeroDataRetention(requestEmbeddingDimensions(fetchFn)) as typeof fetch,
    }));
  const eden = (): EdenOptions => ({
    apiKey: keys.edenai as string,
    fetch: fetchFn,
    ...options.eden,
  });

  const languageModel = (r: ResolvedRoute): LanguageModel => {
    if (r.provider === "anthropic") return getAnthropic().languageModel(r.modelId);
    if (r.provider === "openrouter") return getOpenRouter().chat(r.modelId, providerSettings);
    return createEdenChatModel(edenLlmId(r.modelId), eden());
  };

  const forTask = (task: LanguageTask): LanguageModel => {
    const r = route(task);
    if (r.provider === "edenai" && !edenLlmId(r.modelId).startsWith("llm/")) {
      throw new ConfigError(t("{task}: {model} is not a language model", { task, model: r.modelId }));
    }
    return languageModel(r);
  };

  const embedding = (): EmbeddingModel => {
    const r = route("embeddings");
    if (r.provider === "edenai")
      return requireDimensions(createEdenEmbeddingModel(r.modelId, eden()));
    if (r.provider === "openrouter")
      return requireDimensions(getOpenRouter().textEmbeddingModel(r.modelId));
    throw new ConfigError(t("embeddings: {provider} offers no embeddings", { provider: r.provider }));
  };

  const transcriber = (): (AudioTranscriber & UrlTranscriber) | undefined => {
    let r: ResolvedRoute;
    try {
      r = route("audio_transcription");
    } catch {
      return undefined;
    }
    if (r.provider === "edenai" && r.modelId.startsWith("speech_to_text_async/"))
      return createEdenTranscriber(r.modelId, eden());
    return createLlmTranscriber(languageModel(r), `${r.provider}:${r.modelId}`);
  };

  const documentParser = (): DocumentParser | undefined => {
    let r: ResolvedRoute;
    try {
      r = route("document_parsing");
    } catch {
      return undefined;
    }
    if (r.provider === "edenai" && /^ocr(_async)?\//.test(r.modelId))
      return createEdenDocumentParser(r.modelId, eden());
    return createLlmDocumentParser(languageModel(r), `${r.provider}:${r.modelId}`);
  };

  const idOf = (task: AiTask) => {
    try {
      return route(task).modelId;
    } catch {
      return t("not configured");
    }
  };
  const modelIds = {} as ModelIds;
  for (const [legacy, task] of [
    ...Object.entries(LEGACY_TASK),
    ["embedding", "embeddings"],
  ] as Array<[keyof ModelIds, AiTask]>) {
    Object.defineProperty(modelIds, legacy, { enumerable: true, get: () => idOf(task) });
  }

  return {
    modelIds,
    fast: () => forTask(LEGACY_TASK.fast),
    chat: () => forTask(LEGACY_TASK.chat),
    vision: () => forTask(LEGACY_TASK.vision),
    embedding,
    forTask,
    route,
    transcriber,
    documentParser,
  };
}
