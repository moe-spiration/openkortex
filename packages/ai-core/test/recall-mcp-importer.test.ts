import { dedupKeys, findDuplicateIn, type DedupItem } from "@kortex/db";
import { describe, expect, it } from "vitest";
import {
  parseRecallCard,
  recallContentPart,
  recallMcpImporter,
  recallTranscriptSegments,
  runImport,
  type ImportJob,
  type ImportStore,
} from "../src/importers";

const YT = "https://www.youtube.com/watch?v=6VTSAs4Rsck";
const stamp = (s: number) =>
  `[(00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")})](${YT}&t=${s})`;

const video = {
  id: "438367c3-a828-41ff-bd28-966b1aa4e4e0",
  title: "Mark Cuban: The Brutal Truth",
  text: `## Content\n\n## Intro\n\n${stamp(0)} AI is not smart. ${stamp(5)} keep on borrowing\nmore money ${stamp(12)} making.\n\n## Meine Erziehung\n\n${stamp(183)} What are the most foundational things?`,
  metadata: {
    source_url: YT,
    created_at: "2026-11-08T22:06:30.054000+00:00",
    tags: [{ name: "Business", path: "Business" }],
    image: "https://i.ytimg.com/vi/6VTSAs4Rsck/maxresdefault.jpg",
  },
};

const article = {
  id: "a839a6ad-e8f8-41bc-98d8-99d47dd91966",
  title: "Ein Artikel",
  text: `# Ein Artikel\n\nText über [AngelList](14455f4f-6f96-4b7b-8ea1-68b2f8309dca) und [Kortex](https://kortex.app).\n\n\n\n${"Mehr Inhalt. ".repeat(30)}`,
  metadata: { source_url: "https://example.org/artikel?utm_source=x", tags: ["Lifestyle"] },
};

const file = (c: { id: string }) => ({ file: `recall:${c.id}`, text: JSON.stringify(c) });

describe("Recall MCP card → item", () => {
  it("timestamped transcript becomes client segments; YouTube keeps its own adapter", () => {
    const segs = recallTranscriptSegments(recallContentPart(video.text));
    expect(segs).toEqual([
      { start: 0, text: "AI is not smart." },
      { start: 5, text: "keep on borrowing more money" },
      { start: 12, text: "making." },
      { start: 183, text: "What are the most foundational things?" },
    ]);
    const item = parseRecallCard(JSON.stringify(video), "recall:x");
    expect(item.type).toBe("video");
    expect(item.tags).toEqual([]);
    expect(item.prefetched?.transcript).toMatchObject({ source: "page" });
    expect(item.prefetched?.transcript?.segments).toHaveLength(4);
    expect(item.prefetched?.media).toBeUndefined();
    expect(item.prefetched?.imageUrl).toBe(video.metadata.image);
    expect(item.metadata.import).toMatchObject({
      source: "recall",
      card_id: video.id,
      via: "mcp",
      recall_tags: ["Business"],
    });
    expect(item.createdAt).toBe("2026-11-08T22:06:30.054000+00:00");
  });

  it("articles carry their saved text; Recall's card-id links become plain text", () => {
    const item = parseRecallCard(JSON.stringify(article), "recall:y");
    expect(item.type).toBe("article");
    expect(item.sourceUrl).toBe("https://example.org/artikel");
    const md = item.prefetched?.pageContent?.markdown ?? "";
    expect(md).toContain("Text über AngelList und [Kortex](https://kortex.app).");
    expect(md).not.toMatch(/\n{3,}/);
    expect(item.prefetched?.transcript).toBeUndefined();
  });

  it("other players get a media kind for the client-media / podcast adapters", () => {
    const pod = {
      ...video,
      id: "p1",
      metadata: { source_url: "https://open.spotify.com/episode/abc" },
      text: video.text.replaceAll(YT, "https://open.spotify.com/episode/abc"),
    };
    expect(parseRecallCard(JSON.stringify(pod), "recall:p").prefetched?.media).toEqual({
      kind: "podcast",
    });
  });

  it("format check and errors", () => {
    expect(recallMcpImporter.canHandle("recall:1", "{}")).toBe(true);
    expect(recallMcpImporter.canHandle("a.md", "{}")).toBe(false);
    expect(() => parseRecallCard("nope", "recall:1")).toThrow(/JSON expected/);
    expect(() => parseRecallCard("{}", "recall:1")).toThrow(/without id/);
  });
});

function memoryStore() {
  const items: (DedupItem & Record<string, unknown>)[] = [];
  const jobs: ImportJob[] = [];
  const store: ImportStore = {
    async findDuplicate(c, k) {
      const hit = findDuplicateIn(items, c, k);
      return hit ? { id: hit.item.id, reason: hit.reason } : null;
    },
    async insert(row, c) {
      const k = await dedupKeys(c);
      const hit = findDuplicateIn(items, c, k);
      if (hit) return { id: hit.item.id, duplicate: { id: hit.item.id, reason: hit.reason } };
      items.push({
        ...(row as unknown as DedupItem),
        source_url_norm: k.source_url_norm,
        content_hash: k.content_hash,
      });
      return { id: row.id as string, duplicate: null };
    },
    folderId: async (p) => `folder:${p}`,
    enqueue: async (job) => void jobs.push(job),
  };
  return { store, items, jobs };
}

describe("runImport with Recall MCP cards", () => {
  let n = 0;
  const opts = {
    importer: recallMcpImporter,
    platform: "recall",
    userId: "u1",
    uuid: () => `id-${++n}`,
  };

  it("queues the URL with the saved content; Kortex does title and tags; re-run adds nothing", async () => {
    const { store, items, jobs } = memoryStore();
    const r = await runImport([file(video), file(article)], store, { ...opts, apply: true });
    expect(r).toMatchObject({ created: 2, queued: 2, errors: 0 });
    expect(r.entries.every((e) => e.prefetched)).toBe(true);
    expect(
      items.every((i) => i.folder_path === "00_Inbox" && (i.tags as string[]).length === 0),
    ).toBe(true);
    const v = jobs.find((j) => j.input.url === YT)!;
    expect(v.input.transcript?.segments).toHaveLength(4);
    expect(v.options.keepTitle).toBeUndefined();
    const a = jobs.find((j) => j.input.url === "https://example.org/artikel")!;
    expect(a.input.pageContent?.markdown).toContain("Mehr Inhalt.");

    const again = await runImport([file(video), file(article)], store, { ...opts, apply: true });
    expect(again).toMatchObject({ created: 0, duplicates: 2, queued: 0 });
    expect(jobs).toHaveLength(2);
  });
});
