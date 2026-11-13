import { dedupKeys, findDuplicateIn, type DedupItem } from "@kortex/db";
import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_LIMIT,
  parseRecallDate,
  parseRecallMarkdown,
  recallImporter,
  resolveImportLimit,
  resolveImporter,
  runImport,
  importJobOf,
  type ImportJob,
  type ImportStore,
} from "../src/importers";

const VIDEO = `---
title: "AI Memory, Clearly \\"Explained\\""
tags:
  - "Knowledge Management"
createdAt: Wed Aug 12 2026 22:31:53 GMT+0200 (Mitteleuropäische Sommerzeit)
updatedAt: Wed Aug 12 2026 22:31:58 GMT+0200 (Mitteleuropäische Sommerzeit)
---




Concise summary


## Global Memory [(00:00:31)](https://www.youtube.com/watch?v=abc123&t=31s)
- Global memory holds account-level facts that apply across all chats [(00:00:31)](https://www.youtube.com/watch?v=abc123&t=31s).
- Tools like [[Google Drive]] add context but no session history.




## Sources
- [website](https://www.youtube.com/watch?v=abc123&utm_source=x)
`;

const ENTITY = `---\r\ntitle: "Anthropic"\r\ntags:\r\n  - "Organization/Corporation"\r\ncreatedAt: Sun Sep 20 2026 20:33:18 GMT+0200 (Mitteleuropäische Sommerzeit)\r\nupdatedAt: Sun Sep 20 2026 20:33:18 GMT+0200 (Mitteleuropäische Sommerzeit)\r\n---\r\n\r\n\r\n\r\n## Sources\r\n- [wikipedia_page](https://en.wikipedia.org/wiki/Anthropic)\r\n`;

const NOTE = `---
title: "Lieblingsbier"
tags:
createdAt: Mon Jan 05 2026 08:00:00 GMT+0100 (Mitteleuropäische Normalzeit)
updatedAt: Mon Jan 05 2026 08:00:00 GMT+0100 (Mitteleuropäische Normalzeit)
---
Lieblingsbier von Hendrik: ein helles Kellerbier aus Franken, am liebsten frisch vom Fass im Sommer.
`;

const WEB = (title: string, url: string) => `---
title: "${title}"
tags:
  - "Gesundheit"
createdAt: Sun May 24 2026 20:28:01 GMT+0200 (Mitteleuropäische Sommerzeit)
updatedAt: Sun May 24 2026 20:28:05 GMT+0200 (Mitteleuropäische Sommerzeit)
---

Concise summary

- Die Rezepte sind schnell und einfach zuzubereiten, ideal für Mittag- und Abendessen.

## Sources
- [website](${url})
- [homepage](https://example.org/)
`;

