import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contentHash,
  dedupKeys,
  EXTERNAL_ID_KEYS,
  externalIds,
  externalIdTokens,
  fileHash,
  findDuplicateIn,
  findOpenTaskIn,
  normalizeExternalId,
  pgTextArray,
  isSourceUrlConflict,
  normalizeUrl,
  planMerge,
  planTaskSync,
  snapTags,
  urlKey,
  type DedupItem,
} from "./dedup";

const item = (over: Partial<DedupItem>): DedupItem => ({
  id: "a",
  type: "note",
  title: "T",
  summary: null,
  content_md: "",
  source_url: null,
  source_url_norm: null,
  content_hash: null,
  folder_path: "00_Inbox",
  folder_id: null,
  is_manual_placement: false,
  tags: [],
  metadata: {},
  status: "inbox",
  ...over,
});

describe("url normalisation", () => {
  it("keeps the stored source_url form (no fragment, no tracking)", () => {
    expect(normalizeUrl("https://x.de/a?utm_source=y&b=1#top")).toBe("https://x.de/a?b=1");
  });

  it("folds scheme, www, trailing slash, param order and YouTube short forms", () => {
    expect(urlKey("http://www.Example.com/post/?b=2&a=1&fbclid=z")).toBe(
      "example.com/post?a=1&b=2",
    );
    expect(urlKey("https://youtu.be/abc123?si=x")).toBe("youtube.com/watch?v=abc123");
    expect(urlKey("https://m.youtube.com/shorts/abc123")).toBe("youtube.com/watch?v=abc123");
    expect(urlKey("https://example.com/")).toBe("example.com");
    expect(urlKey("mailto:a@b.c")).toBeNull();
    expect(urlKey("not a url")).toBeNull();
  });
});

describe("hashes and ids", () => {
  it("hashes normalised text, never short snippets", async () => {
    const long = "Ein ausreichend langer Text für den Content-Hash. ".repeat(3);
    expect(await contentHash(long)).toBe(await contentHash(`  ${long.toUpperCase()} \n`));
    expect(await contentHash("ok")).toBeNull();
    expect(await fileHash(new Uint8Array([1, 2]))).toMatch(/^file:[0-9a-f]{64}$/);
  });

  it("reads external ids from the registry (isbn, imdb_id)", () => {
    expect(externalIds("book", { isbn: "978-0-441-01359-3" })).toEqual([
      { key: "isbn", value: "9780441013593" },
    ]);
    expect(externalIds("movie", { imdb_id: "TT0087182" })).toEqual([
      { key: "imdb_id", value: "tt0087182" },
    ]);
    expect(externalIds("note", { isbn: "1" })).toEqual([]);
  });

  it("normalises external ids to one exact form (hyphens, spaces, case)", () => {
    expect(normalizeExternalId(" 978-3-16 148410-0 ")).toBe("9783161484100");
    expect(normalizeExternalId("<CAF+fwd-001@mail.gmail.com>")).toBe("<caf+fwd001@mail.gmail.com>");
    expect(normalizeExternalId(9783161484100)).toBe("9783161484100");
    expect(normalizeExternalId(" - ")).toBeNull();
    expect(normalizeExternalId(null)).toBeNull();
    expect(externalIdTokens({ isbn: "978-3-16-148410-0", message_id: "<A_b%@x>", other: "1" }).sort()).toEqual([
      "isbn:9783161484100",
      "message_id:<a_b%@x>",
    ]);
  });

  it("quotes array literals for the containment filter", () => {
    expect(pgTextArray(['message_id:<a"b\\c,{d}@x>'])).toBe('{"message_id:<a\\"b\\\\c,{d}@x>"}');
  });

  it("the external_ids migration covers every registry idKey", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/20261101210000_external_ids.sql", import.meta.url),
      "utf8",
    );
    expect(EXTERNAL_ID_KEYS).toEqual(expect.arrayContaining(["isbn", "imdb_id", "message_id"]));
    for (const key of EXTERNAL_ID_KEYS) {
      expect(sql, key).toContain(`'${key}:' ||`);
      expect(sql, key).toContain(`metadata ->> '${key}'`);
    }
  });
});

