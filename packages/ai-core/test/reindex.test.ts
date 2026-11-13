import { describe, expect, it } from "vitest";
import { DEFAULT_FOLDER_BY_TYPE, matchKey, type Json } from "@kortex/db";
import type { ItemChunkInsert } from "../src/pipeline/ingest";
import {
  mentionedNames,
  renameWikiLinks,
  isRateLimit,
  isToolCandidate,
  linkedSectionTitles,
  planLinks,
  rewriteLinkedSection,
  runReindex,
  type ChunkRef,
  type ReindexItem,
  type ReindexStore,
} from "../src/reindex";
import { mockEmbeddingModel } from "./helpers";

const LOCK = "openrouter:fx/emb";
const recall = (tags: string[] = []) =>
  ({ import: { source: "recall", recall_tags: tags } }) as unknown as Json;

const item = (p: Partial<ReindexItem> & { id: string }): ReindexItem => ({
  type: "article",
  title: p.id,
  content_md: `Text ${p.id}\n`,
  entities: [],
  related_item_ids: [],
  metadata: recall(),
  status: "processed",
  source_url: null,
  is_manual_placement: false,
  folder_path: "30_Clippings",
  ...p,
});

function memoryStore(items: ReindexItem[], chunks: ChunkRef[] = []) {
  const writes: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserted: ItemChunkInsert[] = [];
  const store: ReindexStore = {
    listItems: async () => items.map((i) => structuredClone(i)),
    listChunks: async () => chunks.map((c) => structuredClone(c)),
    embeddingKey: async () => LOCK,
    folderId: async (p) => `folder:${p}`,
    async updateItem(id, patch) {
      writes.push({ id, patch });
      Object.assign(
        items.find((i) => i.id === id)!,
        patch,
      );
    },
    async saveVectors(rows) {
      for (const r of rows)
        Object.assign(
          chunks.find((c) => c.id === r.id)!,
          { metadata: r.metadata },
        );
    },
    async insertChunks(rows) {
      inserted.push(...rows);
    },
  };
  return { store, writes, inserted, items, chunks };
}

