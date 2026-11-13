import { describe, expect, it } from "vitest";
import { createChatActionHandlers } from "../chat/action";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, setup, USER_ID } from "./helpers";

// In-App-Status-Update: "Dune gelesen, hat mir gefallen" setzt metadata.status/feedback am
// bestehenden Buch, statt eine neue Notiz anzulegen.

const ACTION = "https://kortex.test/api/chat/action";
const BOOK = "66666666-6666-4666-8666-000000000001";

const session = (body: unknown) =>
  new Request(ACTION, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { cookie: "sb-kortex-auth-token=x", "content-type": "application/json" },
  });

function make(extraction: Record<string, unknown>) {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: BOOK,
        user_id: USER_ID,
        type: "book",
        title: "Dune",
        status: "processed",
        content_md: "",
        metadata: { status: "want_to_read", author: "Frank Herbert", ingest: { state: "done" } },
        updated_at: "2026-10-20T10:00:00Z",
      },
      {
        id: "66666666-6666-4666-8666-000000000002",
        user_id: USER_ID,
        type: "book",
        title: "Dune Messiah",
        status: "processed",
        content_md: "",
        metadata: { status: "want_to_read" },
        updated_at: "2026-10-21T10:00:00Z",
      },
    ],
  });
  db.authUser = { id: USER_ID };
  const s = setup({ db, models: mockRouter({ chat: mockModel([extraction]) }) });
  return { db, h: createChatActionHandlers(() => s.deps) };
}

describe("POST /api/chat/action status", () => {
  it("updates the existing entry (exact title wins), never creates a note", async () => {
    const { db, h } = make({
      query: "Dune",
      type: "book",
      status: "read",
      feedback: "Hat mir gefallen",
      rating: null,
    });
    const res = await h.POST(
      session({ action: "status", instruction: "Dune gelesen, hat mir gefallen", save: true }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      action: "status",
      item_id: BOOK,
      title: "Dune",
      metadata: { status: "read", feedback: "Hat mir gefallen" },
      saved: true,
    });
    expect(db.rows("knowledge_items")).toHaveLength(2);
    expect(db.rows("knowledge_items")[0]?.metadata).toMatchObject({
      status: "read",
      feedback: "Hat mir gefallen",
      author: "Frank Herbert",
      ingest: { state: "done" },
    });
  });

  it("rejects a status that does not fit the type and reports a missing entry", async () => {
    const bad = make({
      query: "Dune",
      type: "book",
      status: "watched",
      feedback: null,
      rating: null,
    });
    const r1 = await bad.h.POST(
      session({ action: "status", instruction: "Dune geschaut", save: true }),
    );
    expect(r1.status).toBe(400);
    expect((await r1.json()).error.message).toMatch(/want_to_read, reading, read/);
    expect(bad.db.rows("knowledge_items")[0]?.metadata).toMatchObject({ status: "want_to_read" });

    const none = make({
      query: "Foundation",
      type: "book",
      status: "read",
      feedback: null,
      rating: null,
    });
    const r2 = await none.h.POST(
      session({ action: "status", instruction: "Foundation gelesen", save: true }),
    );
    expect(r2.status).toBe(404);
    expect(none.db.rows("knowledge_items")).toHaveLength(2);
  });
});
