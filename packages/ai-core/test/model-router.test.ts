import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { embedMany, generateText, Output } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_AI_ROUTING, type AiRoutingConfig } from "@kortex/db";
import { ConfigError, ZeroDataRetentionError } from "../src/errors";
import {
  createModelRouter,
  enforceZeroDataRetention,
  modelFor,
  modelIdFor,
  parseModelOverride,
  withModelOverride,
} from "../src/router/model-router";
import { FULL_CATALOG } from "./fixtures/catalog";
import { fakeFetch, json, type RecordedRequest } from "./helpers";

const chatCompletion = (content: string, model = "fx/model") => ({
  id: "gen-1",
  object: "chat.completion",
  created: 1_760_000_000,
  model,
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
});

const anthropicMessage = (text: string, model: string) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model,
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 5 },
});

function providersFetch() {
  return fakeFetch([
    {
      match: (u) => u.startsWith("https://api.anthropic.com/v1/messages"),
      respond: (_u, init) =>
        json(
          anthropicMessage("Hallo", (JSON.parse(String(init?.body)) as { model: string }).model),
        ),
    },
    {
      match: (u) => u.endsWith("/chat/completions"),
      respond: (_u, init) => {
        const body = JSON.parse(String(init?.body)) as { response_format?: unknown; model: string };
        return json(chatCompletion(body.response_format ? '{"answer":"ja"}' : "Hallo", body.model));
      },
    },
    {
      match: (u) => u === "https://openrouter.ai/api/v1/embeddings",
      respond: (_u, init) => {
        const { input } = JSON.parse(String(init?.body)) as { input: string[] };
        return json({
          object: "list",
          model: "fx/emb",
          data: input.map((_, index) => ({
            object: "embedding",
            index,
            embedding: new Array(1536).fill(0.1),
          })),
          usage: { prompt_tokens: 3, total_tokens: 3 },
        });
      },
    },
    {
      match: (u) => u === "https://api.edenai.run/v2/text/embeddings",
      respond: (_u, init) => {
        const { texts, providers } = JSON.parse(String(init?.body)) as {
          texts: string[];
          providers: string;
        };
        return json({
          [providers]: {
            status: "success",
            items: texts.map(() => ({ embedding: new Array(1536).fill(0.2) })),
          },
        });
      },
    },
  ]);
}

const ALL_KEYS = { ANTHROPIC_API_KEY: "ak", OPENROUTER_API_KEY: "ok", EDENAI_API_KEY: "ek" };
const exact = (provider: "anthropic" | "openrouter" | "edenai", model_id: string) => ({
  provider,
  model_id,
});

/** Every language task on OpenRouter with exact fixture ids. */
const OPENROUTER_ONLY: Partial<AiRoutingConfig> = {
  summarize: exact("openrouter", "fx/summarize"),
  auto_organize: exact("openrouter", "fx/organize"),
  chat_reasoning: exact("openrouter", "fx/chat"),
  meeting_coach: exact("openrouter", "fx/coach"),
  vision_ocr: exact("openrouter", "fx/vision"),
  embeddings: { ...exact("openrouter", "fx/emb"), dimensions: 1536 },
};

const providerOf = (call: RecordedRequest) =>
  (call.body as { provider?: Record<string, unknown> }).provider;

