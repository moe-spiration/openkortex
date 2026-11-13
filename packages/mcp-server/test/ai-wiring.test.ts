import { describe, expect, it } from "vitest";
import {
  createAiCoreEmbedder,
  createAiCoreEnricher,
  createAiFromEnv,
  OFFLINE_ROUTING_NOTE,
} from "../src/ai";
import type { ItemEnricher } from "../src/repository";
import { mockRouter } from "./ai-mocks";
import { connect } from "./helpers";

const FAKE_KEY = "sk-or-v1-test-only";

/** Records every request; answers OpenRouter's embeddings endpoint with 1536-dim vectors. */
function recordingFetch() {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    bodies.push({ url, body });
    const inputs = (body.input as string[] | undefined) ?? [];
    return new Response(
      JSON.stringify({
        object: "list",
        model: "openai/text-embedding-3-small",
        data: inputs.map((_, index) => ({
          object: "embedding",
          index,
          embedding: new Array(1536).fill(0.1),
        })),
        usage: { prompt_tokens: 3, total_tokens: 3 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetch, bodies };
}

describe("createAiFromEnv", () => {
  it("stays full-text only without any ADR-06 provider key", () => {
    const ai = createAiFromEnv({});
    expect(ai.embedder).toBeUndefined();
    expect(ai.enricher).toBeUndefined();
    expect(ai.notes.join(" ")).toMatch(/no AI provider key.*OPENROUTER_API_KEY.*EDENAI_API_KEY/);
  });

  it("any provider key counts: CLAUDE_API_KEY alone runs the organizer, embeddings say what is missing", () => {
    const ai = createAiFromEnv({ CLAUDE_API_KEY: "a", KORTEX_MCP_ORGANIZE: "1" });
    expect(ai.enricher).toBeDefined();
    expect(ai.embedder).toBeUndefined();
    expect(ai.notes.join(" ")).toMatch(/embeddings unavailable.*OPENROUTER_API_KEY fehlt/);
  });

  it("wires the real ai-core embedder, sending data_collection: 'deny' to OpenRouter", async () => {
    const { fetch, bodies } = recordingFetch();
    const ai = createAiFromEnv({ OPENROUTER_API_KEY: FAKE_KEY }, { fetch });
    expect(ai.enricher).toBeUndefined(); // organizer is opt-in
    const vector = await ai.embedder!.embed("how does md-sync avoid echo loops?");
    expect(vector).toHaveLength(1536);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(bodies[0]?.body.provider).toMatchObject({ data_collection: "deny" });
  });

  it("enables the organizer with KORTEX_MCP_ORGANIZE=1 and skips embeddings in service-role mode", () => {
    const ai = createAiFromEnv(
      { OPENROUTER_API_KEY: FAKE_KEY, KORTEX_MCP_ORGANIZE: "1" },
      { vectorSearch: false },
    );
    expect(ai.embedder).toBeUndefined();
    expect(ai.enricher).toBeDefined();
    expect(ai.notes.join(" ")).toMatch(/full-text only/);
  });

  it("announces the offline routing and warns when a user is configured (routing gap, ADR-06)", () => {
    const plain = createAiFromEnv({ CLAUDE_API_KEY: "a", KORTEX_MCP_ORGANIZE: "1" });
    expect(plain.notes).toContain(OFFLINE_ROUTING_NOTE);
    expect(plain.notes.join(" ")).not.toMatch(/WARNING/);
    const withUser = createAiFromEnv({
      CLAUDE_API_KEY: "a",
      KORTEX_MCP_ORGANIZE: "1",
      KORTEX_USER_ID: "11111111-1111-4111-8111-111111111111",
    });
    expect(withUser.notes.join(" ")).toMatch(
      /WARNING: KORTEX_USER_ID is set but the user routing is ignored/,
    );
  });

  it("KORTEX_MCP_EMBEDDINGS=0 turns the embedder off", () => {
    expect(
      createAiFromEnv({ OPENROUTER_API_KEY: FAKE_KEY, KORTEX_MCP_EMBEDDINGS: "0" }).embedder,
    ).toBeUndefined();
  });
});

describe("brain_search with the ai-core embedder", () => {
  it("runs hybrid with a 1536-dim query embedding", async () => {
    const { router } = mockRouter();
    const t = await connect({ embedder: createAiCoreEmbedder(router) });
    await t.call("brain_save_item", {
      title: "Echo loops",
      content_md: "Checksums stop echo loops.",
    });
    const res = await t.call("brain_search", { query: "echo loops" });
    expect(res.json.mode).toBe("hybrid");
    expect(t.repo.seenEmbeddings[0]).toHaveLength(1536);
    await t.close();
  });

  it("the vector side only meets chunks of the query's embedding model", async () => {
    const { router } = mockRouter();
    const embedder = createAiCoreEmbedder(router);
    expect(embedder.modelKey).toBe("openrouter:mock/embedding");
    const t = await connect({ embedder, enricher: createAiCoreEnricher(router) });
    const same = await t.call("brain_save_item", { title: "Alpha", content_md: "zebra quartz" });
    const other = await t.call("brain_save_item", { title: "Beta", content_md: "zebra quartz" });
    expect(t.repo.chunks.get(same.json.id)?.[0]?.metadata).toMatchObject({
      embedding_model: "openrouter:mock/embedding",
    });
    // Pretend Beta was embedded with another model (another vector space).
    for (const c of t.repo.chunks.get(other.json.id) ?? [])
      c.metadata = { ...c.metadata, embedding_model: "openrouter:other/model" };
    // Query shares no words with the titles/bodies: only the vector side can find anything.
    const spy = await t.call("brain_search", { query: "zebra quartz" });
    expect(spy.json.mode).toBe("hybrid");
    const res = await t.repo.search({
      query: "nomatch",
      embedding: t.repo.seenEmbeddings[0]!,
      embeddingModel: "openrouter:mock/embedding",
      limit: 10,
    });
    expect(res.map((r) => r.title)).toEqual(["Alpha"]);
    await t.close();
  });
});

describe("organizer on save (KORTEX_MCP_ORGANIZE)", () => {
  it("brain_save_item without folder: organizer files it, adds summary/tags, stores chunks", async () => {
    const { router, calls } = mockRouter();
    const t = await connect({ enricher: createAiCoreEnricher(router) });
    const res = await t.call("brain_save_item", {
      title: "Wiring notes",
      content_md: "md-sync now feeds ai-core.",
      tags: ["kortex"],
    });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({
      folder_path: "10_Notes/Engineering",
      status: "processed",
      enrichment: { ok: true, status: "done" },
    });
    expect(res.json.tags).toEqual(expect.arrayContaining(["kortex", "kortex/md-sync"]));
    const item = t.repo.items.get(res.json.id)!;
    expect(item).toMatchObject({
      summary: "Session notes about the vault daemon.",
      cluster_name: "Engineering",
      content_md: "md-sync now feeds ai-core.", // body untouched
      title: "Wiring notes",
    });
    expect(item.metadata).toMatchObject({
      ai_title: "Sync daemon wiring",
      ingest: { source: "mcp", state: "done" },
    });
    expect(t.repo.entities.get(item.id)).toEqual(["Supabase"]);
    const chunks = t.repo.chunks.get(item.id) ?? [];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.embedding).toHaveLength(1536);
    expect(t.repo.folders.has("10_Notes/Engineering")).toBe(true);
    expect(calls.llm.organizer).toBe(1);
    await t.close();
  });

  it("brain_save_item with an explicit folder keeps it (manual placement)", async () => {
    const { router } = mockRouter();
    const t = await connect({ enricher: createAiCoreEnricher(router) });
    const res = await t.call("brain_save_item", {
      title: "Client notes",
      content_md: "Kick-off",
      folder_path: "Work/Clients",
    });
    expect(res.json).toMatchObject({ folder_path: "Work/Clients", enrichment: { ok: true } });
    expect(t.repo.items.get(res.json.id)?.cluster_name).toBe("General");
    await t.close();
  });

  it("brain_log_agent_memory stays in 40_AI_Memories with its cluster, gains tags and chunks", async () => {
    const { router, calls } = mockRouter();
    const t = await connect({ enricher: createAiCoreEnricher(router) });
    const res = await t.call("brain_log_agent_memory", {
      agent_name: "Claude Code",
      topic: "md-sync wiring",
      summary_md: "Wired md-sync into ai-core.",
      decisions: ["Never rewrite the body"],
    });
    expect(res.json).toMatchObject({
      folder_path: "40_AI_Memories",
      file: "40_AI_Memories/2026-10-23_md-sync-wiring.md",
      enrichment: { ok: true },
    });
    expect(res.json.tags).toEqual(
      expect.arrayContaining(["ai/agent-memory", "agent/claude-code", "kortex/md-sync"]),
    );
    const item = t.repo.items.get(res.json.id)!;
    expect(item.cluster_name).toBe("AI & Engineering");
    expect(
      t.repo.chunks.get(item.id)?.some((c) => c.chunk_text.includes("exponential backoff")),
    ).toBe(true);
    expect(calls.llm.takeaways).toBe(1); // ai-chat adapter handled it
    // Adapter facts that come back null (found live, N1 audit) keep the memory's own metadata.
    expect(item.metadata).toMatchObject({ agent_name: "Claude Code", topic: "md-sync wiring" });
    await t.close();
  });

  it("a failing organizer never loses the item", async () => {
    const broken: ItemEnricher = {
      enrich: async () => {
        throw new Error("OpenRouter 503");
      },
    };
    const t = await connect({ enricher: broken });
    const res = await t.call("brain_save_item", { title: "Still saved", content_md: "x" });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({
      folder_path: "00_Inbox",
      enrichment: { ok: false, status: "failed", error: "OpenRouter 503" },
    });
    expect(t.repo.items.size).toBe(1);
    await t.close();
  });
});
