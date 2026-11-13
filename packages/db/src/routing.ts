// ADR-06: Multi-Provider AI Gateway & Task-Based Model Routing.
// One route per AI task in kortex.user_settings.ai_routing_config. No model ids are hardcoded
// here: `model_id: null` means "Auto" and ai-core picks a model from the discovered catalog
// (kortex.ai_model_catalog) by `auto_mode`. Mirrors migration 20261024000000_ai_routing_config.sql.
import { t } from "@kortex/i18n";
import { z } from "zod";
import type { KortexClient } from "./client";
import "./i18n";
import type { Json } from "./types.gen";

export const AI_PROVIDERS = ["anthropic", "openrouter", "edenai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_TASKS = [
  "summarize",
  "auto_organize",
  "chat_reasoning",
  "meeting_coach",
  "vision_ocr",
  "audio_transcription",
  "document_parsing",
  "embeddings",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AUTO_MODES = ["cost_efficient", "balanced", "max_quality"] as const;
export type AutoMode = (typeof AUTO_MODES)[number];

/** Vector size of kortex.item_chunks.embedding. The embeddings route can never change it. */
export const EMBEDDING_DIMENSIONS = 1536;

/** What a model must be able to do to serve a task (matches ai_model_catalog.capabilities). */
export const MODEL_CAPABILITIES = ["chat", "vision", "ocr", "audio_transcription", "document_parsing", "embeddings"] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const TASK_CAPABILITY: Record<AiTask, ModelCapability> = {
  summarize: "chat",
  auto_organize: "chat",
  chat_reasoning: "chat",
  meeting_coach: "chat",
  vision_ocr: "vision",
  audio_transcription: "audio_transcription",
  document_parsing: "document_parsing",
  embeddings: "embeddings",
};

/** Providers that can serve a task at all (the settings UI offers only these). */
export const TASK_PROVIDERS: Record<AiTask, readonly AiProvider[]> = {
  summarize: AI_PROVIDERS,
  auto_organize: AI_PROVIDERS,
  chat_reasoning: AI_PROVIDERS,
  meeting_coach: AI_PROVIDERS,
  vision_ocr: AI_PROVIDERS,
  audio_transcription: ["edenai", "openrouter"],
  document_parsing: ["edenai", "openrouter", "anthropic"],
  embeddings: ["openrouter", "edenai"],
};

/** The 4 "intelligent text" tasks: Anthropic direct is the primary provider (ADR-06). */
export const TEXT_TASKS = ["summarize", "auto_organize", "chat_reasoning", "meeting_coach"] as const satisfies readonly AiTask[];

export const AiProviderSchema = z.enum(AI_PROVIDERS);
export const AiTaskSchema = z.enum(AI_TASKS);
export const AutoModeSchema = z.enum(AUTO_MODES);

export const TaskRouteSchema = z.object({
  provider: AiProviderSchema,
  /** Exact model of the provider; null = Auto (catalog pick by auto_mode). */
  model_id: z.string().trim().min(1).max(200).nullable(),
  auto_mode: AutoModeSchema.optional(),
  /** Embeddings only: must equal EMBEDDING_DIMENSIONS (DB check constraint enforces it too). */
  dimensions: z.literal(EMBEDDING_DIMENSIONS).optional(),
});
export type TaskRoute = z.infer<typeof TaskRouteSchema>;

export type AiRoutingConfig = Record<AiTask, TaskRoute>;

const route = (provider: AiProvider, auto_mode: AutoMode): TaskRoute => ({ provider, model_id: null, auto_mode });

/** Defaults for new users (identical to the column default of the migration). */
export const DEFAULT_AI_ROUTING: Readonly<AiRoutingConfig> = Object.freeze({
  summarize: route("anthropic", "cost_efficient"),
  auto_organize: route("anthropic", "cost_efficient"),
  chat_reasoning: route("anthropic", "max_quality"),
  meeting_coach: route("anthropic", "balanced"),
  vision_ocr: route("openrouter", "balanced"),
  audio_transcription: route("edenai", "balanced"),
  document_parsing: route("edenai", "balanced"),
  embeddings: { ...route("openrouter", "cost_efficient"), dimensions: EMBEDDING_DIMENSIONS },
});

/** Strict: a full config as the settings UI submits it. */
export const AiRoutingConfigSchema = z
  .object(Object.fromEntries(AI_TASKS.map((t) => [t, TaskRouteSchema])) as Record<AiTask, typeof TaskRouteSchema>)
  .superRefine((cfg, ctx) => {
    for (const task of AI_TASKS) {
      const r = cfg[task];
      if (!TASK_PROVIDERS[task].includes(r.provider))
        ctx.addIssue({ code: "custom", path: [task, "provider"], message: t("{provider} cannot serve {task}", { provider: r.provider, task }) });
      if (task !== "embeddings" && r.dimensions !== undefined)
        ctx.addIssue({ code: "custom", path: [task, "dimensions"], message: t("dimensions only applies to embeddings") });
    }
  });

/** A partial change: any subset of tasks, any subset of their fields. */
export const AiRoutingPatchSchema = z.partialRecord(AiTaskSchema, TaskRouteSchema.partial());
export type AiRoutingPatch = z.infer<typeof AiRoutingPatchSchema>;

const withEmbeddingDims = (cfg: AiRoutingConfig): AiRoutingConfig => ({
  ...cfg,
  embeddings: { ...cfg.embeddings, dimensions: EMBEDDING_DIMENSIONS },
});

/**
 * Lenient read of the stored JSON: unknown keys are ignored, missing or invalid task routes fall
 * back to DEFAULT_AI_ROUTING (so tasks added later work for existing rows). Never throws.
 */
export function parseAiRouting(raw: unknown): AiRoutingConfig {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as AiRoutingConfig;
  for (const task of AI_TASKS) {
    const r = TaskRouteSchema.safeParse(src[task]);
    out[task] = r.success && TASK_PROVIDERS[task].includes(r.data.provider) ? r.data : { ...DEFAULT_AI_ROUTING[task] };
  }
  return withEmbeddingDims(out);
}

/**
 * Applies a patch on top of a config and validates the result. Switching the provider without a
 * model resets `model_id` to Auto (a model id never carries over between providers).
 * Throws a ZodError for invalid input.
 */
export function mergeAiRouting(base: AiRoutingConfig, patch: unknown): AiRoutingConfig {
  const p = AiRoutingPatchSchema.parse(patch);
  const next = { ...base };
  for (const task of AI_TASKS) {
    const change = p[task];
    if (!change) continue;
    const cur = base[task];
    const providerChanged = change.provider !== undefined && change.provider !== cur.provider;
    next[task] = {
      ...cur,
      ...change,
      model_id: change.model_id !== undefined ? change.model_id : providerChanged ? null : cur.model_id,
    };
  }
  return withEmbeddingDims(AiRoutingConfigSchema.parse(next) as AiRoutingConfig);
}

/** Route for one task, with the default as fallback. */
export function resolveTaskRoute(cfg: Partial<AiRoutingConfig> | null | undefined, task: AiTask): TaskRoute {
  return cfg?.[task] ?? DEFAULT_AI_ROUTING[task];
}

// --- Model catalog ---------------------------------------------------------------------------

export interface ModelPricing {
  /** USD per million input tokens (text models). */
  input_per_mtok?: number;
  /** USD per million output tokens (text models). */
  output_per_mtok?: number;
  /** USD per unit for non-token billing (audio minute, page, image). */
  per_unit?: number;
  unit?: string;
}

/** One discovered model (row of kortex.ai_model_catalog, normalised). */
export interface ModelCatalogEntry {
  provider: AiProvider;
  model_id: string;
  display_name: string | null;
  capabilities: ModelCapability[];
  context_length: number | null;
  embedding_dimensions: number | null;
  pricing: ModelPricing;
  is_available: boolean;
  fetched_at: string;
}

/** Whether a catalog model may serve a task (capability + the 1536-dim rule for embeddings). */
export function modelServesTask(model: Pick<ModelCatalogEntry, "capabilities" | "embedding_dimensions">, task: AiTask): boolean {
  if (!model.capabilities.includes(TASK_CAPABILITY[task])) return false;
  if (task === "embeddings") return model.embedding_dimensions === EMBEDDING_DIMENSIONS;
  return true;
}

// --- Read / update helpers (RLS as the signed-in user; user_id filter for service-role use) ----

/** The user's routing (defaults when the row or the column is missing). */
export async function getAiRouting(client: KortexClient, userId: string): Promise<AiRoutingConfig> {
  const { data, error } = await client.from("user_settings").select("ai_routing_config").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`load ai_routing_config: ${error.message}`);
  return parseAiRouting(data?.ai_routing_config);
}

