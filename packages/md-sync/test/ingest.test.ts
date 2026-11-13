import { createIngestionPipeline, createMemoryStorageGateway } from "@kortex/ai-core";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/frontmatter";
import { exists } from "../src/fs-utils";
import { VaultIngestor, contentChecksum, type IngestPipelinePort } from "../src/ingest";
import { mockRouter } from "./ai-mocks";
import { createHarness, type Harness } from "./helpers";

let h: Harness;
let ingestor: VaultIngestor;
afterEach(async () => {
  await ingestor?.stop();
  await h?.cleanup();
});

const MEMORY = [
  "---",
  'type: "ai_chat"',
  'cluster: "AI & Engineering"',
  "---",
  "# md-sync wiring",
  "",
  "We wired the vault daemon to the ingest pipeline.",
  "",
].join("\n");

async function setup(
  opts: {
    folders?: string[];
    pipeline?: IngestPipelinePort;
    router?: ReturnType<typeof mockRouter>;
    maxAttempts?: number;
  } = {},
) {
  h = await createHarness();
  const mock = opts.router ?? mockRouter();
  const pipeline =
    opts.pipeline ??
    createIngestionPipeline({ storage: createMemoryStorageGateway(), models: mock.router });
  ingestor = new VaultIngestor({
    engine: h.engine,
    store: h.store,
    pipeline,
    folders: opts.folders,
    debounceMs: 10,
    retryDelayMs: 10,
    maxAttempts: opts.maxAttempts,
  }).start();
  await h.engine.start();
  await h.settle();
  return mock;
}

async function settleAll() {
  for (let i = 0; i < 3; i++) {
    await h.settle();
    await ingestor.idle();
  }
  await h.settle();
}

async function addLocal(rel: string, text: string) {
  await h.write(rel, text);
  await h.engine.handleLocalFile(rel);
  await settleAll();
}

