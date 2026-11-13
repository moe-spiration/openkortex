import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../src/adapters";
import { JINA_READER_URL } from "../src/adapters/web-article.adapter";
import type { Enrichment } from "../src/enrichment/auto-organizer";
import { IngestionError } from "../src/errors";
import {
  createIngestionPipeline,
  ingest,
  slugify,
  type IngestContext,
  type IngestDeps,
} from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import { makePdf } from "./fixtures/make-pdf";
import { noRecipeHtml } from "./fixtures/recipe";
import { jinaResponse } from "./fixtures/web-article";
import {
  failingModel,
  fakeFetch,
  html,
  ITEM_ID,
  json,
  mockEmbeddingModel,
  mockModel,
  staticRouter,
  USER_ID,
  type RecordedRequest,
} from "./helpers";
import type { FetchLike } from "../src/http";
import type { ModelRouter } from "../src/router/model-router";

const enrichment: Enrichment = {
  title: "MCP für Second Brains",
  summary: "MCP öffnet Wissen für Agenten. Kortex nutzt es mit Supabase.",
  cluster_name: "AI & Engineering",
  suggested_folder_path: "30_Clippings/AI",
  tags: ["ai/mcp", "pkm/second-brain"],
  entities: [
    { name: "Supabase", type: "tool" },
    { name: "Anthropic", type: "organization" },
  ],
  action_items: [
    {
      title: "MCP-Server testen",
      description: "Mit Claude Desktop",
      assignee: "Me",
      priority: "medium",
      due_date: "2026-10-30",
      source_timestamp_sec: null,
    },
  ],
};

const context: IngestContext = {
  existingTags: ["ai/mcp"],
  existingClusters: ["AI & Engineering"],
  existingObjects: [
    { id: "33333333-3333-4333-8333-333333333333", title: "Supabase", type: "tool" },
  ],
  folders: [
    { id: "f-clip", folder_path: "30_Clippings" },
    { id: "f-docs", folder_path: "60_Documents" },
    { id: "f-auto", folder_path: "10_Notes/Automotive" },
  ],
};

const jinaFetch = () =>
  fakeFetch([
    { match: (u) => u.startsWith(JINA_READER_URL), respond: () => json(jinaResponse) },
    { match: (u) => u.includes("chefkoch.de"), respond: () => html(noRecipeHtml) },
  ]);

function setup(opts: { models?: ModelRouter; fetch?: FetchLike } = {}) {
  const storage = createMemoryStorageGateway();
  const models =
    opts.models ?? staticRouter({ fast: mockModel(enrichment), embedding: mockEmbeddingModel() });
  const registry = createDefaultRegistry({
    storage,
    models,
    fetch: opts.fetch ?? jinaFetch(),
    jinaApiKey: "jina_test",
  });
  const deps: IngestDeps = {
    registry,
    models,
    generateId: () => ITEM_ID,
    now: () => new Date("2026-10-23T08:00:00Z"),
  };
  return { storage, models, deps };
}