describe("findDuplicateIn", () => {
  it("checks the stages in order: url, external id, content hash, title", async () => {
    const c = {
      type: "book",
      title: "Dune",
      sourceUrl: "https://www.x.de/dune",
      metadata: { isbn: "123" },
    };
    const k = await dedupKeys(c);
    const byTitle = item({ id: "t", type: "book", title: "DUNE" });
    const byIsbn = item({ id: "i", type: "book", title: "Other", metadata: { isbn: "1-2-3" } });
    const byUrl = item({ id: "u", type: "bookmark", source_url: "https://x.de/dune/" });
    expect(findDuplicateIn([byTitle, byIsbn, byUrl], c, k)).toMatchObject({
      item: { id: "u" },
      reason: "source_url",
    });
    expect(findDuplicateIn([byTitle, byIsbn], c, k)).toMatchObject({
      item: { id: "i" },
      reason: "external_id",
    });
    expect(findDuplicateIn([byTitle], c, k)).toMatchObject({ item: { id: "t" }, reason: "title" });
  });

  it("does not title-match notes or entities with conflicting metadata", async () => {
    const note = { type: "note", title: "Meeting" };
    expect(findDuplicateIn([item({ title: "Meeting" })], note, await dedupKeys(note))).toBeNull();
    const dune2021 = { type: "movie", title: "Dune", metadata: { year: 2021 } };
    const dune1984 = item({ type: "movie", title: "Dune", metadata: { year: 1984 } });
    expect(findDuplicateIn([dune1984], dune2021, await dedupKeys(dune2021))).toBeNull();
  });

  it("never matches the candidate's own row and skips the url stage without url identity", async () => {
    const c = {
      type: "ai_chat",
      title: "A",
      sourceUrl: "https://chat.x/c/1",
      urlIdentity: false,
      excludeId: "self",
    };
    const k = await dedupKeys(c);
    expect(k.source_url_norm).toBeNull();
    expect(
      findDuplicateIn([item({ id: "other", source_url: "https://chat.x/c/1" })], c, k),
    ).toBeNull();
  });
});

describe("planMerge", () => {
  it("adds instead of overwriting and notes the source", async () => {
    const existing = item({
      title: "Original",
      content_md: "Alter Text",
      tags: ["ai/mcp"],
      metadata: { author: "A", themes: ["x"] },
      source_url: "https://x.de/a",
    });
    const c = {
      type: "note",
      title: "Neu",
      contentMd: "Neuer Absatz",
      tags: ["AI/MCP", "lesen"],
      metadata: { author: "B", themes: ["x", "y"], year: 2020 },
      platform: "mcp",
      at: "2026-10-31T10:00:00Z",
    };
    const patch = planMerge(existing, c, await dedupKeys(c));
    expect(patch.tags).toEqual(["ai/mcp", "lesen"]);
    expect(patch.metadata).toMatchObject({
      author: "A",
      themes: ["x", "y"],
      year: 2020,
      sources: [{ platform: "mcp", at: "2026-10-31" }],
    });
    expect(patch.content_md).toBe("Alter Text\n\n## Ergänzung (2026-10-31, mcp)\n\nNeuer Absatz\n");
    expect(patch).not.toHaveProperty("title");
  });

  it("is a no-op for an identical re-capture", async () => {
    const existing = item({
      content_md: "Text",
      tags: ["a"],
      metadata: { sources: [{ platform: "web", at: "x" }] },
    });
    const c = { type: "note", title: "T", contentMd: "text", tags: ["a"], platform: "web" };
    expect(planMerge(existing, c, await dedupKeys(c))).toEqual({});
  });
});

describe("tags and tasks", () => {
  it("snaps tags to the existing spelling", () => {
    expect(snapTags(["AI/MCP", "Neu", "neu"], ["ai/mcp"])).toEqual(["ai/mcp", "Neu"]);
  });

  it("finds an open task with the same title, never a done one", () => {
    const tasks = [
      { id: "d", title: "Steuer abgeben", status: "done" },
      { id: "p", title: "Steuer-Abgeben!", status: "in_progress" },
      { id: "o", title: "Steuer abgeben", status: "open" },
    ];
    expect(findOpenTaskIn(tasks, "steuer abgeben")?.id).toBe("p");
    expect(findOpenTaskIn(tasks.slice(0, 1), "Steuer abgeben")).toBeNull();
    expect(findOpenTaskIn(tasks, "!!!")).toBeNull();
  });

  it("keeps task identity across re-extraction without losing edits", () => {
    const plan = planTaskSync(
      [
        { id: "1", title: "MCP-Server testen", status: "open", due_date: null },
        { id: "2", title: "Alt", status: "open", due_date: null },
        { id: "3", title: "Exportiert", status: "open", due_date: null, exported_at: "2026-10-01" },
        { id: "4", title: "Erledigt", status: "done", due_date: null },
      ],
      [
        { title: "MCP Server testen!", due_date: "2026-11-01" },
        { title: "Erledigt" },
        { title: "Neu" },
        { title: "neu" },
      ],
    );
    expect(plan.insert).toEqual([{ title: "Neu" }]);
    expect(plan.deleteIds).toEqual(["2"]);
    expect(plan.update).toEqual([{ id: "1", due_date: "2026-11-01" }]);
  });

  it("recognises the unique URL index violation", () => {
    expect(
      isSourceUrlConflict({
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_items_user_source_url_norm"',
      }),
    ).toBe(true);
    expect(isSourceUrlConflict({ code: "23505", message: "knowledge_items_pkey" })).toBe(false);
  });
});