describe("rewriteLinkedSection", () => {
  it("appends the section when missing", () => {
    expect(rewriteLinkedSection("Body\n", ["Supabase"])).toBe(
      "Body\n\n## Verknüpft\n\n- [[Supabase]]\n",
    );
  });

  it("replaces an existing section and keeps the next one", () => {
    const md = "Body\n\n## Verknüpft\n\n- [[A]]\n\n## Erwähnt\n\n- [[B]] (Tool)\n";
    const out = rewriteLinkedSection(md, ["A", "Supabase"]);
    expect(linkedSectionTitles(out)).toEqual(["A", "Supabase"]);
    expect(out).toContain("## Erwähnt\n\n- [[B]] (Tool)");
    expect(out.match(/## Verknüpft/g)).toHaveLength(1);
  });
});

describe("planLinks", () => {
  const objects = [
    { id: "o1", title: "Supabase" },
    { id: "o2", title: "Trigger.dev" },
  ];

  it("links entity names to objects by title, only additions", () => {
    const plans = planLinks(
      [
        item({ id: "a", entities: ["supabase", "Postgres"], related_item_ids: ["x"] }),
        item({ id: "b", entities: ["Supabase"], related_item_ids: ["o1"] }),
      ],
      objects,
    );
    expect(plans).toEqual([
      {
        itemId: "a",
        add: ["o1"],
        related: ["x", "o1"],
        linkedTitles: ["Supabase"],
        selfLink: false,
      },
    ]);
  });

  it("drops a stored self-link", () => {
    expect(
      planLinks([item({ id: "o1", type: "tool", related_item_ids: ["o1", "o2"] })], objects),
    ).toMatchObject([{ itemId: "o1", add: [], related: ["o2"], selfLink: true }]);
  });

  it("never links an object to itself", () => {
    expect(
      planLinks(
        [item({ id: "o1", type: "tool", title: "Supabase", entities: ["Supabase"] })],
        objects,
      ),
    ).toEqual([]);
  });
});

describe("isToolCandidate", () => {
  it("only Recall tools from a software tag, once", () => {
    expect(
      isToolCandidate(item({ id: "t", type: "tool", metadata: recall(["Business Software"]) })),
    ).toBe(true);
    expect(isToolCandidate(item({ id: "t", type: "tool", metadata: recall([]) }))).toBe(false);
    expect(
      isToolCandidate(item({ id: "t", type: "article", metadata: recall(["Business Software"]) })),
    ).toBe(false);
    const done = {
      import: { source: "recall", recall_tags: ["Business Software"] },
      reindex: {},
    } as unknown as Json;
    expect(isToolCandidate(item({ id: "t", type: "tool", metadata: done }))).toBe(false);
  });
});

describe("runReindex", () => {
  const setup = () =>
    memoryStore(
      [
        item({
          id: "t1",
          type: "tool",
          title: "Supabase: Postgres-Plattform",
          metadata: recall(["Business Software"]),
          folder_path: "70_Objects/Tools",
        }),
        item({
          id: "t2",
          type: "tool",
          title: "ALOGIC Monitor 4K",
          metadata: recall(["Business Software"]),
          folder_path: "70_Objects/Tools",
        }),
        item({
          id: "t3",
          type: "tool",
          title: "Vercel: Cloud für KI",
          metadata: recall(["Business Software"]),
          folder_path: "70_Objects/Tools",
        }),
        item({
          id: "own",
          type: "tool",
          title: "Vercel",
          metadata: null,
          folder_path: "70_Objects/Tools",
        }),
        item({ id: "a1", entities: ["Supabase", "Vercel"] }),
        item({ id: "old", entities: ["Supabase"], metadata: null }),
        item({ id: "e1", status: "error" }),
      ],
      [
        { id: "c1", item_id: "a1", chunk_text: "a1", metadata: { embedding_model: LOCK } },
        { id: "c2", item_id: "t1", chunk_text: "t1", metadata: { token_estimate: 2 } },
      ],
    );

  const classify = async (i: ReindexItem) =>
    i.id === "t2"
      ? { kind: "product" as const, name: null }
      : { kind: "tool" as const, name: i.title.split(":")[0]! };

  it("dry run counts and writes nothing", async () => {
    const db = setup();
    const r = await runReindex({ store: db.store, userId: "u" });
    expect(db.writes).toEqual([]);
    expect(r.items).toBe(5);
    expect(r.notProcessed.map((n) => n.id)).toEqual(["e1"]);
    expect(r.tools.candidates).toBe(3);
    expect(r.embeddings).toMatchObject({ itemsWithoutChunks: 2, chunksWithoutVector: 1 });
  });

  it("checks tools, relinks and embeds", async () => {
    const db = setup();
    const r = await runReindex({
      store: db.store,
      userId: "u",
      dryRun: false,
      classify,
      models: { embedding: () => mockEmbeddingModel() },
      sleep: async () => {},
    });
    // Real tool gets its short name, the old title stays in metadata.
    const t1 = db.items.find((i) => i.id === "t1")!;
    expect(t1).toMatchObject({ type: "tool", title: "Supabase" });
    expect(t1.metadata).toMatchObject({
      reindex: { from_type: "tool", from_title: "Supabase: Postgres-Plattform" },
    });
    // Hardware → product in its folder.
    expect(db.items.find((i) => i.id === "t2")).toMatchObject({
      type: "product",
      folder_path: DEFAULT_FOLDER_BY_TYPE.product,
      folder_id: `folder:${DEFAULT_FOLDER_BY_TYPE.product}`,
    });
    // Name taken by the user's own "Vercel" → article, linked instead of a second object.
    expect(r.tools.collisions).toEqual([
      { id: "t3", title: "Vercel: Cloud für KI", existing: "Vercel" },
    ]);
    expect(db.items.find((i) => i.id === "t3")!.type).toBe("article");
    // a1 now links both; only Recall items are touched in scope "recall".
    const a1 = db.items.find((i) => i.id === "a1")!;
    expect(a1.related_item_ids).toEqual(["t1", "own"]);
    expect(linkedSectionTitles(a1.content_md)).toEqual(["Supabase", "Vercel"]);
    expect(db.items.find((i) => i.id === "old")!.related_item_ids).toEqual([]);
    // c2 re-embedded, items without chunks chunked.
    expect(db.chunks.find((c) => c.id === "c2")!.metadata).toMatchObject({ embedding_model: LOCK });
    expect(r.embeddings.reembedded).toBe(1);
    expect(new Set(db.inserted.map((c) => c.item_id))).toEqual(new Set(["t2", "t3"]));
    expect(
      db.inserted.every(
        (c) => (c.metadata as { embedding_model: string }).embedding_model === LOCK,
      ),
    ).toBe(true);
  });

  it("scope all relinks every item", async () => {
    const db = setup();
    await runReindex({
      store: db.store,
      userId: "u",
      scope: "all",
      dryRun: false,
      classify,
      passes: { embeddings: false },
    });
    expect(db.items.find((i) => i.id === "old")!.related_item_ids).toEqual(["t1"]);
  });

  it("waits and retries when the embedding provider rate-limits", async () => {
    const db = memoryStore(
      [item({ id: "a" })],
      Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        item_id: "a",
        chunk_text: `t${i}`,
        metadata: {},
      })),
    );
    const inner = mockEmbeddingModel();
    let calls = 0;
    const flaky = {
      ...inner,
      specificationVersion: inner.specificationVersion,
      provider: inner.provider,
      modelId: inner.modelId,
      maxEmbeddingsPerCall: inner.maxEmbeddingsPerCall,
      supportsParallelCalls: inner.supportsParallelCalls,
      doEmbed: async (o: Parameters<typeof inner.doEmbed>[0]) => {
        calls++;
        if (calls === 1)
          throw Object.assign(new Error("You exceeded your tokens quota"), { statusCode: 429 });
        return inner.doEmbed(o);
      },
    };
    const waits: number[] = [];
    const r = await runReindex({
      store: db.store,
      userId: "u",
      dryRun: false,
      passes: { tools: false, links: false },
      models: { embedding: () => flaky as typeof inner },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(r.embeddings.reembedded).toBe(20);
    expect(waits[0]).toBe(5000);
    expect(
      db.chunks.every((c) => (c.metadata as { embedding_model?: string }).embedding_model === LOCK),
    ).toBe(true);
  });
});

describe("isRateLimit", () => {
  it("spots 429s, also wrapped in a retry error", () => {
    expect(isRateLimit({ statusCode: 429 })).toBe(true);
    expect(
      isRateLimit({ message: "Failed after 3 attempts", lastError: { statusCode: 429 } }),
    ).toBe(true);
    expect(isRateLimit(new Error("HTTP 429: tokens quota"))).toBe(true);
    expect(isRateLimit(new Error("bad request"))).toBe(false);
  });
});

describe("mentioned names and renamed links", () => {
  const md = [
    "Intro [[Supabase: Postgres-Plattform|Supabase]] und [[Expo Go]].",
    "",
    "## Verknüpft",
    "",
    "- [[Supabase: Postgres-Plattform]]",
    "",
    "## Erwähnte Ressourcen",
    "",
    "- RevenueCat",
    "- Claude Code",
    "",
    "> [!toggle]- Transkript",
    "> - not a resource",
  ].join("\n");

  it("reads wiki-link targets and resource bullets", () => {
    expect(mentionedNames(md)).toEqual([
      "Supabase: Postgres-Plattform",
      "Expo Go",
      "Supabase: Postgres-Plattform",
      "RevenueCat",
      "Claude Code",
    ]);
  });

  it("points old titles at the new name, keeping aliases", () => {
    const out = renameWikiLinks(
      md,
      new Map([[matchKey("Supabase: Postgres-Plattform"), "Supabase"]]),
    );
    expect(out).toContain("[[Supabase|Supabase]]");
    expect(out).toContain("- [[Supabase]]");
    expect(out).toContain("[[Expo Go]]");
  });

  it("repairs links to renamed tools in every item and links resource mentions", async () => {
    const db = memoryStore([
      item({
        id: "t1",
        type: "tool",
        title: "Supabase",
        metadata: {
          import: { source: "recall" },
          reindex: { from_title: "Supabase: Postgres-Plattform" },
        } as unknown as Json,
      }),
      item({ id: "rc", type: "tool", title: "RevenueCat", metadata: null }),
      item({ id: "v", type: "video", content_md: md, related_item_ids: ["t1"] }),
      item({ id: "own", metadata: null, content_md: "Siehe [[Supabase: Postgres-Plattform]]\n" }),
    ]);
    const r = await runReindex({
      store: db.store,
      userId: "u",
      dryRun: false,
      passes: { tools: false, embeddings: false },
    });
    expect(r.links).toMatchObject({ repaired: 2, added: 1 });
    expect(db.items.find((i) => i.id === "own")!.content_md).toBe("Siehe [[Supabase]]\n");
    const v = db.items.find((i) => i.id === "v")!;
    expect(v.related_item_ids).toEqual(["t1", "rc"]);
    expect(linkedSectionTitles(v.content_md)).toEqual(["Supabase", "RevenueCat"]);
  });
});

describe("self-links and merges", () => {
  it("drops the item's own title from its Verknüpft section", () => {
    const own = item({
      id: "h",
      type: "tool",
      title: "Higgsfield AI",
      content_md: "Body\n\n## Verknüpft\n\n- [[Higgsfield AI]]\n",
    });
    const [plan] = planLinks([own], [{ id: "h", title: "Higgsfield AI" }]);
    expect(plan).toMatchObject({ selfLink: true, linkedTitles: [] });
    expect(rewriteLinkedSection(own.content_md, [])).toBe("Body\n");
  });

  it("sees a self-link written with an alias", () => {
    const own = item({
      id: "z",
      type: "tool",
      title: "Zite",
      content_md: "Body\n\n## Verknüpft\n\n- [[Zite | Build software with no-code]]\n- [[Neon]]\n",
    });
    const [plan] = planLinks([own], [{ id: "n", title: "Neon" }]);
    expect(plan).toMatchObject({ selfLink: true, linkedTitles: ["Neon"] });
  });
});
