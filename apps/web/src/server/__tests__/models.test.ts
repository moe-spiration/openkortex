import { describe, expect, it } from "vitest";
import type { ModelCatalogEntry } from "@kortex/db";
import { readServerEnv } from "../env";
import type { DiscoverModels } from "../routing/discovery";
import { createModelsHandlers, type ModelsResponse } from "../routing/models";
import { FakeSupabase } from "./fake-supabase";
import { authed, NOW, setup } from "./helpers";

const URL_ = "https://kortex.test/api/models";

const entry = (over: Partial<ModelCatalogEntry>): ModelCatalogEntry => ({
  provider: "openrouter",
  model_id: "x/model",
  display_name: null,
  capabilities: ["chat"],
  context_length: null,
  embedding_dimensions: null,
  pricing: {},
  is_available: true,
  fetched_at: NOW.toISOString(),
  ...over,
});

const seeded = () =>
  new FakeSupabase({
    ai_model_catalog: [
      {
        ...entry({
          model_id: "openai/text-embedding-3-small",
          capabilities: ["embeddings"],
          embedding_dimensions: 1536,
        }),
      },
      {
        ...entry({
          model_id: "openai/text-embedding-3-large",
          capabilities: ["embeddings"],
          embedding_dimensions: 3072,
        }),
      },
      { ...entry({ model_id: "google/gemini-2.5-flash", capabilities: ["chat", "vision"] }) },
      {
        ...entry({
          provider: "anthropic",
          model_id: "claude-sonnet-4-5",
          capabilities: ["chat", "vision"],
        }),
      },
    ],
  });

const get = (query = "") => new Request(URL_ + query, authed());

describe("GET /api/models", () => {
  it("serves the cached catalog per provider and filters by task (1536-dim embeddings only)", async () => {
    const t = setup({ db: seeded() });
    const res = await createModelsHandlers(() => t.deps).GET(
      get("?provider=openrouter&task=embeddings"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0]).toMatchObject({ provider: "openrouter", source: "cache" });
    expect(body.providers[0]!.models.map((m) => m.model_id)).toEqual([
      "openai/text-embedding-3-small",
    ]);
  });

  it("lists all three providers without a filter and warns when there is no discovery", async () => {
    const t = setup({ db: new FakeSupabase() });
    const body = (await (
      await createModelsHandlers(
        () => t.deps,
        () => null,
      ).GET(get())
    ).json()) as ModelsResponse;
    expect(body.providers.map((p) => p.provider)).toEqual(["anthropic", "openrouter", "edenai"]);
    expect(body.providers.every((p) => p.models.length === 0 && p.warning)).toBe(true);
  });

  it("refreshes through the discovery seam and upserts with the service role", async () => {
    const t = setup({ db: seeded() });
    const discover: DiscoverModels = async (provider) => [
      { ...entry({ provider, model_id: "claude-haiku-4-5", capabilities: ["chat"] }) },
    ];
    const body = (await (
      await createModelsHandlers(
        () => t.deps,
        () => discover,
      ).GET(get("?provider=anthropic&refresh=1"))
    ).json()) as ModelsResponse;
    expect(body.providers[0]).toMatchObject({ source: "live" });
    expect(body.providers[0]!.models.map((m) => m.model_id)).toEqual(["claude-haiku-4-5"]);
    expect(t.clientKinds).toContain("service");
    expect(t.db.rows("ai_model_catalog").some((r) => r.model_id === "claude-haiku-4-5")).toBe(true);
  });

  it("falls back to the cache when discovery fails", async () => {
    const t = setup({ db: seeded() });
    const discover: DiscoverModels = async () => {
      throw new Error("401");
    };
    const body = (await (
      await createModelsHandlers(
        () => t.deps,
        () => discover,
      ).GET(get("?provider=anthropic&refresh=true"))
    ).json()) as ModelsResponse;
    expect(body.providers[0]).toMatchObject({ source: "cache" });
    expect(body.providers[0]!.warning).toContain("fehlgeschlagen");
    expect(body.providers[0]!.models.map((m) => m.model_id)).toEqual(["claude-sonnet-4-5"]);
  });

  it("rejects unknown providers and tasks", async () => {
    const t = setup({ db: seeded() });
    expect((await createModelsHandlers(() => t.deps).GET(get("?provider=openai"))).status).toBe(
      400,
    );
    expect((await createModelsHandlers(() => t.deps).GET(get("?task=translate"))).status).toBe(400);
  });
});

describe("server env (ADR-06 keys)", () => {
  it("accepts CLAUDE_API_KEY as alias of ANTHROPIC_API_KEY and hands it to ai-core", () => {
    const env = readServerEnv({
      CLAUDE_API_KEY: "sk-ant-legacy",
      EDENAI_API_KEY: "eden",
      OPENROUTER_API_KEY: "or",
    });
    expect(env.anthropicApiKey).toBe("sk-ant-legacy");
    expect(env.raw.ANTHROPIC_API_KEY).toBe("sk-ant-legacy");
    expect(env.edenaiApiKey).toBe("eden");
    expect(env.openrouterApiKey).toBe("or");
  });

  it("prefers ANTHROPIC_API_KEY and ignores placeholders", () => {
    expect(
      readServerEnv({ ANTHROPIC_API_KEY: "sk-ant-new", CLAUDE_API_KEY: "old" }).anthropicApiKey,
    ).toBe("sk-ant-new");
    expect(
      readServerEnv({ ANTHROPIC_API_KEY: "<DEIN_KEY>", CLAUDE_API_KEY: "old" }).anthropicApiKey,
    ).toBe("old");
  });
});
