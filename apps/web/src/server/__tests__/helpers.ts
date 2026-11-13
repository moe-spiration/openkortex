import { MockEmbeddingModelV4, MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import {
  createIngestionPipeline,
  type CatalogModel,
  type FetchLike,
  type ModelRouter,
} from "@kortex/ai-core";
import { parseAiRouting } from "@kortex/db";
import { createBootstrapper } from "../auth";
import type { ServerDeps } from "../deps";
import { readServerEnv } from "../env";
import { createMemoryIngestQueue } from "../ingest/queue";
import { processItem } from "../ingest/process";
import { FakeSupabase } from "./fake-supabase";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_USER = "99999999-9999-4999-8999-999999999999";
export const API_TOKEN = "kx_test_token_0123456789abcdef";
export const NOW = new Date("2026-10-23T08:00:00.000Z");

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/** Model answering each generate call with the next value (last repeats); streams `streamText`. */
export function mockModel(
  values: unknown[] = [{}],
  streamText = "Antwort [1].",
): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    modelId: "mock-chat",
    doGenerate: async () => {
      const v = values[Math.min(i++, values.length - 1)];
      return {
        content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: streamText },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]),
    }),
  });
}

export const mockEmbedding = () =>
  new MockEmbeddingModelV4({
    modelId: "mock-embedding",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => new Array(1536).fill(0.01)),
      warnings: [],
    }),
  });

export function mockRouter(
  models: {
    fast?: MockLanguageModelV4;
    chat?: MockLanguageModelV4;
    vision?: MockLanguageModelV4;
  } = {},
): ModelRouter & {
  embeddingModel: MockEmbeddingModelV4;
} {
  const fallback = mockModel();
  const embeddingModel = mockEmbedding();
  return {
    modelIds: {
      fast: "mock/fast",
      chat: "mock/chat",
      vision: "mock/vision",
      embedding: "mock/embedding",
    },
    fast: () => models.fast ?? fallback,
    chat: () => models.chat ?? fallback,
    vision: () => models.vision ?? fallback,
    embedding: () => embeddingModel,
    embeddingModel,
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Fetch for the ingestion adapters (Jina etc.); unknown URLs throw. */
export function fakeFetch(
  routes: Array<{ match: (url: string) => boolean; respond: () => Response }>,
): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const r = routes.find((x) => x.match(url));
    if (!r) throw new Error(`fakeFetch: no route for ${url}`);
    return r.respond();
  };
  return Object.assign(fn, { calls });
}

export interface TestSetup {
  deps: ServerDeps;
  db: FakeSupabase;
  models: ReturnType<typeof mockRouter>;
  deferred: Promise<unknown>[];
  clientKinds: string[];
  modelRequests: Array<unknown>;
  errors: Array<{ message: string; meta?: unknown }>;
  /** Waits for queued background jobs. */
  drain(): Promise<void>;
}

const catalogEntry = (provider: CatalogModel["provider"], model_id: string): CatalogModel => ({
  provider,
  model_id,
  display_name: null,
  capabilities: ["chat"],
  context_length: null,
  embedding_dimensions: null,
  pricing: {},
  is_available: true,
  fetched_at: "2026-10-23T00:00:00.000Z",
});

/** Small discovered catalog: the model switch only accepts ids listed here. */
export const TEST_CATALOG: CatalogModel[] = [
  catalogEntry("anthropic", "fx-sonnet"),
  catalogEntry("openrouter", "openai/gpt-4o"),
];

export function setup(
  options: {
    db?: FakeSupabase;
    models?: ReturnType<typeof mockRouter>;
    fetch?: FetchLike;
    env?: Record<string, string>;
    catalog?: CatalogModel[];
  } = {},
): TestSetup {
  const db = options.db ?? new FakeSupabase();
  // S2a: the test user is on the Kortex allowlist unless a test seeds the table itself.
  if (!db.tables.allowed_users) db.rows("allowed_users").push({ user_id: USER_ID, role: "owner" });
  db.rpcHandlers.is_allowed ??= () => db.rows("allowed_users").some((r) => r.user_id === (db.authUser?.id ?? USER_ID));
  const models = options.models ?? mockRouter();
  const deferred: Promise<unknown>[] = [];
  const clientKinds: string[] = [];
  const modelRequests: unknown[] = [];
  const errors: TestSetup["errors"] = [];
  let n = 0;
  const env = readServerEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    KORTEX_API_TOKEN: API_TOKEN,
    KORTEX_API_TOKEN_USER_ID: USER_ID,
    // Models are mocked; the key only says "an AI provider is configured" (processItem skips AI without one).
    ANTHROPIC_API_KEY: "test-key",
    ...options.env,
  });
  // In-process stand-in for the durable queue (same contract; the worker has its own tests).
  const queue = createMemoryIngestQueue(
    (ctx, job) => processItem(deps, ctx, job.itemId, job.input, job.options),
    {
      onError: (label, e) => errors.push({ message: `job ${label} failed`, meta: e }),
      defer: (p) => deferred.push(p),
    },
  );
  const deps: ServerDeps = {
    env,
    clients: {
      session: () => (clientKinds.push("session"), db.client),
      jwt: () => (clientKinds.push("jwt"), db.client),
      service: () => (clientKinds.push("service"), db.client),
    },
    bootstrap: createBootstrapper(),
    queue,
    defer: (p) => deferred.push(p),
    loadCatalog: async () => options.catalog ?? TEST_CATALOG,
    resolveModels: async () => ({
      models,
      routing: parseAiRouting(null),
      embeddingLock: null,
      embeddings: null,
      catalog: options.catalog ?? TEST_CATALOG,
      catalogSize: (options.catalog ?? TEST_CATALOG).length,
    }),
    createPipeline: ({ storage }) =>
      createIngestionPipeline({
        storage,
        models,
        fetch: options.fetch ?? fakeFetch([]),
        // Jina is only used with a key (ai-core web-article chain: Jina → Firecrawl → direct).
        env: {
          JINA_API_KEY: "jina_test",
          // Mail an Kortex: the email adapter hides the private inbound address (prod: env.raw).
          KORTEX_INBOUND_MAIL_DOMAIN: options.env?.KORTEX_INBOUND_MAIL_DOMAIN,
        },
      }),
    createModels: (settings) => {
      modelRequests.push(settings);
      return models;
    },
    now: () => NOW,
    uuid: () => `22222222-2222-4222-8222-${String(++n).padStart(12, "0")}`,
    log: { info: () => {}, error: (message, meta) => errors.push({ message, meta }) },
  };
  return {
    deps,
    db,
    models,
    deferred,
    clientKinds,
    modelRequests,
    errors,
    drain: () => queue.idle(),
  };
}

export const authed = (init: RequestInit & { token?: string } = {}): RequestInit => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${init.token ?? API_TOKEN}`);
  return { ...init, headers };
};

export const postJson = (url: string, body: unknown, init: RequestInit & { token?: string } = {}) =>
  new Request(
    url,
    authed({
      ...init,
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...init.headers },
    }),
  );

/** System folders as kortex.bootstrap_user() would create them. */
export function seedFolders(db: FakeSupabase, userId = USER_ID) {
  for (const p of [
    "00_Inbox",
    "10_Notes",
    "20_Meetings",
    "30_Clippings",
    "40_AI_Memories",
    "50_Recipes",
    "60_Documents",
    "90_Digests",
  ]) {
    db.rows("folders").push({
      id: `f-${p}`,
      user_id: userId,
      folder_path: p,
      name: p,
      slug: p.toLowerCase(),
      parent_id: null,
    });
  }
}
