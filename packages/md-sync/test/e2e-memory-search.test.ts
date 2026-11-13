import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createIngestionPipeline, createMemoryStorageGateway } from "@kortex/ai-core";
import type { KnowledgeItemType } from "@kortex/db";
import {
  createAiCoreEmbedder,
  createMcpServer,
  InMemoryBrainRepository,
  type BrainItem,
  type Embedder,
  type NewChunk,
} from "@kortex/mcp-server";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/frontmatter";
import { VaultIngestor } from "../src/ingest";
import type { SyncItem } from "../src/types";
import { bagOfWords, mockRouter } from "./ai-mocks";
import { createHarness, type Harness } from "./helpers";

/**
 * Offline end-to-end: an agent drops a memory file into the vault -> md-sync pushes it ->
 * the ai-core pipeline (ai-chat adapter, organizer, chunker, embeddings; mocked models)
 * enriches it -> item, chunks and tags land in the store -> brain_search over MCP, with the
 * ai-core embedder, finds it through the chunk vectors.
 */

let h: Harness;
let ingestor: VaultIngestor;
afterEach(async () => {
  await ingestor?.stop();
  await h?.cleanup();
});

const toBrainItem = (row: SyncItem & { summary?: string | null }): BrainItem => ({
  id: row.id,
  type: row.type as KnowledgeItemType,
  title: row.title,
  slug: row.slug,
  summary: row.summary ?? null,
  remind_at: row.remind_at ?? null,
  content_md: row.content_md,
  source_url: row.source_url,
  source_platform: row.source_platform,
  folder_path: row.folder_path,
  is_manual_placement: row.is_manual_placement ?? false,
  cluster_name: row.cluster_name ?? "General",
  tags: row.tags ?? [],
  metadata: (row.metadata ?? {}) as Record<string, unknown>,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

async function search(
  embedder: Embedder | undefined,
  repo: InMemoryBrainRepository,
  query: string,
) {
  const server = createMcpServer({ repo, embedder });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const res = (await client.callTool({
      name: "brain_search",
      arguments: { query },
    })) as CallToolResult;
    const block = res.content[0];
    expect(res.isError).not.toBe(true);
    return JSON.parse(block?.type === "text" ? block.text : "{}") as {
      mode: string;
      count: number;
      results: { item_id: string; title: string; snippet: string }[];
    };
  } finally {
    await client.close();
  }
}

describe("e2e: vault memory -> md-sync -> ai-core -> store -> brain_search", () => {
  it("finds a dropped agent memory by meaning", async () => {
    h = await createHarness();
    const { router, calls } = mockRouter();
    ingestor = new VaultIngestor({
      engine: h.engine,
      store: h.store,
      pipeline: createIngestionPipeline({ storage: createMemoryStorageGateway(), models: router }),
      debounceMs: 10,
    }).start();
    await h.engine.start();

    // 1. An agent writes a session memory (playbook 5.3 format) into the vault.
    const rel = "40_AI_Memories/2026-10-23_md-sync-wiring.md";
    await h.write(
      rel,
      [
        "---",
        'type: "ai_chat"',
        'cluster: "AI & Engineering"',
        "---",
        "# md-sync wiring",
        "",
        "We wired the vault daemon to the ingest pipeline.",
        "",
      ].join("\n"),
    );
    await h.engine.handleLocalFile(rel);
    for (let i = 0; i < 3; i++) {
      await h.settle();
      await ingestor.idle();
    }
    await h.settle();

    // 2. Item, chunks and tags exist; the vault file carries the enrichment.
    const row = h.store.itemByTitle("2026-10-23_md-sync-wiring");
    expect(row).toMatchObject({
      type: "ai_chat",
      status: "processed",
      folder_path: "40_AI_Memories",
    });
    const chunks = h.store.chunks.get(row!.id) ?? [];
    expect(chunks.length).toBeGreaterThan(0);
    expect(h.store.tags.has("kortex/md-sync")).toBe(true);
    expect(parseMarkdown(await h.read(rel)).data.tags).toEqual(
      expect.arrayContaining(["ai/agent-memory", "kortex/md-sync"]),
    );
    expect(calls.embed.texts).toBe(chunks.length);

    // 3. The same data, as the MCP server's repository sees it.
    const repo = new InMemoryBrainRepository();
    repo.importItem(
      toBrainItem(row!),
      chunks.map((c): NewChunk => ({
        chunk_index: c.chunk_index,
        chunk_heading: c.chunk_heading ?? null,
        page_or_timestamp: c.page_or_timestamp ?? null,
        chunk_text: c.chunk_text,
        embedding: JSON.parse(c.embedding as string) as number[],
      })),
    );
    const distractor = await repo.createItem({
      type: "recipe",
      title: "Pasta al limone",
      slug: "pasta-al-limone",
      content_md: "Lemon, butter, parmesan.",
      folder_path: "50_Recipes",
    });
    await repo.replaceChunks(distractor.id, [
      {
        chunk_index: 0,
        chunk_heading: null,
        page_or_timestamp: null,
        chunk_text: "Lemon, butter, parmesan.",
        embedding: bagOfWords("Lemon, butter, parmesan."),
      },
    ]);

    // 4. The words only occur in the AI takeaways (chunks), not in title/summary/body.
    const query = "exponential backoff when realtime outages happen";
    const hybrid = await search(createAiCoreEmbedder(router), repo, query);
    expect(hybrid.mode).toBe("hybrid");
    expect(hybrid.results[0]).toMatchObject({ item_id: row!.id });
    expect(hybrid.results[0]?.snippet).toContain("exponential backoff");

    // Without embeddings the memory is not found: the vector side did the work.
    const fulltext = await search(undefined, repo, query);
    expect(fulltext.mode).toBe("fulltext");
    expect(fulltext.results.map((r) => r.item_id)).not.toContain(row!.id);
  });
});