describe("ingest()", () => {
  it("returns DB-ready rows for a web article", async () => {
    const { deps } = setup();
    const url = "https://www.heise.de/hintergrund/mcp-erklaert-1234.html";
    const res = await ingest({ userId: USER_ID, url, manualTags: ["lesen"] }, context, deps);

    expect(res.adapterId).toBe("web-article");
    expect(res.warnings).toEqual([]);
    expect(res.item).toMatchObject({
      id: ITEM_ID,
      user_id: USER_ID,
      type: "article",
      source_platform: "web",
      title: "MCP für Second Brains",
      slug: "mcp-fuer-second-brains",
      summary: enrichment.summary,
      source_url: url,
      cover_image_url: "https://heise.cloudimg.io/mcp.jpg",
      icon: "newspaper",
      cluster_name: "AI & Engineering",
      folder_path: "30_Clippings/AI",
      folder_id: null,
      is_manual_placement: false,
      tags: ["lesen", "ai/mcp", "pkm/second-brain"],
      entities: ["Supabase", "Anthropic"],
      related_item_ids: ["33333333-3333-4333-8333-333333333333"],
      status: "processed",
      file_storage_path: null,
    });
    expect(res.item.content_md).toMatch(/## Verknüpft\n\n- \[\[Supabase\]\]\n$/);
    expect(res.item.metadata).toMatchObject({
      extractor: "jina",
      model_used: "mock/fast",
      ingest: {
        adapter: "web-article",
        ingested_at: "2026-10-23T08:00:00.000Z",
        embedding_model: "mock/embedding",
      },
    });
    expect(res.folderToCreate).toBe("30_Clippings/AI");
    expect(res.suggestedObjects).toEqual([{ name: "Anthropic", type: "organization" }]);
    expect(res.tags).toEqual(res.item.tags);

    expect(res.actionItems).toEqual([
      {
        user_id: USER_ID,
        source_item_id: ITEM_ID,
        title: "MCP-Server testen",
        description: "Mit Claude Desktop",
        assignee: "Me",
        priority: "medium",
        due_date: "2026-10-30",
        source_timestamp_sec: null,
        project_item_id: null,
        timeframe: null,
        context: null,
      },
    ]);

    expect(res.chunks.length).toBeGreaterThan(0);
    const chunk = res.chunks[0]!;
    expect(chunk).toMatchObject({ item_id: ITEM_ID, user_id: USER_ID, chunk_index: 0 });
    expect(chunk.chunk_text.startsWith("Dokument: MCP für Second Brains\nTyp: article")).toBe(true);
    expect(chunk.embedding).toMatch(/^\[\d+,0\.001,0\.001,/);
    expect(chunk.embedding?.split(",")).toHaveLength(1536);
    // Every embedded chunk names its model, so search only compares the same vector space.
    expect(chunk.metadata).toMatchObject({ embedding_model: "openrouter:mock/embedding" });
  });

  it("falls through declined and not-implemented adapters to the article adapter", async () => {
    const { deps } = setup();
    const recipe = await ingest(
      { userId: USER_ID, url: "https://www.chefkoch.de/magazin/artikel/123.html" },
      context,
      deps,
    );
    expect(recipe.adapterId).toBe("web-article");
    expect(recipe.skippedAdapters).toEqual([
      { id: "recipe", reason: expect.stringContaining("no schema.org Recipe") },
    ]);

    const tweet = await ingest(
      { userId: USER_ID, url: "https://x.com/kortex/status/1849000000000000000" },
      context,
      deps,
    );
    expect(tweet.adapterId).toBe("web-article");
    expect(tweet.skippedAdapters[0]?.id).toBe("x-twitter");
  });

  it("errors when only unbuilt adapters match", async () => {
    const { deps } = setup();
    const err = await ingest(
      { userId: USER_ID, fileBuffer: new Uint8Array([1]), fileName: "mail.eml" },
      context,
      deps,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestionError);
    expect((err as IngestionError).code).toBe("all_adapters_declined");
  });

  it("keeps a manual placement and resolves its folder path", async () => {
    const { deps } = setup();
    const res = await ingest(
      { userId: USER_ID, rawText: "Notiz zu AMG", targetFolderId: "f-auto" },
      context,
      deps,
    );
    expect(res.item).toMatchObject({
      folder_id: "f-auto",
      folder_path: "10_Notes/Automotive",
      is_manual_placement: true,
      type: "note",
    });
    expect(res.item.cluster_name).toBeUndefined(); // DB keeps its value/default
    expect(res.folderToCreate).toBeNull();

    await expect(
      ingest({ userId: USER_ID, rawText: "x", targetFolderId: "unknown" }, context, deps),
    ).rejects.toThrow(/unknown/);
  });

  it("stores uploaded files and links them on the item", async () => {
    const { deps, storage } = setup();
    const pdf = makePdf({ title: "Spec", pages: ["Seite eins", "Seite zwei"] });
    const res = await ingest(
      { userId: USER_ID, fileBuffer: pdf, fileName: "spec.pdf", mimeType: "application/pdf" },
      context,
      deps,
    );
    expect(res.adapterId).toBe("pdf-document");
    expect(storage.files.has(`kortex-documents/${USER_ID}/${ITEM_ID}.pdf`)).toBe(true);
    expect(res.item).toMatchObject({
      type: "pdf",
      icon: "file-text",
      file_storage_path: `${USER_ID}/${ITEM_ID}.pdf`,
      file_mime_type: "application/pdf",
      file_size_bytes: pdf.byteLength,
    });
    expect(res.chunks.map((c) => c.page_or_timestamp)).toEqual(["Page 1", "Page 2"]);
    expect(res.file?.bucket).toBe("kortex-documents");
  });

  it("degrades gracefully when the organizer or embeddings fail", async () => {
    const broken: ModelRouter = {
      ...staticRouter({ fast: failingModel("rate limited") }),
      embedding: () => mockEmbeddingModel(10),
    };
    const { deps } = setup({ models: broken });
    const res = await ingest(
      { userId: USER_ID, rawText: "# Einkauf\nMilch kaufen", manualTags: ["Privat"] },
      context,
      deps,
    );
    expect(res.item.status).toBe("inbox");
    expect(res.item.title).toBe("Einkauf");
    expect(res.item.tags).toEqual(["privat"]);
    expect(res.item.folder_path).toBe("10_Notes");
    expect(res.chunks.every((c) => c.embedding === null)).toBe(true);
    expect(res.warnings).toEqual([
      expect.stringContaining("rate limited"),
      expect.stringContaining("dimensions"),
    ]);
    expect(res.item.metadata).toMatchObject({
      model_used: null,
      ingest: { needs_enrichment: true, needs_embedding: true },
    });
  });

  it("validates input", async () => {
    const { deps } = setup();
    await expect(ingest({ userId: "", rawText: "x" }, context, deps)).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(ingest({ userId: USER_ID }, context, deps)).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      ingest(
        { userId: USER_ID, fileBuffer: new Uint8Array([0]), mimeType: "application/octet-stream" },
        context,
        deps,
      ),
    ).rejects.toMatchObject({ code: "no_adapter" });
  });

  it("slugifies German titles", () => {
    expect(slugify("Grüße aus Köln: Straße & Café!")).toBe("gruesse-aus-koeln-strasse-cafe");
  });
});

describe("createIngestionPipeline (real OpenRouter router, fake network)", () => {
  it("runs the whole pipeline and every OpenRouter request carries data_collection 'deny'", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.startsWith(JINA_READER_URL), respond: () => json(jinaResponse) },
      {
        match: (u) => u === "https://openrouter.ai/api/v1/chat/completions",
        respond: () =>
          json({
            id: "gen-1",
            object: "chat.completion",
            created: 1_760_000_000,
            model: "fx/organize",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(enrichment) },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }),
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
              embedding: new Array(1536).fill(0.01),
            })),
            usage: { prompt_tokens: 10, total_tokens: 10 },
          });
        },
      },
    ]);
    const pipeline = createIngestionPipeline({
      storage: createMemoryStorageGateway(),
      env: { OPENROUTER_API_KEY: "sk-or-test", JINA_API_KEY: "jina_test" },
      // ADR-06 routing (as stored in user_settings.ai_routing_config) with fixture models.
      routing: {
        auto_organize: { provider: "openrouter", model_id: "fx/organize" },
        embeddings: { provider: "openrouter", model_id: "fx/emb", dimensions: 1536 },
      },
      fetch,
    });
    const res = await pipeline.ingest(
      { userId: USER_ID, url: "https://www.heise.de/hintergrund/mcp-erklaert-1234.html" },
      context,
    );

    expect(res.item.title).toBe("MCP für Second Brains");
    expect(res.item.status).toBe("processed");
    expect(res.chunks.every((c) => c.embedding?.startsWith("[0.01,"))).toBe(true);

    const openrouterCalls = fetch.calls.filter((c: RecordedRequest) =>
      c.url.startsWith("https://openrouter.ai/"),
    );
    expect(openrouterCalls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/v1/chat/completions",
      "/api/v1/embeddings",
    ]);
    for (const call of openrouterCalls) {
      expect(
        (call.body as { provider?: { data_collection?: string } }).provider?.data_collection,
      ).toBe("deny");
    }
    expect((openrouterCalls[0]?.body as { model: string }).model).toBe("fx/organize");
  });

  it("refuses to build without OPENROUTER_API_KEY", () => {
    expect(() =>
      createIngestionPipeline({ storage: createMemoryStorageGateway(), env: {} }),
    ).toThrow(/OPENROUTER_API_KEY/);
  });
});
