import { findDuplicate } from "@kortex/db";
import { describe, expect, it } from "vitest";
import { createChatActionHandlers } from "../chat/action";
import { createScratchpadHandlers } from "../scratchpad/handler";
import { FakeSupabase } from "./fake-supabase";
import { authed, mockModel, mockRouter, postJson, setup, USER_ID } from "./helpers";

// Dedup gaps (audit 2026-11-01): hyphenated external ids, copilot task extraction, scratchpad
// cleanup. Every path must go through @kortex/db dedup.ts and never insert a duplicate twice.

const BOOK = "77777777-7777-4777-8777-777777777777";
const MAIL = "88888888-8888-4888-8888-888888888888";
const NOTE_ID = "55555555-5555-4555-8555-555555555555";

const seedItems = () =>
  new FakeSupabase({
    knowledge_items: [
      {
        id: BOOK,
        user_id: USER_ID,
        type: "book",
        title: "Dune",
        content_md: "",
        metadata: { isbn: "978-3-16-148410-0" },
        tags: [],
        created_at: "2026-10-01T00:00:00Z",
      },
      {
        id: MAIL,
        user_id: USER_ID,
        type: "email",
        title: "Rechnung",
        content_md: "",
        metadata: { message_id: "<CAF+fwd-001@mail.gmail.com>" },
        tags: [],
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
  });

describe("external-id dedup (exact, normalised)", () => {
  for (const missing of [false, true]) {
    const label = missing ? "before the migration (column missing)" : "on external_ids";
    it(`matches hyphenated ISBNs and Message-IDs ${label}`, async () => {
      const db = seedItems();
      if (missing) db.missingColumns.add("external_ids");
      const book = await findDuplicate(db.client, USER_ID, {
        type: "book",
        title: "Der Wüstenplanet",
        metadata: { isbn: "9783161484100" },
      });
      expect(book).toMatchObject({ item: { id: BOOK }, reason: "external_id" });
      const book2 = await findDuplicate(db.client, USER_ID, {
        type: "book",
        title: "Anders",
        metadata: { isbn: "978 3 16 148410 0" },
      });
      expect(book2?.item.id).toBe(BOOK);
      const mail = await findDuplicate(db.client, USER_ID, {
        type: "email",
        title: "Fwd: Rechnung",
        metadata: { message_id: "<caf+fwd-001@mail.gmail.com>" },
      });
      expect(mail).toMatchObject({ item: { id: MAIL }, reason: "external_id" });
    });

    it(`never treats _ or % as wildcards ${label}`, async () => {
      const db = seedItems();
      if (missing) db.missingColumns.add("external_ids");
      for (const id of ["<caf+fwd_001@mail.gmail.com>", "<caf+fwd%@mail.gmail.com>", "%"])
        expect(
          await findDuplicate(db.client, USER_ID, {
            type: "email",
            title: "Andere Mail",
            metadata: { message_id: id },
          }),
          id,
        ).toBeNull();
      // Same id, other type: no hit.
      expect(
        await findDuplicate(db.client, USER_ID, {
          type: "note",
          title: "X",
          metadata: { isbn: "9783161484100" },
        }),
      ).toBeNull();
    });
  }

  it("uses an exact array containment, no ILIKE", async () => {
    const db = seedItems();
    await findDuplicate(db.client, USER_ID, {
      type: "book",
      title: "Dune",
      metadata: { isbn: "978-3-16-148410-0" },
    });
    const filters = db.log.flatMap((q) => q.filters);
    expect(filters).toContainEqual({
      col: "external_ids",
      op: "cs",
      value: '{"isbn:9783161484100"}',
    });
    expect(filters.some((f) => f.op === "ilike")).toBe(false);
  });
});

const session = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { cookie: "sb-kortex-auth-token=x", "content-type": "application/json" },
  });

describe("copilot task extraction", () => {
  it("running it twice keeps one task per title and touches nothing else", async () => {
    const db = new FakeSupabase({
      knowledge_items: [
        { id: NOTE_ID, user_id: USER_ID, title: "MCP", content_md: "Server testen, Doku schreiben." },
      ],
      action_items: [
        // Pipeline-extracted earlier and not part of the copilot answer: must stay.
        {
          id: "t-old",
          user_id: USER_ID,
          source_item_id: NOTE_ID,
          title: "Release planen",
          status: "open",
          due_date: null,
        },
      ],
    });
    db.authUser = { id: USER_ID };
    const task = (title: string) => ({
      title,
      description: null,
      assignee: "",
      priority: "medium",
      due_date: null,
      source_timestamp_sec: null,
    });
    const answer = { action_items: [task("Server testen"), task("Doku schreiben")] };
    const s = setup({ db, models: mockRouter({ chat: mockModel([answer]) }) });
    const h = createChatActionHandlers(() => s.deps);
    for (let i = 0; i < 2; i++) {
      const res = await h.POST(
        session("https://kortex.test/api/chat/action", {
          action: "tasks",
          item_id: NOTE_ID,
          save: true,
        }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).saved).toBe(true);
    }
    expect(db.rows("action_items").map((t) => t.title).sort()).toEqual([
      "Doku schreiben",
      "Release planen",
      "Server testen",
    ]);
  });
});

const BASE = "https://kortex.test/api/scratchpad";
const LONG =
  "Idee fuer einen Blogpost: wie Kortex RAG mit pgvector und Volltextsuche kombiniert und warum das hilft.";

describe("scratchpad cleanup", () => {
  it("merges a note with the same content and reuses an open task with the same title", async () => {
    const db = new FakeSupabase();
    const s = setup({ db, models: mockRouter({}) });
    const h = createScratchpadHandlers(() => s.deps);

    const round = async () => {
      await h.POST(postJson(BASE, { text: LONG }));
      await h.POST(postJson(BASE, { text: "Steuer abgeben" }));
      const { entries } = await (await h.GET(new Request(BASE, authed()))).json();
      const res = await (
        await h.apply(
          postJson(`${BASE}/apply`, {
            decisions: [
              { entry_id: entries[0].id, action: "note", title: "Blog RAG" },
              { entry_id: entries[1].id, action: "task", title: "Steuer abgeben!" },
            ],
          }),
        )
      ).json();
      expect(res.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
      return res.results[0].created_id as string;
    };

    const first = await round();
    const second = await round();
    expect(second).toBe(first);
    expect(db.rows("knowledge_items").filter((r) => r.title === "Blog RAG")).toHaveLength(1);
    expect(db.rows("action_items")).toHaveLength(1);

    // A done task never blocks a new one.
    db.rows("action_items")[0]!.status = "done";
    await round();
    expect(db.rows("action_items")).toHaveLength(2);
  });
});
