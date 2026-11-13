import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_ROUTING, parseAiRouting, type AiRoutingConfig } from "@kortex/db";
import { ConfigError } from "../src/errors";
import { reembedUser } from "../src/router/reembed";
import { createUserModelRouter, describeRoutes } from "../src/router/user-router";
import { fakeKortexClient } from "./fake-supabase";
import { FULL_CATALOG, m } from "./fixtures/catalog";
import { mockEmbeddingModel, staticRouter, USER_ID } from "./helpers";

const ENV = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o", EDENAI_API_KEY: "e" };

const settingsRow = (extra: Record<string, unknown> = {}) => ({
  user_id: USER_ID,
  ai_routing_config: structuredClone(DEFAULT_AI_ROUTING),
  embedding_lock: null,
  ...extra,
});

const setup = (row = settingsRow(), catalog = FULL_CATALOG) =>
  fakeKortexClient({
    user_settings: [row],
    ai_model_catalog: catalog.map((c) => ({ ...c })),
  });

describe("createUserModelRouter (one resolver for web, md-sync and MCP)", () => {
  it("pins the first embeddings pick, mirrors it into the routing and keys chunks by it", async () => {
    const db = setup();
    const user = await createUserModelRouter({ client: db.client, userId: USER_ID, env: ENV });

    expect(user.embeddings).toEqual({
      provider: "openrouter",
      modelId: "fx/emb-1536-cheap",
      key: "openrouter:fx/emb-1536-cheap",
      source: "locked",
      lockedNow: true,
    });
    const row = db.tables.user_settings![0]!;
    expect(row.embedding_lock).toMatchObject({
      provider: "openrouter",
      model_id: "fx/emb-1536-cheap",
      dimensions: 1536,
    });
    expect(parseAiRouting(row.ai_routing_config).embeddings).toMatchObject({
      provider: "openrouter",
      model_id: "fx/emb-1536-cheap",
    });
    // Text tasks still follow the catalog (Auto).
    expect(user.models.route!("summarize")).toMatchObject({ provider: "anthropic", source: "auto" });
    expect(user.catalogSize).toBe(FULL_CATALOG.filter((c) => c.is_available).length);
  });

  it("no drift: a cheaper embedding model in the catalog does not change a locked user", async () => {
    const db = setup();
    await createUserModelRouter({ client: db.client, userId: USER_ID, env: ENV });
    db.tables.ai_model_catalog!.push({
      ...m("openrouter", "fx/emb-1536-cheaper", ["embeddings"], {
        dims: 1536,
        pricing: { input_per_mtok: 0.0001 },
        released: "2026-10-01",
      }),
    });
    const again = await createUserModelRouter({ client: db.client, userId: USER_ID, env: ENV });
    expect(again.embeddings).toMatchObject({ modelId: "fx/emb-1536-cheap", lockedNow: false });
    // Without the lock, Auto would have drifted to the new model:
    const unlocked = await createUserModelRouter({
      client: setup(settingsRow(), db.tables.ai_model_catalog as never).client,
      userId: USER_ID,
      env: ENV,
      lockEmbeddings: false,
    });
    expect(unlocked.embeddings).toMatchObject({ modelId: "fx/emb-1536-cheaper", source: "auto" });
  });

  it("a lock written by another process wins (compare-and-set)", async () => {
    const theirs = { provider: "edenai", model_id: "embeddings/openai/1536__fx-ada", dimensions: 1536 };
    const db = setup(settingsRow({ embedding_lock: theirs }));
    const user = await createUserModelRouter({ client: db.client, userId: USER_ID, env: ENV });
    expect(user.embeddings).toMatchObject({
      provider: "edenai",
      key: "edenai:embeddings/openai/1536__fx-ada",
      lockedNow: false,
    });
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("read-only callers can skip locking", async () => {
    const db = setup();
    const user = await createUserModelRouter({
      client: db.client,
      userId: USER_ID,
      env: ENV,
      lockEmbeddings: false,
    });
    expect(user.embeddings).toMatchObject({ source: "auto", lockedNow: false });
    expect(db.tables.user_settings![0]!.embedding_lock).toBeNull();
  });

  it("warns when the routing names another embedding model than the lock", async () => {
    const warn = vi.fn();
    const routing: AiRoutingConfig = structuredClone(DEFAULT_AI_ROUTING);
    routing.embeddings = { ...routing.embeddings, model_id: "fx/emb-1536-pricey" };
    const db = setup(
      settingsRow({
        ai_routing_config: routing,
        embedding_lock: { provider: "openrouter", model_id: "fx/emb-1536-cheap", dimensions: 1536 },
      }),
    );
    const user = await createUserModelRouter({ client: db.client, userId: USER_ID, env: ENV, warn });
    expect(user.embeddings?.modelId).toBe("fx/emb-1536-cheap");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Re-Embed"));
  });

  it("accepts any ADR-06 key; a routed provider without key gives a clear error", async () => {
    await expect(
      createUserModelRouter({ client: setup().client, userId: USER_ID, env: {} }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY.*OPENROUTER_API_KEY.*EDENAI_API_KEY/);

    // Legacy CLAUDE_API_KEY alone: text tasks work, embeddings (OpenRouter) are off with a reason.
    const db = setup();
    const user = await createUserModelRouter({
      client: db.client,
      userId: USER_ID,
      env: { CLAUDE_API_KEY: "a" },
    });
    expect(user.models.route!("summarize").provider).toBe("anthropic");
    expect(user.embeddings).toBeNull();
    expect(user.embeddingsError).toMatch(/OPENROUTER_API_KEY fehlt/);
    expect(db.tables.user_settings![0]!.embedding_lock).toBeNull();

    // Locked to OpenRouter but the key is gone: no silent switch to Eden AI.
    const locked = setup(
      settingsRow({
        embedding_lock: { provider: "openrouter", model_id: "fx/emb-1536-cheap", dimensions: 1536 },
      }),
    );
    const u2 = await createUserModelRouter({
      client: locked.client,
      userId: USER_ID,
      env: { EDENAI_API_KEY: "e" },
    });
    expect(u2.embeddings).toBeNull();
    expect(u2.embeddingsError).toMatch(/openrouter:fx\/emb-1536-cheap.*OPENROUTER_API_KEY/);
    expect(() => u2.models.embedding()).toThrow(ConfigError);
  });

  it("describeRoutes lists provider, model and source per task", async () => {
    const user = await createUserModelRouter({ client: setup().client, userId: USER_ID, env: ENV });
    expect(describeRoutes(user.models, ["summarize", "embeddings"])).toEqual([
      "summarize: anthropic:fx-haiku-new (auto)",
      "embeddings: openrouter:fx/emb-1536-cheap (locked)",
    ]);
  });
});

describe("reembedUser (explicit model switch)", () => {
  const chunk = (id: string, model: string | null) => ({
    id,
    item_id: "item-1",
    user_id: USER_ID,
    chunk_index: Number(id.slice(-1)),
    chunk_heading: null,
    page_or_timestamp: null,
    chunk_text: `chunk ${id} text`,
    embedding: "[0]",
    metadata: model ? { embedding_model: model, token_estimate: 3 } : { token_estimate: 3 },
  });

  const lockedDb = () =>
    fakeKortexClient({
      user_settings: [
        settingsRow({
          embedding_lock: { provider: "openrouter", model_id: "fx/old", dimensions: 1536 },
        }),
      ],
      item_chunks: [chunk("c1", "openrouter:fx/old"), chunk("c2", "openrouter:fx/new"), chunk("c3", null)],
    });

  it("dry run (default) only counts", async () => {
    const db = lockedDb();
    const res = await reembedUser({
      client: db.client,
      userId: USER_ID,
      target: { provider: "openrouter", model_id: "fx/new" },
    });
    expect(res).toMatchObject({ chunks: 3, pending: 2, reembedded: 0, to: "openrouter:fx/new" });
    expect(db.calls.filter((c) => c.op !== "select")).toEqual([]);
  });

  it("rewrites pending chunks with the target model, then moves the lock", async () => {
    const db = lockedDb();
    const models = { ...staticRouter({}), embedding: () => mockEmbeddingModel() };
    const res = await reembedUser({
      client: db.client,
      userId: USER_ID,
      target: { provider: "openrouter", model_id: "fx/new" },
      models,
      dryRun: false,
    });
    expect(res.reembedded).toBe(2);
    const rows = db.tables.item_chunks!;
    expect(rows.map((r) => (r.metadata as { embedding_model: string }).embedding_model)).toEqual([
      "openrouter:fx/new",
      "openrouter:fx/new",
      "openrouter:fx/new",
    ]);
    expect(String(rows[0]!.embedding).split(",")).toHaveLength(1536);
    expect(db.tables.user_settings![0]!.embedding_lock).toMatchObject({ model_id: "fx/new" });
    expect(parseAiRouting(db.tables.user_settings![0]!.ai_routing_config).embeddings.model_id).toBe(
      "fx/new",
    );
  });
});