describe("vault ingest (md-sync -> ai-core)", () => {
  it("enriches a new agent memory: summary, tags, entities, chunks with embeddings", async () => {
    const mock = await setup();
    await addLocal("40_AI_Memories/2026-10-23_md-sync-wiring.md", MEMORY);
    const item = h.store.itemByTitle("2026-10-23_md-sync-wiring");
    expect(item).toBeDefined();
    const id = item!.id;
    expect(item).toMatchObject({
      status: "processed",
      summary: "Session notes about the vault daemon.",
      entities: ["Supabase"],
      type: "ai_chat",
    });
    expect(item?.tags).toEqual(expect.arrayContaining(["ai/agent-memory", "kortex/md-sync"]));
    const meta = item?.metadata as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(meta.ai_title).toBe("Sync daemon wiring");
    expect(meta.takeaways).toHaveLength(2);
    expect(meta.ingest).toMatchObject({
      source: "md-sync",
      state: "done",
      content_checksum: contentChecksum(item!.content_md),
    });

    const chunks = h.store.chunks.get(id) ?? [];
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.item_id).toBe(id);
      expect(JSON.parse(c.embedding as string)).toHaveLength(1536);
    }
    expect(chunks.some((c) => c.chunk_text.includes("exponential backoff"))).toBe(true);
    expect([...h.store.tags.keys()]).toEqual(expect.arrayContaining(["kortex/md-sync"]));
    // Agent memories don't create tasks.
    expect(h.store.actionItems).toHaveLength(0);
    expect(mock.calls.llm).toEqual({ organizer: 1, takeaways: 1 });
  });

  it("keeps frontmatter metadata the adapter returns as null (agent_name, found live in N1)", async () => {
    await setup();
    const withAgent = MEMORY.replace('type: "ai_chat"', 'type: "ai_chat"\nmetadata:\n  agent_name: Codex');
    await addLocal("40_AI_Memories/2026-10-25_agent-drop.md", withAgent);
    const meta = h.store.itemByTitle("2026-10-25_agent-drop")?.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ agent_name: "Codex", ingest: { state: "done" } });
  });

  it("respects manual placement and keeps the file's title and body", async () => {
    await setup();
    await addLocal("40_AI_Memories/2026-10-23_md-sync-wiring.md", MEMORY);
    const item = h.store.itemByTitle("2026-10-23_md-sync-wiring");
    // Created outside the inbox = manual placement: organizer's folder/cluster are ignored.
    expect(item).toMatchObject({
      is_manual_placement: true,
      folder_path: "40_AI_Memories",
      cluster_name: "AI & Engineering",
      slug: "2026-10-23_md-sync-wiring",
    });
    expect(item?.content_md).toBe(
      "# md-sync wiring\n\nWe wired the vault daemon to the ingest pipeline.",
    );

    // The enrichment came back into the file; file checksum == DB local_file_hash.
    const text = await h.read("40_AI_Memories/2026-10-23_md-sync-wiring.md");
    const parsed = parseMarkdown(text);
    expect(parsed.data.tags).toEqual(expect.arrayContaining(["kortex/md-sync"]));
    expect(parsed.data.status).toBe("processed");
    expect(parsed.data.checksum).toBe(item?.local_file_hash);
    expect(parsed.body).toBe(item?.content_md);
  });

  it("is idempotent: no re-run for echoes or frontmatter edits, re-run for body edits", async () => {
    const mock = await setup();
    const rel = "40_AI_Memories/2026-10-23_md-sync-wiring.md";
    await addLocal(rel, MEMORY);
    expect(mock.calls.llm.organizer).toBe(1);

    // The engine's own pull of the enriched row, seen again by the watcher.
    await h.engine.handleLocalFile(rel);
    await settleAll();
    expect(mock.calls.llm.organizer).toBe(1);

    // Frontmatter-only edit: synced, not re-enriched.
    await addLocal(
      rel,
      (await h.read(rel)).replace("cluster: AI & Engineering", "cluster: Agents"),
    );
    expect(h.store.itemByTitle("2026-10-23_md-sync-wiring")?.cluster_name).toBe("Agents");
    expect(mock.calls.llm.organizer).toBe(1);

    // Body edit: re-enriched once.
    await addLocal(
      rel,
      (await h.read(rel)).replace("ingest pipeline.", "ingest pipeline. Added retries."),
    );
    expect(mock.calls.llm.organizer).toBe(2);
    expect(h.store.calls.applyEnrichment).toBe(2);
  });

  it("files inbox captures where the organizer suggests and persists their tasks", async () => {
    const mock = mockRouter({
      enrichment: {
        action_items: [
          {
            title: "Write the README",
            description: null,
            assignee: "Me",
            priority: "high",
            due_date: null,
            source_timestamp_sec: null,
          },
        ],
      },
    });
    await setup({ folders: ["40_AI_Memories", "00_Inbox"], router: mock });
    await addLocal("00_Inbox/quick idea.md", "Wire md-sync into ai-core.\n");
    const item = h.store.itemByTitle("quick idea");
    expect(item).toMatchObject({
      is_manual_placement: false,
      folder_path: "10_Notes/Engineering",
      cluster_name: "Engineering",
      status: "processed",
    });
    expect(h.store.folderByPath("10_Notes/Engineering")).toBeDefined();
    expect(item?.folder_id).toBe(h.store.folderByPath("10_Notes/Engineering")?.id);
    // The engine moved the file to the new folder.
    expect(await exists(h.abs("00_Inbox/quick idea.md"))).toBe(false);
    expect((await h.readData("10_Notes/Engineering/quick idea.md")).id).toBe(item?.id);
    expect(h.store.actionItems).toMatchObject([
      { title: "Write the README", source_item_id: item?.id },
    ]);
    // Moved out of scope: later edits are not re-enriched.
    await addLocal(
      "10_Notes/Engineering/quick idea.md",
      (await h.read("10_Notes/Engineering/quick idea.md")).replace("ai-core.", "ai-core. Done."),
    );
    expect(mock.calls.llm.organizer).toBe(1);
  });

  it("ignores files outside the configured folders", async () => {
    const mock = await setup();
    await addLocal("10_Notes/plain.md", "Just a note\n");
    expect(h.store.itemByTitle("plain")?.status).toBe("inbox");
    expect(mock.calls.llm.organizer).toBe(0);
  });

  it("does not overwrite a newer edit that arrived while enriching (compare-and-set)", async () => {
    const real = createIngestionPipeline({
      storage: createMemoryStorageGateway(),
      models: mockRouter().router,
    });
    const racing: IngestPipelinePort = {
      async ingest(input, ctx) {
        const result = await real.ingest(input, ctx);
        // Meanwhile the user saved again (a new push changes local_file_hash).
        const row = h.store.items.get(input.itemId as string);
        if (row) row.local_file_hash = "sha256:newer-edit";
        return result;
      },
    };
    await setup({ pipeline: racing });
    const skipped: string[] = [];
    ingestor.on("ingest-skipped", (e) => skipped.push(e.reason));
    await addLocal("40_AI_Memories/race.md", MEMORY);
    const item = h.store.itemByTitle("race");
    expect(item?.status).toBe("inbox");
    expect(h.store.chunks.has(item!.id)).toBe(false);
    expect(skipped.some((r) => r.includes("changed while enriching"))).toBe(true);
  });

  it("retries failures, then marks the item as error; backfill retries it later", async () => {
    let calls = 0;
    const failing: IngestPipelinePort = {
      ingest: async () => {
        calls++;
        throw new Error("OpenRouter 503");
      },
    };
    await setup({ pipeline: failing, maxAttempts: 2 });
    const failures: boolean[] = [];
    ingestor.on("ingest-failed", (e) => failures.push(e.willRetry));
    await addLocal("40_AI_Memories/flaky.md", MEMORY);
    expect(calls).toBe(2);
    expect(failures).toEqual([true, false]);
    const failed = h.store.itemByTitle("flaky");
    expect(failed?.status).toBe("error");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((failed?.metadata as Record<string, any>).ingest).toMatchObject({
      state: "error",
      error: "OpenRouter 503",
    });

    // Next daemon run with a working pipeline.
    await ingestor.stop();
    ingestor = new VaultIngestor({
      engine: h.engine,
      store: h.store,
      pipeline: createIngestionPipeline({
        storage: createMemoryStorageGateway(),
        models: mockRouter().router,
      }),
      debounceMs: 10,
    }).start();
    expect(await ingestor.backfill()).toBe(1);
    await settleAll();
    expect(h.store.itemByTitle("flaky")?.status).toBe("processed");
  });

  it("keeps a degraded result (organizer down) and retries it on backfill", async () => {
    await setup({ router: mockRouter({ failOrganizer: true }) });
    await addLocal("40_AI_Memories/degraded.md", MEMORY);
    const item = h.store.itemByTitle("degraded");
    expect(item?.status).toBe("inbox");
    expect((item?.metadata as Record<string, any>).ingest.state).toBe("degraded"); // eslint-disable-line @typescript-eslint/no-explicit-any
    // Chunks + embeddings are still stored for search.
    expect(h.store.chunks.get(item!.id)?.length).toBeGreaterThan(0);
    expect(await ingestor.backfill()).toBe(1);
  });
});
