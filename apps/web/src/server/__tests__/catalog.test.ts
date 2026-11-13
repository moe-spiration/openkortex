import { describe, expect, it } from "vitest";
import type { CatalogModel } from "@kortex/ai-core";
import { createCatalogLoader, saveCatalog, selectCatalog } from "../routing/catalog";
import type { DiscoverModels } from "../routing/discovery";
import { FakeSupabase } from "./fake-supabase";
import { NOW, setup } from "./helpers";

const model = (over: Partial<CatalogModel>): CatalogModel => ({
  provider: "anthropic",
  model_id: "fx-a",
  display_name: null,
  capabilities: ["chat"],
  context_length: null,
  embedding_dimensions: null,
  pricing: {},
  is_available: true,
  fetched_at: NOW.toISOString(),
  raw: { released_at: "2026-10-01T00:00:00Z", family: "haiku" },
  ...over,
});

const DAY = 24 * 60 * 60 * 1000;

describe("model catalog loader", () => {
  it("discovers a provider with a key and no rows, stores raw, and caches in memory", async () => {
    const t = setup({ db: new FakeSupabase(), env: { ANTHROPIC_API_KEY: "", CLAUDE_API_KEY: "ak" } });
    const calls: string[] = [];
    const discover: DiscoverModels = async (provider, { env }) => {
      calls.push(provider);
      expect(env.ANTHROPIC_API_KEY).toBe("ak");
      return [model({})];
    };
    const load = createCatalogLoader(t.deps, () => discover);
    const first = await load();
    expect(calls).toEqual(["anthropic"]); // no OpenRouter / Eden AI key in this env
    expect(first.map((m) => m.model_id)).toEqual(["fx-a"]);
    expect(t.db.rows("ai_model_catalog")[0]).toMatchObject({
      model_id: "fx-a",
      raw: { family: "haiku" },
    });
    expect(t.clientKinds).toContain("service");
    await load();
    expect(calls).toHaveLength(1);
  });

  it("serves stored rows and refreshes stale providers in the background", async () => {
    const old = new Date(NOW.getTime() - 2 * DAY).toISOString();
    const t = setup({
      db: new FakeSupabase({
        ai_model_catalog: [
          { ...model({ fetched_at: old }) },
          { ...model({ model_id: "fx-gone", is_available: false, fetched_at: old }) },
        ],
      }),
      env: { CLAUDE_API_KEY: "ak" },
    });
    const discover: DiscoverModels = async () => [model({ model_id: "fx-b" })];
    const models = await createCatalogLoader(t.deps, () => discover)();
    expect(models.map((m) => m.model_id)).toEqual(["fx-a"]);
    expect(t.deferred).toHaveLength(1);
    await Promise.all(t.deferred);
    const rows = t.db.rows("ai_model_catalog");
    expect(rows.find((r) => r.model_id === "fx-b")?.is_available).toBe(true);
    // fx-a is no longer listed by the provider → unavailable
    expect(rows.find((r) => r.model_id === "fx-a")?.is_available).toBe(false);
  });

  it("returns an empty catalog (router uses its offline list) when discovery fails", async () => {
    const t = setup({ db: new FakeSupabase(), env: { CLAUDE_API_KEY: "ak" } });
    const load = createCatalogLoader(t.deps, () => async () => {
      throw new Error("503");
    });
    expect(await load()).toEqual([]);
    expect(t.errors.some((e) => e.message === "model discovery anthropic")).toBe(true);
  });

  it("reads past the PostgREST 1000-row page", async () => {
    const rows = Array.from({ length: 1205 }, (_, i) => ({
      ...model({ provider: "edenai", model_id: `llm/x/m${i}` }),
    }));
    const t = setup({ db: new FakeSupabase({ ai_model_catalog: rows }) });
    expect(await selectCatalog(t.deps.clients.service(), "edenai")).toHaveLength(1205);
  });

  it("saveCatalog does nothing for an empty listing", async () => {
    const t = setup({ db: new FakeSupabase({ ai_model_catalog: [{ ...model({}) }] }) });
    await saveCatalog(t.deps, "anthropic", []);
    expect(t.db.rows("ai_model_catalog")[0]?.is_available).toBe(true);
  });
});
