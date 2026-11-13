import { describe, expect, it } from "vitest";
import { DEFAULT_AI_ROUTING } from "@kortex/db";
import { createLiveUserModelRouter } from "../src/router/live-router";
import { createIngestionPipeline } from "../src/pipeline/ingest";
import { fakeKortexClient } from "./fake-supabase";
import { FULL_CATALOG, m } from "./fixtures/catalog";
import { USER_ID } from "./helpers";

const ENV = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o", EDENAI_API_KEY: "e" };

const setup = () =>
  fakeKortexClient({
    user_settings: [
      { user_id: USER_ID, ai_routing_config: structuredClone(DEFAULT_AI_ROUTING), embedding_lock: null },
    ],
    ai_model_catalog: FULL_CATALOG.map((c) => ({ ...c })),
  });

/** Manual timer so the periodic refresh can be fired from the test. */
const manualTimer = () => {
  let fn: (() => void) | null = null;
  let cleared = false;
  return {
    setInterval: (f: () => void) => ((fn = f), "t"),
    clearInterval: () => {
      cleared = true;
    },
    fire: () => fn?.(),
    get cleared() {
      return cleared;
    },
  };
};

describe("createLiveUserModelRouter (md-sync/MCP pick up routing without restart)", () => {
  it("a settings change from the feed rebuilds the router; the stable proxy follows it", async () => {
    const db = setup();
    let emit: () => void = () => undefined;
    let unsubscribed = false;
    const reasons: string[] = [];
    const live = await createLiveUserModelRouter({
      client: db.client,
      userId: USER_ID,
      env: ENV,
      refreshIntervalMs: 0,
      subscribe: (cb) => {
        emit = cb;
        return () => {
          unsubscribed = true;
        };
      },
      onRebuild: (_u, reason) => reasons.push(reason),
    });
    // A pipeline built once holds the proxy, not a snapshot.
    const pipeline = createIngestionPipeline({ storage: { upload: async () => "" } as never, env: ENV, models: live.models });
    expect(live.models.route!("summarize")).toMatchObject({ provider: "anthropic" });

    const row = db.tables.user_settings![0]!;
    row.ai_routing_config = {
      ...(row.ai_routing_config as object),
      summarize: { provider: "openrouter", model_id: "fx/chat-cheap", auto_mode: "cost_efficient" },
    };
    emit();
    await live.ensureFresh();

    expect(reasons).toEqual(["settings changed"]);
    expect(live.models.route!("summarize")).toMatchObject({ provider: "openrouter", modelId: "fx/chat-cheap" });
    expect(pipeline.models.route!("summarize")).toMatchObject({ provider: "openrouter" });
    await live.close();
    expect(unsubscribed).toBe(true);
  });

  it("a new embedding lock (after a re-embed) reaches the embeddings route", async () => {
    const db = setup();
    let emit: () => void = () => undefined;
    const live = await createLiveUserModelRouter({
      client: db.client,
      userId: USER_ID,
      env: ENV,
      refreshIntervalMs: 0,
      subscribe: (cb) => void (emit = cb),
    });
    expect(live.current().embeddings?.key).toBe("openrouter:fx/emb-1536-cheap");
    const theirs = { provider: "edenai", model_id: "embeddings/openai/1536__fx-ada", dimensions: 1536 };
    db.tables.user_settings![0]!.embedding_lock = theirs;
    emit();
    await live.ensureFresh();
    expect(live.models.route!("embeddings")).toMatchObject({
      provider: "edenai",
      modelId: "embeddings/openai/1536__fx-ada",
      source: "locked",
    });
  });

  it("the periodic refresh reloads the catalog (Auto picks a new model)", async () => {
    const db = setup();
    const timer = manualTimer();
    const live = await createLiveUserModelRouter({
      client: db.client,
      userId: USER_ID,
      env: ENV,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    const before = live.current().catalogSize;
    db.tables.ai_model_catalog!.push({
      ...m("anthropic", "fx/claude-new", ["chat"], {
        pricing: { input_per_mtok: 0.01, output_per_mtok: 0.02 },
        released: "2026-10-20",
      }),
    });
    timer.fire();
    const after = await live.ensureFresh();
    expect(after.catalogSize).toBe(before + 1);
    await live.close();
    expect(timer.cleared).toBe(true);
  });

  it("a failed rebuild keeps the previous router", async () => {
    const db = setup();
    let emit: () => void = () => undefined;
    const errors: string[] = [];
    const live = await createLiveUserModelRouter({
      client: db.client,
      userId: USER_ID,
      env: ENV,
      refreshIntervalMs: 0,
      subscribe: (cb) => void (emit = cb),
      onError: (_e, reason) => errors.push(reason),
    });
    const first = live.current();
    db.tables.user_settings = undefined as never; // the reload query now throws
    emit();
    const after = await live.ensureFresh();
    expect(after).toBe(first);
    expect(errors).toEqual(["settings changed"]);
    expect(live.models.route!("summarize")).toMatchObject({ provider: "anthropic" });
  });
});
