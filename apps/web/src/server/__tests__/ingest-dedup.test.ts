import { describe, expect, it } from "vitest";
import { createIngestHandlers } from "../ingest/handler";
import { FakeSupabase } from "./fake-supabase";
import { authed, mockModel, mockRouter, postJson, seedFolders, setup, USER_ID } from "./helpers";

// Pflicht-Tests des Dedup-Moduls (@kortex/db dedup.ts) am Web-Eingang: dieselbe URL, dieselbe Datei,
// derselbe Text zweimal ergibt genau ein Item; ein Unique-Verstoß ist ein Merge, nie ein 500.

const BASE = "https://kortex.test/api/ingest";

function make() {
  const db = new FakeSupabase();
  seedFolders(db);
  const s = setup({ models: mockRouter({ fast: mockModel([{}]) }), db });
  return { ...s, h: createIngestHandlers(() => s.deps) };
}

const clip = (url: string, over: Record<string, unknown> = {}) => ({
  kind: "web_clip",
  url,
  title: "Dedup im Second Brain",
  tags: ["ai"],
  ...over,
});

const items = (db: FakeSupabase) => db.rows("knowledge_items");

describe("ingest dedup", () => {
  it("the same URL twice (tracking params, www, trailing slash) is one item", async () => {
    const { h, db } = make();
    const a = await (await h.POST(postJson(BASE, clip("https://www.example.com/post/")))).json();
    const b = await (
      await h.POST(
        postJson(BASE, clip("https://example.com/post?utm_source=x", { tags: ["lesen"] })),
      )
    ).json();
    expect(a.duplicate).toBe(false);
    expect(b).toMatchObject({ ok: true, duplicate: true, item_id: a.item_id });
    expect(items(db)).toHaveLength(1);
    expect(items(db)[0]).toMatchObject({ source_url_norm: "example.com/post" });
    expect(items(db)[0]?.tags).toEqual(["ai", "lesen"]);
  });

  it("a unique violation on source_url_norm (concurrent insert) becomes a merge", async () => {
    const { h, db } = make();
    let raced = false;
    db.onQuery = (q) => {
      if (raced || q.table !== "knowledge_items" || q.op !== "insert") return;
      raced = true; // another request stores the same page right before our insert
      db.rows("knowledge_items").push({
        id: "33333333-3333-4333-8333-000000000001",
        user_id: USER_ID,
        type: "bookmark",
        title: "Schneller",
        content_md: "",
        tags: [],
        metadata: {},
        status: "inbox",
        folder_path: "00_Inbox",
        is_manual_placement: false,
        source_url: "https://example.com/race",
        source_url_norm: "example.com/race",
        created_at: "2026-10-23T07:00:00.000Z",
      });
    };
    const res = await h.POST(postJson(BASE, clip("https://example.com/race")));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      duplicate: true,
      queued: false,
      item_id: "33333333-3333-4333-8333-000000000001",
    });
    expect(items(db)).toHaveLength(1);
    expect(items(db)[0]?.tags).toEqual(["ai"]);
  });

  it("the same file twice is one item (hash over the bytes)", async () => {
    const { h, db } = make();
    const upload = async (name: string) => {
      const form = new FormData();
      form.append(
        "file",
        new File([new Uint8Array([37, 80, 68, 70, 1, 2, 3])], name, { type: "application/pdf" }),
      );
      return (await h.POST(new Request(BASE, authed({ method: "POST", body: form })))).json();
    };
    const a = await upload("vertrag.pdf");
    const b = await upload("vertrag (1).pdf");
    expect(a.duplicate).toBe(false);
    expect(b).toMatchObject({ duplicate: true, queued: false, item_id: a.item_id });
    expect(items(db)).toHaveLength(1);
    expect(String(items(db)[0]?.content_hash)).toMatch(/^file:[0-9a-f]{64}$/);
  });

  it("the same note text twice is one item", async () => {
    const { h, db } = make();
    const text = "Kortex dedupliziert über URL, externe IDs, Content-Hash und Titel. ".repeat(3);
    const a = await (await h.POST(postJson(BASE, { kind: "note", content_md: text }))).json();
    const b = await (
      await h.POST(postJson(BASE, { kind: "note", content_md: `  ${text.toUpperCase()}\n` }))
    ).json();
    expect(b).toMatchObject({ duplicate: true, item_id: a.item_id });
    expect(items(db)).toHaveLength(1);
  });
});
