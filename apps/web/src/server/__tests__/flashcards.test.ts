import { describe, expect, it } from "vitest";
import { createFlashcardHandlers } from "../flashcards/handler";
import { FakeSupabase } from "./fake-supabase";
import { authed, mockModel, mockRouter, NOW, postJson, setup, USER_ID } from "./helpers";

const BASE = "https://kortex.test/api/flashcards";
const NOTE = "11111111-1111-4111-8111-111111111111";
const LEGACY = "11111111-1111-4111-8111-222222222222";
const SHORT = "11111111-1111-4111-8111-333333333333";

const drafts = {
  flashcards: [
    { question: "Was kombiniert RRF?", answer: "Volltext- und Vektor-Rankings" },
    { question: "Was ist MCP?", answer: "schon im Deck" },
    { question: "Wofür steht RLS?", answer: "Row Level Security" },
  ],
};

function make() {
  const db = new FakeSupabase({
    knowledge_items: [
      {
        id: NOTE,
        user_id: USER_ID,
        title: "Hybrid Search",
        status: "processed",
        content_md: `# Hybrid Search\n\n${"RRF kombiniert Volltext- und Vektor-Rankings. RLS schützt die Zeilen. ".repeat(4)}`,
        flashcards: [],
        updated_at: "2026-10-22T10:00:00Z",
      },
      {
        // Older chat-action shape, no review state yet.
        id: LEGACY,
        user_id: USER_ID,
        title: "MCP",
        status: "processed",
        content_md: "MCP …",
        flashcards: [
          {
            question: "Was ist MCP?",
            answer: "Model Context Protocol",
            created_at: "2026-10-20T10:00:00Z",
            source: "copilot",
          },
        ],
        updated_at: "2026-10-21T10:00:00Z",
      },
      {
        id: SHORT,
        user_id: USER_ID,
        title: "Kurz",
        status: "processed",
        content_md: "zu kurz",
        flashcards: [],
        updated_at: "2026-10-20T10:00:00Z",
      },
    ],
  });
  const s = setup({ db, models: mockRouter({ fast: mockModel([drafts]) }) });
  return { ...s, h: createFlashcardHandlers(() => s.deps) };
}

const get = (query: string) => new Request(`${BASE}${query}`, authed());

describe("/api/flashcards", () => {
  it("generates cards from the note, stores them with review state", async () => {
    const { h, db } = make();
    const res = await h.POST(postJson(BASE, { item_id: NOTE, count: 5 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      item_id: NOTE,
      title: "Hybrid Search",
      added: 3,
      due_count: 3,
    });
    expect(body.cards[0]).toMatchObject({
      question: "Was kombiniert RRF?",
      source: "kortex",
      due_at: NOW.toISOString(),
      interval_days: 0,
      ease: 2.5,
      reps: 0,
    });
    const stored = db.rows("knowledge_items").find((r) => r.id === NOTE)!.flashcards as unknown[];
    expect(stored).toHaveLength(3);
    // Portable Markdown: the deck is mirrored into the note as a parseable section.
    const md = String(db.rows("knowledge_items").find((r) => r.id === NOTE)!.content_md);
    expect(md).toMatch(/^# Hybrid Search\n/);
    expect(md).toContain(
      "## Karteikarten\n\n- **F:** Was kombiniert RRF?\n  **A:** Volltext- und Vektor-Rankings",
    );
  });

  it("lists one deck, and due cards across notes (legacy cards included, oldest first)", async () => {
    const { h } = make();
    await h.POST(postJson(BASE, { item_id: NOTE }));
    const deck = await (await h.GET(get(`?item_id=${LEGACY}`))).json();
    expect(deck).toMatchObject({
      item_id: LEGACY,
      due_count: 1,
      cards: [{ question: "Was ist MCP?", source: "copilot" }],
    });
    const due = await (await h.GET(get("?limit=2"))).json();
    expect(due.total_due).toBe(4);
    expect(due.cards).toHaveLength(2);
    expect(due.cards[0]).toMatchObject({ item_id: LEGACY, title: "MCP" });
  });

  it("?decks=1 lists every deck with card and due counts", async () => {
    const { h } = make();
    await h.POST(postJson(BASE, { item_id: NOTE }));
    const body = await (await h.GET(get("?decks=1"))).json();
    expect(body.total_due).toBe(4);
    expect(body.decks).toEqual([
      expect.objectContaining({ item_id: NOTE, title: "Hybrid Search", total: 3, due: 3 }),
      expect.objectContaining({ item_id: LEGACY, title: "MCP", total: 1, due: 1 }),
    ]);
  });

  it("review: good schedules the card a day ahead, so it leaves the due list", async () => {
    const { h, db } = make();
    const deck = await (await h.GET(get(`?item_id=${LEGACY}`))).json();
    const cardId = deck.cards[0].id as string;
    const res = await h.review(
      postJson(`${BASE}/review`, { item_id: LEGACY, card_id: cardId, grade: "good" }),
    );
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      due_count: 0,
      card: { reps: 1, interval_days: 1, last_reviewed_at: NOW.toISOString() },
    });
    const stored = db.rows("knowledge_items").find((r) => r.id === LEGACY)!.flashcards as Array<
      Record<string, unknown>
    >;
    expect(stored[0]).toMatchObject({ id: cardId, reps: 1, question: "Was ist MCP?" });
    expect((await (await h.GET(get(""))).json()).total_due).toBe(0);
  });

  it("rejects too little content, unknown items, unknown cards and bad grades", async () => {
    const { h } = make();
    expect((await h.POST(postJson(BASE, { item_id: SHORT }))).status).toBe(400);
    expect(
      (await h.POST(postJson(BASE, { item_id: "11111111-1111-4111-8111-999999999999" }))).status,
    ).toBe(404);
    expect(
      (
        await h.review(
          postJson(`${BASE}/review`, { item_id: LEGACY, card_id: "nope", grade: "good" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.review(
          postJson(`${BASE}/review`, { item_id: LEGACY, card_id: "x", grade: "perfect" }),
        )
      ).status,
    ).toBe(400);
  });
});