describe("routing: every task gets its routed model", () => {
  it("defaults + catalog: Anthropic Auto for text (newest haiku/sonnet/opus), sent to Anthropic directly", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({ env: ALL_KEYS, catalog: FULL_CATALOG, fetch });
    for (const task of ["summarize", "auto_organize", "meeting_coach", "chat_reasoning"] as const) {
      await generateText({ model: modelFor(router, task), prompt: "Hallo?" });
    }
    const sent = fetch.calls.map((c) => [
      c.url,
      (c.body as { model: string }).model,
      c.headers["x-api-key"],
    ]);
    expect(sent).toEqual([
      ["https://api.anthropic.com/v1/messages", "fx-haiku-new", "ak"],
      ["https://api.anthropic.com/v1/messages", "fx-haiku-new", "ak"],
      ["https://api.anthropic.com/v1/messages", "fx-sonnet-new", "ak"],
      ["https://api.anthropic.com/v1/messages", "fx-opus-new", "ak"],
    ]);
    expect(router.modelIds).toEqual({
      fast: "fx-haiku-new",
      chat: "fx-opus-new",
      vision: "fx/vision-mid",
      embedding: "fx/emb-1536-cheap",
    });
    expect(router.route?.("vision_ocr")).toMatchObject({
      provider: "openrouter",
      source: "auto",
      autoMode: "balanced",
    });
  });

  it("accepts the legacy CLAUDE_API_KEY name for Anthropic", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({
      env: { CLAUDE_API_KEY: "legacy" },
      catalog: FULL_CATALOG,
      fetch,
    });
    await generateText({ model: router.fast(), prompt: "x" });
    expect(fetch.calls[0]?.headers["x-api-key"]).toBe("legacy");
  });

  it("uses an exact model id from the user's routing and reads raw jsonb", () => {
    const router = createModelRouter({
      env: ALL_KEYS,
      routing: JSON.parse(
        JSON.stringify({ ...DEFAULT_AI_ROUTING, chat_reasoning: exact("anthropic", "fx-pinned") }),
      ),
      catalog: FULL_CATALOG,
    });
    expect(router.route?.("chat_reasoning")).toEqual({
      task: "chat_reasoning",
      provider: "anthropic",
      modelId: "fx-pinned",
      source: "exact",
    });
    expect(modelIdFor(router, "chat_reasoning")).toBe("fx-pinned");
  });

  it("Eden AI chat goes through the OpenAI-compatible v3 endpoint", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({
      env: ALL_KEYS,
      routing: { summarize: exact("edenai", "llm/mistral/fx-small") },
      fetch,
    });
    await generateText({ model: router.fast(), prompt: "x" });
    expect(fetch.calls[0]?.url).toBe("https://api.edenai.run/v3/llm/chat/completions");
    expect((fetch.calls[0]?.body as { model: string }).model).toBe("mistral/fx-small");
    expect(fetch.calls[0]?.headers.authorization).toBe("Bearer ek");
  });

  it("Eden AI embeddings keep 1536 dimensions", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({
      env: ALL_KEYS,
      routing: { embeddings: { provider: "edenai", model_id: null, auto_mode: "balanced" } },
      catalog: FULL_CATALOG,
      fetch,
    });
    const { embeddings } = await embedMany({ model: router.embedding(), values: ["a", "b"] });
    expect(embeddings.map((e) => e.length)).toEqual([1536, 1536]);
    expect(fetch.calls[0]?.body).toEqual({
      providers: "openai",
      texts: ["a", "b"],
      settings: { openai: "1536__fx-ada" },
    });
  });

  it("transcriber and document parser follow their routes (Eden AI by default, LLM otherwise)", () => {
    const router = createModelRouter({ env: ALL_KEYS, catalog: FULL_CATALOG });
    expect(router.transcriber?.()?.id).toBe("edenai:assembly");
    expect(router.documentParser?.()?.id).toBe("edenai:mistral");
    const llmRouted = createModelRouter({
      env: ALL_KEYS,
      routing: {
        document_parsing: { provider: "anthropic", model_id: null, auto_mode: "balanced" },
      },
      catalog: FULL_CATALOG,
    });
    expect(llmRouted.documentParser?.()?.id).toBe("anthropic:fx-sonnet-new");
    expect(
      createModelRouter({ env: { ANTHROPIC_API_KEY: "a" }, catalog: FULL_CATALOG }).transcriber?.(),
    ).toBeUndefined();
  });

  it("falls back to a provider with a key and warns", () => {
    const warn = vi.fn();
    const router = createModelRouter({
      env: { OPENROUTER_API_KEY: "ok" },
      catalog: FULL_CATALOG,
      warn,
    });
    expect(router.route?.("summarize")).toMatchObject({ provider: "openrouter", source: "auto" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("anthropic nicht nutzbar"));
    expect(router.modelIds.vision).toBe("fx/vision-mid");
  });

  it("refuses to start without any provider key; unroutable tasks fail on use", () => {
    expect(() => createModelRouter({ env: {} })).toThrow(ConfigError);
    expect(() => createModelRouter({ env: { OPENROUTER_API_KEY: "<DEIN_KEY>" } })).toThrow(
      ConfigError,
    );
    const router = createModelRouter({ env: { EDENAI_API_KEY: "ek" }, catalog: FULL_CATALOG });
    expect(() => router.chat()).not.toThrow(); // Eden AI LLM via Auto
    expect(
      createModelRouter({ env: { ANTHROPIC_API_KEY: "a" }, catalog: FULL_CATALOG }).modelIds
        .embedding,
    ).toBe("nicht konfiguriert");
    expect(() =>
      createModelRouter({ env: { ANTHROPIC_API_KEY: "a" }, catalog: FULL_CATALOG }).embedding(),
    ).toThrow(ConfigError);
  });
});

