import { describe, expect, it } from "vitest";
import { SupabaseBrainRepository } from "@kortex/mcp-server";
import { SupabaseRemoteStore } from "../../../../../packages/md-sync/src/remote/supabase";
import { createIngestHandlers } from "../ingest/handler";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, postJson, seedFolders, setup, USER_ID } from "./helpers";

// Cross-channel dedup (G12): the same URL arriving through the web ingest, the browser clipper,
// the MCP tool brain_save_item and the md-sync vault (Markdown file with source_ref) is exactly one
// item in one store. Every channel uses @kortex/db dedup.ts; this proves they agree on the key.

const BASE = "https://kortex.test/api/ingest";

describe("one URL through four channels", () => {
  it("web ingest, clipper, MCP and md-sync yield exactly one item", async () => {
    const db = new FakeSupabase();
    seedFolders(db);
    const s = setup({ models: mockRouter({ fast: mockModel([{}]) }), db });
    const web = createIngestHandlers(() => s.deps);
    const items = () => db.rows("knowledge_items").filter((r) => r.user_id === USER_ID);

    // 1. Web app: paste a link.
    const first = await (
      await web.POST(postJson(BASE, { kind: "web_clip", url: "https://www.example.com/post/", title: "Dedup im Second Brain", tags: ["ai"] }))
    ).json();
    expect(first.duplicate).toBe(false);
    expect(items()).toHaveLength(1);

    // 2. Browser clipper: same page, tracking parameters, its own client info.
    const clipped = await (
      await web.POST(
        postJson(BASE, {
          kind: "web_clip",
          url: "https://example.com/post?utm_source=newsletter#abschnitt",
          title: "Dedup im Second Brain – Blog",
          tags: ["clipper"],
          client: { name: "extension", version: "1.0.0" },
        }),
      )
    ).json();
    expect(clipped).toMatchObject({ duplicate: true, item_id: first.item_id });
    expect(items()).toHaveLength(1);

    // 3. MCP: an agent calls brain_save_item with the URL.
    const mcp = new SupabaseBrainRepository({ client: db.client, userId: USER_ID, userScoped: false });
    const saved = await mcp.saveItem({
      type: "bookmark",
      title: "Dedup im Second Brain (von Agent)",
      slug: "dedup-im-second-brain",
      content_md: "[Dedup](https://example.com/post/)",
      source_url: "https://example.com/post/?fbclid=abc",
      folder_path: "00_Inbox",
      tags: ["agent"],
    });
    expect(saved.duplicate).not.toBeNull();
    expect(saved.item.id).toBe(first.item_id);
    expect(items()).toHaveLength(1);

    // 4. md-sync: a new vault file with source_ref of the same page.
    const sync = new SupabaseRemoteStore(db.client, null, USER_ID);
    const hit = await sync.mergeIfDuplicate({
      id: "88888888-8888-4888-8888-000000000001",
      parent_item_id: null,
      folder_id: null,
      type: "bookmark",
      source_platform: "web",
      title: "Dedup im Second Brain (Datei)",
      slug: "dedup-im-second-brain-datei",
      content_md: "Notiz aus dem Vault",
      source_url: "http://example.com/post",
      cover_image_url: null,
      icon: "bookmark",
      cluster_name: "General",
      folder_path: "30_Clippings",
      tags: ["vault"],
      entities: [],
      metadata: {},
      status: "inbox",
      local_file_hash: "x",
      remind_at: null,
      created_at: "2026-11-01T10:00:00.000Z",
    });
    expect(hit).toMatchObject({ id: first.item_id, reason: "source_url" });

    // One item, tags of every channel merged (adds, never overwrites).
    expect(items()).toHaveLength(1);
    expect(items()[0]?.tags).toEqual(expect.arrayContaining(["ai", "clipper", "agent", "vault"]));
  });
});

describe("prompt dedup by content hash", () => {
  it("the same short prompt saved twice (other title, spacing, case) is one prompt", async () => {
    const db = new FakeSupabase();
    seedFolders(db);
    const s = setup({ models: mockRouter({ fast: mockModel([{}]) }), db });
    const web = createIngestHandlers(() => s.deps);
    const save = async (title: string, content_md: string) =>
      (
        await web.POST(
          postJson(BASE, { kind: "note", type_hint: "prompt", title, content_md, tags: ["ai/prompt"] }),
        )
      ).json();

    const a = await save("Zusammenfassung", "Fasse den Text in drei Punkten zusammen.");
    const b = await save("Kurzfassung 3 Punkte", "  FASSE den Text in drei   Punkten zusammen. ");
    expect(a.duplicate).toBe(false);
    expect(b).toMatchObject({ duplicate: true, item_id: a.item_id, queued: false });
    // A different prompt is its own item.
    const c = await save("Übersetzen", "Übersetze den Text ins Englische.");
    expect(c.duplicate).toBe(false);
    expect(db.rows("knowledge_items")).toHaveLength(2);
  });
});
