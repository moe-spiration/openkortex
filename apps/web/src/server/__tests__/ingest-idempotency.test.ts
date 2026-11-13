import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createIngestHandlers } from "../ingest/handler";
import { INGEST_LIMITS } from "../ingest/contract";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, postJson, seedFolders, setup, USER_ID } from "./helpers";

// Retries from the extension outbox (timeouts, offline) must never write twice.

const BASE = "https://kortex.test/api/ingest";
const URL_A = "https://www.heise.de/hintergrund/mcp-erklaert-1234.html";
const KEY = "0b9f6a52-9c3e-4a71-8f0c-6d2a1a5e7c11";

function make() {
  const db = new FakeSupabase();
  seedFolders(db);
  const s = setup({ db, models: mockRouter({ fast: mockModel([{}]) }) });
  return { ...s, h: createIngestHandlers(() => s.deps) };
}
type Made = ReturnType<typeof make>;
const post = async (m: Made, body: unknown) => {
  const res = await m.h.POST(postJson(BASE, body));
  return { status: res.status, body: await res.json() };
};

const clip = (over: Record<string, unknown> = {}) => ({
  kind: "web_clip",
  url: URL_A,
  title: "MCP erklärt",
  tags: ["ai/mcp"],
  idempotency_key: KEY,
  ...over,
});

const locator = {
  v: 1,
  quote: { exact: "verbindet Agenten", prefix: "", suffix: "" },
  position: { start: 4, end: 21 },
  range: { startXPath: "/p[1]/text()[1]", startOffset: 4, endXPath: "/p[1]/text()[1]", endOffset: 21 },
};
const highlight = (over: Record<string, unknown> = {}) => ({
  kind: "highlight",
  url: URL_A,
  page_title: "MCP erklärt",
  quote_text: "verbindet Agenten",
  locator,
  idempotency_key: KEY,
  ...over,
});

const chat = (over: Record<string, unknown> = {}) => ({
  kind: "ai_chat",
  platform: "claude",
  scope: "answer",
  url: "https://claude.ai/chat/abc",
  title: "RAG chunking",
  content_md: "### User\nFrage\n\n### Assistant\nAntwort",
  message_count: 2,
  folder_path: "40_AI_Memories",
  captured_at: "2026-10-22T21:00:00Z",
  idempotency_key: KEY,
  ...over,
});

describe("web_clip idempotency", () => {
  it("answers a retry with the original item and writes nothing again", async () => {
    const m = make();
    const a = await post(m, clip());
    const b = await post(m, clip());
    expect(a.body).toMatchObject({ ok: true, duplicate: false, queued: true });
    expect(a.body.replayed).toBeUndefined();
    expect(b.body).toMatchObject({ ok: true, item_id: a.body.item_id, duplicate: true, queued: false, replayed: true });
    expect(m.db.rows("knowledge_items")).toHaveLength(1);
    expect(m.deferred).toHaveLength(1);
  });

  it("does not append the user's note twice when an existing item is merged and retried", async () => {
    const m = make();
    await post(m, clip({ idempotency_key: "first-capture-key-0001" }));
    // The pipeline job reads the item metadata once at its start and writes it back at the end, so a
    // merge that lands while it runs would lose its key; wait for it like a real second visit would.
    await m.drain();
    const merge = clip({ idempotency_key: "second-capture-key-0002", note: "wichtig fürs RAG-Projekt" });
    const a = await post(m, merge);
    const b = await post(m, merge);
    expect(a.body.duplicate).toBe(true);
    expect(a.body.replayed).toBeUndefined();
    expect(b.body).toMatchObject({ item_id: a.body.item_id, replayed: true });
    const row = m.db.rows("knowledge_items")[0]!;
    expect(String(row.content_md).match(/wichtig fürs RAG-Projekt/g)).toHaveLength(1);
    expect((row.metadata as { idempotency_keys: string[] }).idempotency_keys).toEqual([
      "first-capture-key-0001",
      "second-capture-key-0002",
    ]);
  });

  it("treats a new key for the same URL as a new capture, and no key as before", async () => {
    const m = make();
    await post(m, clip());
    const other = await post(m, clip({ idempotency_key: "another-key-0000-0003", note: "n2" }));
    expect(other.body).toMatchObject({ duplicate: true, queued: false });
    expect(other.body.replayed).toBeUndefined();
    const noKey = await post(m, clip({ idempotency_key: undefined, note: "n3" }));
    expect(noKey.body.replayed).toBeUndefined();
    expect(String(m.db.rows("knowledge_items")[0]!.content_md)).toContain("n3");
  });

  it("keeps only the newest 20 keys", async () => {
    const m = make();
    for (let i = 0; i < 23; i++) await post(m, clip({ idempotency_key: `key-number-${String(i).padStart(4, "0")}` }));
    const keys = (m.db.rows("knowledge_items")[0]!.metadata as { idempotency_keys: string[] }).idempotency_keys;
    expect(keys).toHaveLength(20);
    expect(keys.at(-1)).toBe("key-number-0022");
  });

  it("scopes replays to the URL", async () => {
    const m = make();
    await post(m, clip());
    const other = await post(m, clip({ url: "https://example.com/other" }));
    expect(other.body).toMatchObject({ duplicate: false, queued: true });
    expect(m.db.rows("knowledge_items")).toHaveLength(2);
  });
});