/** Validates `patch` against the stored routing, saves the merged config and returns it. */
export async function updateAiRouting(client: KortexClient, userId: string, patch: unknown): Promise<AiRoutingConfig> {
  const next = mergeAiRouting(await getAiRouting(client, userId), patch);
  const { data, error } = await client
    .from("user_settings")
    .update({ ai_routing_config: next as unknown as Json })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw new Error(`save ai_routing_config: ${error.message}`);
  if (!data?.length) throw new Error("save ai_routing_config: no user_settings row (run bootstrap_user first)");
  return next;
}

/**
 * Cached models of a provider (optionally only those that can serve a task). Paged: PostgREST
 * returns at most 1,000 rows per request and the catalog is larger.
 */
export async function listModelCatalog(
  client: KortexClient,
  opts: { provider?: AiProvider; task?: AiTask } = {},
): Promise<ModelCatalogEntry[]> {
  const PAGE = 1000;
  const rows: ModelCatalogEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client
      .from("ai_model_catalog")
      .select("provider,model_id,display_name,capabilities,context_length,embedding_dimensions,pricing,is_available,fetched_at")
      .eq("is_available", true);
    if (opts.provider) q = q.eq("provider", opts.provider);
    if (opts.task) q = q.contains("capabilities", [TASK_CAPABILITY[opts.task]]);
    const { data, error } = await q
      .order("provider")
      .order("model_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load ai_model_catalog: ${error.message}`);
    const page = (data ?? []) as unknown as ModelCatalogEntry[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return opts.task ? rows.filter((m) => modelServesTask(m, opts.task!)) : rows;
}

// --- Embedding lock (one vector space per user) ----------------------------------------------
//
// kortex.user_settings.embedding_lock pins the model a user's vectors were made with. It is
// written on the first embedding (compare-and-set) and then wins over ai_routing_config.embeddings
// for every writer and every search query. Changing it needs a re-embed of all chunks.

/** Providers that can serve embeddings (TASK_PROVIDERS.embeddings). */
export const EMBEDDING_PROVIDERS = ["openrouter", "edenai"] as const satisfies readonly AiProvider[];
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const EmbeddingLockSchema = z.object({
  provider: z.enum(EMBEDDING_PROVIDERS),
  model_id: z.string().trim().min(1).max(200),
  dimensions: z.literal(EMBEDDING_DIMENSIONS),
  locked_at: z.string().optional(),
});
export type EmbeddingLock = z.infer<typeof EmbeddingLockSchema>;

/** Stored lock or null (invalid JSON counts as "no lock"; the DB check constraint prevents it). */
export function parseEmbeddingLock(raw: unknown): EmbeddingLock | null {
  const r = EmbeddingLockSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * Identity of an embedding model, stored on every chunk (item_chunks.metadata.embedding_model) and
 * used as the search filter: "<provider>:<model_id>".
 */
export function embeddingModelKey(m: { provider: string; model_id: string }): string {
  return `${m.provider}:${m.model_id}`;
}

/** True when the routing asks for another embedding model than the one the vectors use. */
export function embeddingRouteDiffers(routing: AiRoutingConfig, lock: EmbeddingLock | null): boolean {
  if (!lock) return false;
  const r = routing.embeddings;
  return r.provider !== lock.provider || (r.model_id !== null && r.model_id !== lock.model_id);
}

const withEmbeddingRoute = (cfg: AiRoutingConfig, lock: EmbeddingLock): AiRoutingConfig => ({
  ...cfg,
  embeddings: { ...cfg.embeddings, provider: lock.provider, model_id: lock.model_id, dimensions: EMBEDDING_DIMENSIONS },
});

/** The user's embedding lock, or null when nothing was embedded yet. */
export async function getEmbeddingLock(client: KortexClient, userId: string): Promise<EmbeddingLock | null> {
  const { data, error } = await client.from("user_settings").select("embedding_lock").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`load embedding_lock: ${error.message}`);
  return parseEmbeddingLock(data?.embedding_lock);
}

const newLock = (m: { provider: EmbeddingProvider; model_id: string }, now: Date): EmbeddingLock =>
  EmbeddingLockSchema.parse({
    provider: m.provider,
    model_id: m.model_id,
    dimensions: EMBEDDING_DIMENSIONS,
    locked_at: now.toISOString(),
  });

/**
 * Pins the embedding model unless one is pinned already (compare-and-set on `embedding_lock is
 * null`, so two processes racing on the first embedding agree on one model). The exact model is
 * mirrored into ai_routing_config.embeddings so the settings UI shows it. Returns the lock in
 * place afterwards, which may be another process's.
 */
export async function lockEmbeddingModel(
  client: KortexClient,
  userId: string,
  model: { provider: EmbeddingProvider; model_id: string },
  now: Date = new Date(),
): Promise<EmbeddingLock> {
  const { data: row, error } = await client
    .from("user_settings")
    .select("ai_routing_config,embedding_lock")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`load embedding_lock: ${error.message}`);
  if (!row) throw new Error("lock embedding model: no user_settings row (run bootstrap_user first)");
  const existing = parseEmbeddingLock(row.embedding_lock);
  if (existing) return existing;

  const lock = newLock(model, now);
  const { data, error: upErr } = await client
    .from("user_settings")
    .update({
      embedding_lock: lock as unknown as Json,
      ai_routing_config: withEmbeddingRoute(parseAiRouting(row.ai_routing_config), lock) as unknown as Json,
    })
    .eq("user_id", userId)
    .is("embedding_lock", null)
    .select("user_id");
  if (upErr) throw new Error(`save embedding_lock: ${upErr.message}`);
  if (data?.length) return lock;
  const winner = await getEmbeddingLock(client, userId);
  if (!winner) throw new Error("save embedding_lock: row changed concurrently, lock still missing");
  return winner;
}

/**
 * Moves the lock to another model. Only for the re-embed, after every chunk was rewritten with
 * that model; anything else leaves the existing vectors unsearchable.
 */
export async function setEmbeddingLock(
  client: KortexClient,
  userId: string,
  model: { provider: EmbeddingProvider; model_id: string },
  now: Date = new Date(),
): Promise<EmbeddingLock> {
  const lock = newLock(model, now);
  const routing = await getAiRouting(client, userId);
  const { data, error } = await client
    .from("user_settings")
    .update({
      embedding_lock: lock as unknown as Json,
      ai_routing_config: withEmbeddingRoute(routing, lock) as unknown as Json,
    })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw new Error(`save embedding_lock: ${error.message}`);
  if (!data?.length) throw new Error("save embedding_lock: no user_settings row");
  return lock;
}