describe("OpenRouter: data_collection 'deny' on every request", () => {
  it("chat requests for every language task", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({
      env: { OPENROUTER_API_KEY: "test-key" },
      routing: OPENROUTER_ONLY,
      fetch,
    });
    for (const model of [
      router.fast(),
      router.chat(),
      router.vision(),
      modelFor(router, "meeting_coach"),
      modelFor(router, "auto_organize"),
    ]) {
      await generateText({ model, prompt: "Hallo?" });
    }
    expect(fetch.calls.map((c) => (c.body as { model: string }).model)).toEqual([
      "fx/summarize",
      "fx/chat",
      "fx/vision",
      "fx/coach",
      "fx/organize",
    ]);
    for (const call of fetch.calls) {
      expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(providerOf(call)?.data_collection).toBe("deny");
    }
  });

  it("structured-output requests", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({
      env: { OPENROUTER_API_KEY: "test-key" },
      routing: OPENROUTER_ONLY,
      fetch,
    });
    const { output } = await generateText({
      model: router.fast(),
      prompt: "Antworte",
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });
    expect(output.answer).toBe("ja");
    expect(providerOf(fetch.calls[0] as RecordedRequest)?.data_collection).toBe("deny");
  });

  it("embedding requests", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({
      env: { OPENROUTER_API_KEY: "test-key" },
      routing: OPENROUTER_ONLY,
      fetch,
    });
    const { embeddings } = await embedMany({ model: router.embedding(), values: ["a", "b"] });
    expect(embeddings).toHaveLength(2);
    const call = fetch.calls[0] as RecordedRequest;
    expect(call.url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(providerOf(call)?.data_collection).toBe("deny");
  });

  it("cannot be overridden by per-call provider options; key only goes to openrouter.ai", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({
      env: { OPENROUTER_API_KEY: "test-key" },
      routing: OPENROUTER_ONLY,
      fetch,
    });
    await generateText({
      model: router.chat(),
      prompt: "x",
      providerOptions: {
        openrouter: { provider: { data_collection: "allow", order: ["google-vertex"] } },
      },
    });
    const call = fetch.calls[0] as RecordedRequest;
    expect(providerOf(call)?.data_collection).toBe("deny");
    expect(call.headers.authorization).toBe("Bearer test-key");
    expect(new URL(call.url).host).toBe("openrouter.ai");
  });

  it("the deprecated apiKey option still means the OpenRouter key", () => {
    const router = createModelRouter({ apiKey: "legacy-or", routing: OPENROUTER_ONLY });
    expect(router.route?.("summarize")).toMatchObject({
      provider: "openrouter",
      modelId: "fx/summarize",
    });
  });
});

describe("enforceZeroDataRetention", () => {
  const capture = () => {
    const seen: Array<RequestInit | undefined> = [];
    const base = async (_i: string | URL | Request, init?: RequestInit) => {
      seen.push(init);
      return json({});
    };
    return { seen, wrapped: enforceZeroDataRetention(base) };
  };

  it("overrides an explicit 'allow' and keeps other provider prefs", async () => {
    const { seen, wrapped } = capture();
    await wrapped("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", provider: { data_collection: "allow", sort: "price" } }),
    });
    expect(JSON.parse(String(seen[0]?.body))).toEqual({
      model: "m",
      provider: { data_collection: "deny", sort: "price" },
    });
  });

  it("passes body-less requests through", async () => {
    const { seen, wrapped } = capture();
    await wrapped("https://openrouter.ai/api/v1/models", { method: "GET" });
    expect(seen[0]?.body).toBeUndefined();
  });

  it("fails closed on bodies it cannot rewrite", async () => {
    const { seen, wrapped } = capture();
    await expect(wrapped("u", { method: "POST", body: new FormData() })).rejects.toBeInstanceOf(
      ZeroDataRetentionError,
    );
    await expect(wrapped("u", { method: "POST", body: "not json" })).rejects.toBeInstanceOf(
      ZeroDataRetentionError,
    );
    await expect(wrapped("u", { method: "POST", body: "[1,2]" })).rejects.toBeInstanceOf(
      ZeroDataRetentionError,
    );
    expect(seen).toHaveLength(0);
  });
});

