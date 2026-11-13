import { describe, expect, it } from "vitest";
import { processItem } from "../ingest/process";
import { FakeSupabase } from "./fake-supabase";
import { fakeFetch, json, mockModel, mockRouter, seedFolders, setup, USER_ID } from "./helpers";

/* Recall import re-crawl: the job carries the source URL, the export's notes go below. */

const URL_ = "https://www.example.org/artikel/kortex";
const enrichment = {
  title: "KI-Titel",
  summary: "Kurz.",
  cluster_name: "AI",
  suggested_folder_path: "30_Clippings/AI",
  tags: ["ai/mcp"],
  entities: [],
  action_items: [],
};

const page = fakeFetch([
  {
    match: (u) => u.startsWith("https://r.jina.ai/"),
    respond: () =>
      json({
        data: {
          title: "Volltext",
          url: URL_,
          content: `# Volltext\n\n${"Der vollständige Artikeltext aus der Quelle. ".repeat(20)}`,
        },
      }),
  },
]);
const dead = fakeFetch([{ match: () => true, respond: () => json({}, 500) }]);

function make(fetch: typeof page, type = "article", folder = "00_Inbox") {
  const db = new FakeSupabase();
  seedFolders(db);
  db.rows("knowledge_items").push({
    id: "item-1",
    user_id: USER_ID,
    type,
    title: "Recall-Titel",
    slug: "recall-titel",
    content_md: "- Recall-Notiz\n\n## Sources\n\n- [website](" + URL_ + ")\n",
    source_url: URL_,
    source_platform: "recall",
    folder_path: folder,
    folder_id: `f-${folder}`,
    tags: [],
    status: "inbox",
    metadata: { import: { source: "recall", file: "x.md" } },
  });
  const s = setup({ db, fetch, models: mockRouter({ fast: mockModel([enrichment]) }) });
  const ctx = { userId: USER_ID, mode: "api_token" as const, client: s.deps.clients.service() };
  const item = () =>
    db.rows("knowledge_items")[0] as Record<string, unknown> & {
      metadata: Record<string, unknown>;
      content_md: string;
    };
  return { ...s, ctx, item };
}

// The job runImport writes for a re-crawl: only the URL; Kortex decides title, tags, platform.
const input = { url: URL_, clientHint: { title: "Recall-Titel" } };
const options = {
  sourceUrl: URL_,
  fallbackText: "- Recall-Notiz\n\n## Sources\n\n- [website](" + URL_ + ")\n",
};

describe("processItem without any AI key", () => {
  it("keeps the capture as saved and finishes at once instead of retrying", async () => {
    const db = new FakeSupabase();
    seedFolders(db);
    db.rows("knowledge_items").push({
      id: "item-1",
      user_id: USER_ID,
      type: "note",
      title: "Notiz",
      slug: "notiz",
      content_md: "Mein Text",
      folder_path: "00_Inbox",
      folder_id: "f-00_Inbox",
      tags: [],
      status: "inbox",
      metadata: {},
    });
    const s = setup({ db, fetch: dead, env: { ANTHROPIC_API_KEY: "" } });
    const ctx = { userId: USER_ID, mode: "api_token" as const, client: s.deps.clients.service() };
    await processItem(s.deps, ctx, "item-1", { rawText: "Mein Text" }, {}, { final: false });
    const row = db.rows("knowledge_items")[0] as Record<string, unknown> & {
      metadata: { ingest: Record<string, unknown> };
    };
    expect(row.status).toBe("processed");
    expect(row.content_md).toBe("Mein Text");
    expect(row.title).toBe("Notiz");
    expect(row.metadata.ingest).toMatchObject({ state: "skipped", reason: "no_ai_key" });
  });
});

describe("import re-crawl (processItem)", () => {
  it("replaces the thin card with the crawled page; title, tags and platform come from Kortex", async () => {
    const { deps, ctx, item } = make(page);
    await processItem(deps, ctx, "item-1", input, options);
    const row = item();
    expect(row.status).toBe("processed");
    expect(row.title).toBe("KI-Titel");
    expect(row.tags).toEqual(["ai/mcp"]);
    expect(row.content_md).toContain("Der vollständige Artikeltext");
    expect(row.content_md).not.toContain("Recall-Notiz");
    expect(row.source_platform).not.toBe("recall");
    expect(row.metadata.recrawl).toEqual({ state: "done", url: URL_ });
    expect(row.metadata.import).toMatchObject({ source: "recall" });
  });

  it("an unreadable page on the last attempt falls back to the imported text", async () => {
    const { deps, ctx, item } = make(dead);
    await processItem(deps, ctx, "item-1", { ...input, clientHint: {} }, options, { final: true });
    const row = item();
    expect(row.status).not.toBe("error");
    expect(row.content_md).toContain("Recall-Notiz");
    expect(row.metadata.recrawl).toEqual({ state: "failed", url: URL_ });
  });

  it("earlier attempts still retry instead of falling back", async () => {
    const { deps, ctx, item } = make(dead);
    await expect(
      processItem(deps, ctx, "item-1", { ...input, clientHint: {} }, options, { final: false }),
    ).rejects.toThrow();
    expect(item().metadata.ingest).toMatchObject({ state: "retrying" });
  });

  it("domain objects keep their type and folder", async () => {
    const { deps, ctx, item } = make(page, "organization", "70_Objects/Organizations");
    await processItem(deps, ctx, "item-1", input, { ...options, keepType: true });
    const row = item();
    expect(row.type).toBe("organization");
    expect(row.folder_path).toBe("70_Objects/Organizations");
    expect(row.content_md).toContain("Der vollständige Artikeltext");
  });
});
