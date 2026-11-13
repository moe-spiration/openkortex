import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import type { FetchLike } from "../src/http";
import type { AiTask } from "@kortex/db";
import type { LanguageTask, ModelRouter } from "../src/router/model-router";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

export const jsonResult = (value: unknown): GenerateResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  finishReason: { unified: "stop", raw: "stop" },
  usage,
  warnings: [],
});

/** Mock model that answers each call with the next value (last one repeats). */
export function mockModel(...values: unknown[]): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    modelId: "mock-model",
    doGenerate: async () => jsonResult(values[Math.min(i++, values.length - 1)]),
  });
}

export function failingModel(message = "model down"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error(message);
    },
  });
}

/** Deterministic fake embeddings: dimension `dims`, first value = text length. */
export function mockEmbeddingModel(dims = 1536, maxEmbeddingsPerCall = 100): MockEmbeddingModelV4 {
  return new MockEmbeddingModelV4({
    modelId: "mock-embedding",
    maxEmbeddingsPerCall,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((v) => [v.length, ...new Array(dims - 1).fill(0.001)]),
      warnings: [],
    }),
  });
}

/** Which mock slot serves a routed task (meeting tasks use the chat slot, like the old router). */
const SLOT: Record<AiTask, "fast" | "chat" | "vision" | "embedding"> = {
  summarize: "fast",
  auto_organize: "fast",
  chat_reasoning: "chat",
  meeting_coach: "chat",
  vision_ocr: "vision",
  audio_transcription: "fast",
  document_parsing: "vision",
  embeddings: "embedding",
};

export function staticRouter(
  models: Partial<Record<"fast" | "chat" | "vision", MockLanguageModelV4>> & {
    embedding?: MockEmbeddingModelV4;
    /** Per-task override (ADR-06 tasks). */
    tasks?: Partial<Record<LanguageTask, MockLanguageModelV4>>;
  },
): ModelRouter {
  const fallback = mockModel({});
  const modelIds = {
    fast: "mock/fast",
    chat: "mock/chat",
    vision: "mock/vision",
    embedding: "mock/embedding",
  };
  const slot = (task: LanguageTask) => {
    const k = SLOT[task];
    return k === "embedding" ? fallback : (models[k] ?? fallback);
  };
  return {
    modelIds,
    fast: () => models.fast ?? fallback,
    chat: () => models.chat ?? fallback,
    vision: () => models.vision ?? fallback,
    embedding: () => models.embedding ?? mockEmbeddingModel(),
    forTask: (task) => models.tasks?.[task] ?? slot(task),
    route: (task) => ({
      task,
      provider: "openrouter",
      modelId: modelIds[SLOT[task]],
      source: "exact",
    }),
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

/** Fetch that serves routes in order and records every request; unknown URLs fail the test. */
export function fakeFetch(routes: Route[]): FetchLike & { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep string */
      }
    }
    calls.push({ url, method: init?.method ?? "GET", headers, body });
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`fakeFetch: no route for ${url}`);
    return route.respond(url, init);
  };
  return Object.assign(fn, { calls });
}

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const ITEM_ID = "22222222-2222-4222-8222-222222222222";
