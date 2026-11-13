import { describe, expect, it } from "vitest";
import { createIngestHandlers } from "../ingest/handler";
import { connectorFor, connectorForUrl, disabledConnector } from "../settings/connectors";
import { FakeSupabase } from "./fake-supabase";
import { postJson, seedFolders, setup, USER_ID } from "./helpers";

const BASE = "http://localhost/api/ingest";

function make(enabled: string[] | null) {
  const db = new FakeSupabase({
    user_settings: [{ user_id: USER_ID, enabled_connectors: enabled, auto_tag_enabled: true, auto_cluster_enabled: true }],
  });
  seedFolders(db);
  const s = setup({ db });
  return { ...s, h: createIngestHandlers(() => s.deps) };
}

describe("connector mapping", () => {
  it("routes URLs like the ai-core adapters", () => {
    expect(connectorForUrl("https://www.youtube.com/watch?v=x")).toBe("youtube");
    expect(connectorForUrl("https://youtu.be/x")).toBe("youtube");
    expect(connectorForUrl("https://youtube.com/shorts/x")).toBe("social");
    expect(connectorForUrl("https://open.spotify.com/episode/x")).toBe("podcast");
    expect(connectorForUrl("https://www.instagram.com/reel/x")).toBe("social");
    expect(connectorForUrl("https://example.com/post")).toBe("web");
    expect(connectorForUrl("https://example.com/kuchen", "recipe")).toBe("recipe");
  });

  it("maps every ingest kind; plain notes need no connector", () => {
    expect(connectorFor({ kind: "note", content_md: "x" })).toBeNull();
    expect(connectorFor({ kind: "note", content_md: "x", type_hint: "meeting" })).toBe("meeting");
    expect(
      connectorFor({ kind: "ai_chat", platform: "claude", scope: "chat", url: "https://claude.ai/c/1", title: "t", content_md: "x", message_count: 2, folder_path: "40_AI_Memories" }),
    ).toBe("ai_chat");
    const file = (name: string, type: string) => ({ kind: "file" as const, file: { name, type, bytes: new Uint8Array() } });
    expect(connectorFor(file("a.pdf", "application/pdf"))).toBe("pdf");
    expect(connectorFor(file("b.epub", ""))).toBe("epub");
    expect(connectorFor(file("c.png", "image/png"))).toBe("vision");
  });

  it("treats a missing list as all enabled", () => {
    const req = { kind: "web_clip" as const, url: "https://example.com", title: "x" };
    expect(disabledConnector(req, null)).toBeNull();
    expect(disabledConnector(req, ["web"])).toBeNull();
    expect(disabledConnector(req, ["pdf"])).toBe("web");
  });
});

describe("POST /api/ingest with enabled_connectors", () => {
  it("rejects a capture whose connector is off, before writing anything", async () => {
    const { h, db } = make(["pdf", "epub"]);
    const res = await h.POST(postJson(BASE, { kind: "web_clip", url: "https://example.com/a", title: "A" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: false; error: { code: string; message: string; details: { reason: string; connector: string } } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details).toEqual({ reason: "connector_disabled", connector: "web" });
    expect(body.error.message).toMatch(/Web-Artikel/);
    expect(db.rows("knowledge_items")).toHaveLength(0);
  });

  it("still accepts plain notes and enabled connectors", async () => {
    const { h, db } = make(["web"]);
    expect((await h.POST(postJson(BASE, { kind: "note", content_md: "Gedanke" }))).status).toBe(200);
    expect((await h.POST(postJson(BASE, { kind: "web_clip", url: "https://example.com/b", title: "B" }))).status).toBe(200);
    expect(db.rows("knowledge_items")).toHaveLength(2);
  });
});