describe("Recall parser (frontmatter → item)", () => {
  it("maps title, tags, dates, source URL and type; content is clean Markdown", () => {
    const item = parseRecallMarkdown(VIDEO, "AI Memory, Clearly Explained.md");
    expect(item.title).toBe('AI Memory, Clearly "Explained"');
    expect(item.type).toBe("video");
    expect(item.tags).toEqual(["knowledge-management"]);
    expect(item.createdAt).toBe("2026-08-12T20:31:53.000Z");
    expect(item.updatedAt).toBe("2026-08-12T20:31:58.000Z");
    expect(item.sourceUrl).toBe("https://www.youtube.com/watch?v=abc123");
    expect(item.hasBody).toBe(true);
    expect(item.contentMd).not.toMatch(/Concise summary/);
    expect(item.contentMd).not.toMatch(/\n{3,}/);
    expect(item.contentMd).not.toMatch(/[ \t]+\n/);
    expect(item.contentMd.startsWith("## Global Memory")).toBe(true);
    expect(item.contentMd).toContain("[[Google Drive]]");
    expect(item.contentMd).toContain(
      "## Sources\n\n- [website](https://www.youtube.com/watch?v=abc123&utm_source=x)",
    );
    expect(item.metadata.import).toMatchObject({
      source: "recall",
      file: "AI Memory, Clearly Explained.md",
    });
  });

  it("entity cards (CRLF, only Sources) become registry objects", () => {
    const item = parseRecallMarkdown(ENTITY, "C:/x/Anthropic.md");
    expect(item.type).toBe("organization");
    expect(item.hasBody).toBe(false);
    expect(item.tags).toEqual(["organization/corporation"]);
    expect(item.sourceUrl).toBe("https://en.wikipedia.org/wiki/Anthropic");
    expect(item.contentMd).toBe(
      "## Sources\n\n- [wikipedia_page](https://en.wikipedia.org/wiki/Anthropic)\n",
    );
    expect(item.metadata.import.file).toBe("Anthropic.md");
  });

  it("files without sources are notes; empty tag list is fine", () => {
    const item = parseRecallMarkdown(NOTE, "Lieblingsbier.md");
    expect(item.type).toBe("note");
    expect(item.sourceUrl).toBeNull();
    expect(item.tags).toEqual([]);
    expect(item.createdAt).toBe("2026-01-05T07:00:00.000Z");
  });

  it("web summaries with several sources: first is source_url, all kept in metadata", () => {
    const item = parseRecallMarkdown(
      WEB("Low Carb", "https://www.example.de/rezepte/?a=1&b=2"),
      "x.md",
    );
    expect(item.type).toBe("article");
    expect(item.sourceUrl).toBe("https://www.example.de/rezepte/?a=1&b=2");
    expect((item.metadata.import as { sources?: unknown[] }).sources).toHaveLength(2);
  });

  it("dates: unreadable → null; format check rejects non-Recall files", () => {
    expect(parseRecallDate("garbage")).toBeNull();
    expect(parseRecallDate(undefined)).toBeNull();
    expect(recallImporter.canHandle("a.md", "# just markdown")).toBe(false);
    expect(resolveImporter("a.md", VIDEO)?.id).toBe("recall");
    expect(() => parseRecallMarkdown("no frontmatter", "a.md")).toThrow(/frontmatter/);
  });
});

describe("limit cap", () => {
  it("defaults to 10, caps at 20 unless --all", () => {
    expect(resolveImportLimit(undefined)).toBe(10);
    expect(resolveImportLimit(15)).toBe(15);
    expect(resolveImportLimit(IMPORT_MAX_LIMIT)).toBe(20);
    expect(() => resolveImportLimit(21)).toThrow(/cap of 20/);
    expect(() => resolveImportLimit(1114)).toThrow(/cap/);
    expect(() => resolveImportLimit(0)).toThrow(/positive/);
    expect(resolveImportLimit(1114, true)).toBe(1114);
  });
});

/** In-memory store over the real dedup matcher (@kortex/db findDuplicateIn + dedupKeys). */
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

const files = [
  { file: "AI Memory.md", text: VIDEO },
  { file: "Anthropic.md", text: ENTITY },
  { file: "Lieblingsbier.md", text: NOTE },
  { file: "Low Carb.md", text: WEB("Low Carb", "https://example.de/rezepte") },
  // Same URL as the one before (Recall's "-1" copies): a twin inside the same run.
  { file: "Low Carb-1.md", text: WEB("Low Carb (Kopie)", "https://www.example.de/rezepte/") },
  { file: "broken.md", text: "not a recall file" },
];