describe("source guards", () => {
  const srcDir = join(import.meta.dirname, "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
  const rel = (f: string) => relative(srcDir, f).replace(/\\/g, "/");

  it("only router/model-router.ts builds an OpenRouter provider or names the OpenRouter host", () => {
    const offenders = files(srcDir)
      .filter((f) => rel(f) !== "router/model-router.ts")
      .filter((f) =>
        /@openrouter\/ai-sdk-provider|createOpenRouter|openrouter\.ai/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no hardcoded LLM / embedding model ids outside the marked offline fallback (ADR-06)", () => {
    const MODEL_ID =
      /claude-(haiku|sonnet|opus|fable)-\d|gemini-\d|gpt-\d|text-embedding-\d|deepseek-r\d|mistral-ocr|nova-\d|claude-\d/;
    const offenders = files(srcDir)
      .filter((f) => rel(f) !== "router/auto-select.ts")
      .filter((f) => MODEL_ID.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("model override (copilot model switch)", () => {
  it("infers the provider from the id shape or an explicit prefix", () => {
    expect(parseModelOverride("fx-sonnet-new")).toEqual({
      provider: "anthropic",
      model_id: "fx-sonnet-new",
    });
    expect(parseModelOverride("fx/vision-mid")).toEqual({
      provider: "openrouter",
      model_id: "fx/vision-mid",
    });
    expect(parseModelOverride("llm/mistral/fx-small")).toEqual({
      provider: "edenai",
      model_id: "llm/mistral/fx-small",
    });
    expect(parseModelOverride("openrouter:fx-plain")).toEqual({
      provider: "openrouter",
      model_id: "fx-plain",
    });
  });

  it("pins one task and keeps the rest of the routing", () => {
    const cfg = withModelOverride(
      { summarize: { provider: "openrouter", model_id: "fx/a" } },
      "chat_reasoning",
      "fx-opus-new",
    );
    expect(cfg.chat_reasoning).toMatchObject({ provider: "anthropic", model_id: "fx-opus-new" });
    expect(cfg.summarize).toMatchObject({ provider: "openrouter", model_id: "fx/a" });
    expect(withModelOverride(null, "chat_reasoning", undefined).chat_reasoning).toEqual(
      DEFAULT_AI_ROUTING.chat_reasoning,
    );
    expect(() => withModelOverride(null, "embeddings", "fx-sonnet-new")).toThrow(ConfigError);
  });
});

describe("embeddings always 1536 dimensions", () => {
  it("asks OpenRouter for 1536 dimensions (and keeps data_collection: deny)", async () => {
    const fetch = providersFetch();
    const router = createModelRouter({ env: ALL_KEYS, catalog: FULL_CATALOG, fetch });
    await embedMany({ model: router.embedding(), values: ["a"] });
    const call = fetch.calls.find((c) => c.url.endsWith("/embeddings"));
    expect(call?.body).toMatchObject({ dimensions: 1536, provider: { data_collection: "deny" } });
  });

  it("refuses vectors of another size", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u.endsWith("/embeddings"),
        respond: () =>
          json({
            object: "list",
            model: "fx/emb",
            data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
      },
    ]);
    const router = createModelRouter({ env: ALL_KEYS, catalog: FULL_CATALOG, fetch });
    await expect(
      embedMany({ model: router.embedding(), values: ["a"], maxRetries: 0 }),
    ).rejects.toThrow(/2 statt 1536/);
  });
});