describe("highlight idempotency", () => {
  it("returns the same highlight for a retry (also when the page item is new)", async () => {
    const m = make();
    const a = await post(m, highlight());
    const b = await post(m, highlight());
    expect(a.body).toMatchObject({ ok: true, duplicate: false, queued: true });
    expect(b.body).toMatchObject({
      item_id: a.body.item_id,
      highlight_id: a.body.highlight_id,
      replayed: true,
      duplicate: true,
      queued: false,
    });
    expect(m.db.rows("item_highlights")).toHaveLength(1);
    expect(m.db.rows("knowledge_items")).toHaveLength(1);
    expect(m.deferred).toHaveLength(1);
  });

  it("stores the key inside the locator and keeps the locator untouched without a key", async () => {
    const m = make();
    await post(m, highlight());
    await post(m, highlight({ idempotency_key: undefined, quote_text: "zweites" }));
    const rows = m.db.rows("item_highlights");
    expect(rows[0]!.locator).toEqual({ ...locator, idempotency_key: KEY });
    expect(rows[1]!.locator).toEqual(locator);
  });

  it("a different key on the same page adds a highlight, and keys are per user and item", async () => {
    const m = make();
    const a = await post(m, highlight());
    const b = await post(m, highlight({ idempotency_key: "second-highlight-key-2", quote_text: "zweites Zitat" }));
    expect(b.body.highlight_id).not.toBe(a.body.highlight_id);
    expect(b.body.replayed).toBeUndefined();
    expect(m.db.rows("item_highlights")).toHaveLength(2);
    for (const r of m.db.rows("item_highlights")) expect(r.user_id).toBe(USER_ID);
  });

  it("recovers when the first attempt created the item but crashed before the highlight", async () => {
    const m = make();
    await post(m, clip({ idempotency_key: "clip-key-aaaaaaaa" })); // page item exists, no highlight yet
    const a = await post(m, highlight());
    const b = await post(m, highlight());
    expect(a.body).toMatchObject({ duplicate: true });
    expect(b.body).toMatchObject({ replayed: true, highlight_id: a.body.highlight_id });
    expect(m.db.rows("item_highlights")).toHaveLength(1);
  });
});

describe("ai_chat idempotency", () => {
  it("never creates a second item for a retried single answer", async () => {
    const m = make();
    const a = await post(m, chat());
    const b = await post(m, chat());
    expect(b.body).toMatchObject({ item_id: a.body.item_id, replayed: true, file: a.body.file, folder_path: "40_AI_Memories" });
    expect(m.db.rows("knowledge_items")).toHaveLength(1);
    expect(m.deferred).toHaveLength(1);
  });

  it("answers without a key still create separate items, with a new key too", async () => {
    const m = make();
    await post(m, chat({ idempotency_key: undefined }));
    await post(m, chat({ idempotency_key: undefined }));
    await post(m, chat({ idempotency_key: "yet-another-chat-key" }));
    expect(m.db.rows("knowledge_items")).toHaveLength(3);
  });

  it("a replayed whole-chat export does not re-queue the pipeline", async () => {
    const m = make();
    const a = await post(m, chat({ scope: "chat" }));
    const b = await post(m, chat({ scope: "chat" }));
    expect(b.body).toMatchObject({ item_id: a.body.item_id, replayed: true, queued: false });
    expect(m.deferred).toHaveLength(1);
    // a later export of the same chat (new key) still updates the memory
    const c = await post(m, chat({ scope: "chat", idempotency_key: "later-export-key-1", content_md: "### User\nNeu" }));
    expect(c.body).toMatchObject({ duplicate: true, queued: true });
    expect(m.db.rows("knowledge_items")).toHaveLength(1);
    expect(m.db.rows("knowledge_items")[0]!.content_md).toBe("### User\nNeu");
  });
});

describe("contract limits and error shape", () => {
  it("rejects malformed keys", async () => {
    const m = make();
    for (const bad of ["short", "has spaces in it!", "x".repeat(129)]) {
      const r = await post(m, clip({ idempotency_key: bad }));
      expect(r.status, bad).toBe(400);
      expect(r.body.error.code).toBe("invalid_request");
    }
  });

  it("reports the offending field of an over-long value in `details`", async () => {
    const m = make();
    const r = await post(m, clip({ title: "x".repeat(INGEST_LIMITS.title + 1) }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_request");
    expect(r.body.error.message).toMatch(/^title: /);
    expect(r.body.error.details[0].path).toEqual(["title"]);
  });

  it("refuses non-http(s) image URLs (the extension drops them before sending)", async () => {
    const m = make();
    const r = await post(m, clip({ image_url: "data:image/png;base64,AAAA" }));
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toEqual(["image_url"]);
  });

  it("accepts values exactly at the limits", async () => {
    const m = make();
    const r = await post(
      m,
      clip({
        title: "t".repeat(INGEST_LIMITS.title),
        description: "d".repeat(INGEST_LIMITS.description),
        note: "n".repeat(INGEST_LIMITS.note),
        site_name: "s".repeat(INGEST_LIMITS.siteName),
      }),
    );
    expect(r.status).toBe(200);
  });

  it("the extension mirrors exactly these limits", async () => {
    const path = fileURLToPath(new URL("../../../../extension/src/lib/limits.ts", import.meta.url));
    const ext = (await import(/* @vite-ignore */ path)) as { LIMITS: Record<string, number> };
    expect(ext.LIMITS).toEqual(INGEST_LIMITS);
  });
});