describe("runImport (dedup)", () => {
  let n = 0;
  const uuid = () => `id-${++n}`;
  const opts = { importer: recallImporter, userId: "u1", uuid };

  it("dry run plans without writing, spots twins and skips bare entity cards", async () => {
    const { store, items, jobs } = memoryStore();
    const r = await runImport(files, store, { ...opts, apply: false });
    expect(r).toMatchObject({
      mode: "dry-run",
      files: 6,
      created: 3,
      duplicates: 1,
      skipped: 1,
      errors: 1,
      // Re-crawl: the video and the web card by URL, the note with own text.
      queued: 3,
    });
    expect(r.entries[0]).toMatchObject({ action: "new", recrawl: true });
    expect(r.entries[1]).toMatchObject({ action: "skipped", reason: "object-reference" });
    expect(r.entries[2]?.recrawl).toBeUndefined();
    expect(r.entries[4]).toMatchObject({ action: "duplicate", reason: "batch" });
    expect(items).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });

  it("apply inserts once; Kortex sets title, tags and platform; a second run adds nothing", async () => {
    const { store, items, jobs } = memoryStore();
    const first = await runImport(files, store, { ...opts, apply: true });
    expect(first).toMatchObject({ mode: "apply", created: 3, skipped: 1, queued: 3 });
    expect(items).toHaveLength(3);
    // Crawled cards wait in the inbox without Recall's tags (kept in metadata.import).
    const video = items.find((i) => i.type === "video")!;
    expect(video).toMatchObject({ status: "inbox", folder_path: "00_Inbox", tags: [] });
    expect((video.metadata as { import: { recall_tags: string[] } }).import.recall_tags).toEqual([
      "Knowledge Management",
    ]);
    const byUrl = (u: string) => jobs.find((j) => j.input.url === u)!;
    const vjob = byUrl("https://www.youtube.com/watch?v=abc123");
    expect(vjob.input).toEqual({
      url: "https://www.youtube.com/watch?v=abc123",
      clientHint: { title: 'AI Memory, Clearly "Explained"' },
    });
    expect(vjob.options.keepTitle).toBeUndefined();
    expect(vjob.options.sourcePlatform).toBeUndefined();
    expect(vjob.options.fallbackText).toContain("## Global Memory");
    // Without a URL the note goes through as text, as before.
    const note = jobs.find((j) => j.input.title === "Lieblingsbier")!;
    expect(note.input).toMatchObject({
      typeHint: "note",
      rawText: expect.stringContaining("Kellerbier"),
    });
    expect(note.input.url).toBeUndefined();

    const dry = await runImport(files, store, { ...opts, apply: false });
    expect(dry).toMatchObject({ created: 0, duplicates: 4, skipped: 1, errors: 1 });
    const again = await runImport(files, store, { ...opts, apply: true });
    expect(again).toMatchObject({ created: 0, duplicates: 4, queued: 0 });
    expect(items).toHaveLength(3);
    expect(jobs).toHaveLength(3);
  });

  it("objects: entity cards are crawled and keep type and object folder", async () => {
    const { store, items, jobs } = memoryStore();
    await runImport(files.slice(1, 2), store, { ...opts, apply: true, objects: true });
    expect(items[0]).toMatchObject({
      type: "organization",
      status: "inbox",
      folder_path: "70_Objects/Organizations",
      created_at: "2026-09-20T18:33:18.000Z",
    });
    expect(jobs[0]?.input.url).toBe("https://en.wikipedia.org/wiki/Anthropic");
    expect(jobs[0]?.options).toMatchObject({ keepType: true });
  });

  it("recrawl off keeps the old behaviour: only cards with own text, as text", async () => {
    const { store, jobs } = memoryStore();
    const r = await runImport(files, store, {
      ...opts,
      apply: true,
      recrawl: false,
      objects: true,
    });
    expect(r.queued).toBe(3);
    expect(jobs.every((j) => !j.input.url && j.input.rawText)).toBe(true);
    expect(jobs.map((j) => j.input.typeHint).sort()).toEqual(["article", "note", "video"]);
  });

  it("typed cards keep their type hint when crawled", () => {
    const book = { ...parseRecallMarkdown(ENTITY, "x.md"), type: "book" as const };
    const job = importJobOf(book, "id", "recall", true);
    expect(job.input).toMatchObject({
      url: "https://en.wikipedia.org/wiki/Anthropic",
      typeHint: "book",
    });
    expect(job.options.keepType).toBeUndefined();
  });

  it("ai none queues nothing and files every item in its type folder", async () => {
    const { store, items, jobs } = memoryStore();
    await runImport(files.slice(0, 3), store, {
      ...opts,
      apply: true,
      ai: "none",
      objects: true,
    });
    expect(jobs).toHaveLength(0);
    expect(items.map((i) => i.folder_path).sort()).toEqual([
      "10_Notes",
      "30_Clippings",
      "70_Objects/Organizations",
    ]);
  });
});
