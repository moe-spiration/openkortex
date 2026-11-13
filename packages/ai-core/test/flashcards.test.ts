import { describe, expect, it } from "vitest";
import {
  cardId,
  generateFlashcards,
  isDue,
  mergeCards,
  newCard,
  normalizeCards,
  reviewCard,
} from "../src/flashcards";
import { mockModel, staticRouter } from "./helpers";

const NOW = new Date("2026-10-25T08:00:00.000Z");
const days = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe("spaced repetition (SM-2)", () => {
  it("good: 1 day, 3 days, then interval × ease", () => {
    let c = newCard("Was ist RRF?", "Reciprocal Rank Fusion", NOW);
    expect(isDue(c, NOW)).toBe(true);
    c = reviewCard(c, "good", NOW);
    expect(c).toMatchObject({
      reps: 1,
      interval_days: 1,
      ease: 2.5,
      due_at: days(1).toISOString(),
    });
    c = reviewCard(c, "good", days(1));
    expect(c).toMatchObject({ reps: 2, interval_days: 3 });
    c = reviewCard(c, "good", days(4));
    expect(c.interval_days).toBe(8); // 3 × 2.5 = 7.5 → 8
    expect(isDue(c, days(5))).toBe(false);
  });

  it("again: back in 10 minutes, counts a lapse, lowers ease; easy jumps ahead", () => {
    const learned = reviewCard(reviewCard(newCard("Q", "A", NOW), "good", NOW), "good", days(1));
    const failed = reviewCard(learned, "again", days(4));
    expect(failed).toMatchObject({ reps: 0, lapses: 1, interval_days: 0, ease: 2.3 });
    expect(new Date(failed.due_at).getTime() - days(4).getTime()).toBe(10 * 60_000);
    expect(reviewCard(newCard("Q", "A", NOW), "easy", NOW)).toMatchObject({
      interval_days: 4,
      ease: 2.65,
    });
    // Ease never drops below 1.3.
    let c = newCard("Q", "A", NOW);
    for (let i = 0; i < 10; i++) c = reviewCard(c, "again", NOW);
    expect(c.ease).toBe(1.3);
  });
});

describe("stored decks", () => {
  it("upgrades the chat-action shape and tuples, drops junk and duplicates", () => {
    const cards = normalizeCards(
      [
        {
          question: "Was ist MCP?",
          answer: "Model Context Protocol",
          created_at: "2026-10-20T10:00:00Z",
          source: "copilot",
        },
        ["Was ist pgvector?", "Vektor-Erweiterung für Postgres"],
        { question: "", answer: "x" },
        { question: "was ist  MCP?", answer: "doppelt" },
        42,
      ],
      NOW,
    );
    expect(cards.map((c) => [c.question, c.source, c.due_at])).toEqual([
      ["Was ist MCP?", "copilot", "2026-10-20T10:00:00Z"],
      ["Was ist pgvector?", "kortex", NOW.toISOString()],
    ]);
    expect(cards[0]).toMatchObject({ id: cardId("Was ist MCP?"), ease: 2.5, reps: 0 });
    expect(normalizeCards(null, NOW)).toEqual([]);
  });

  it("append keeps review state; replace keeps state for questions that stay", () => {
    const studied = reviewCard(newCard("Was ist MCP?", "Protokoll", NOW), "good", NOW);
    const fresh = [
      newCard("was ist mcp?", "Model Context Protocol", NOW),
      newCard("Was ist RLS?", "Row Level Security", NOW),
    ];
    const appended = mergeCards([studied], fresh, "append");
    expect(appended.map((c) => [c.question, c.reps])).toEqual([
      ["Was ist MCP?", 1],
      ["Was ist RLS?", 0],
    ]);
    const replaced = mergeCards([studied, newCard("Alt", "weg", NOW)], fresh, "replace");
    expect(replaced.map((c) => [c.answer, c.reps])).toEqual([
      ["Model Context Protocol", 1],
      ["Row Level Security", 0],
    ]);
  });
});

describe("generateFlashcards", () => {
  it("asks the summarize route, skips known and repeated questions, caps the count", async () => {
    const drafts = {
      flashcards: [
        { question: "Was ist RRF?", answer: "Reciprocal Rank Fusion" },
        { question: "Was ist MCP?", answer: "schon da" },
        { question: "was ist rrf?", answer: "doppelt" },
        { question: "Wofür steht RLS?", answer: "Row Level Security" },
        { question: "Zu viel?", answer: "ja" },
      ],
    };
    const out = await generateFlashcards(staticRouter({ fast: mockModel(drafts) }), {
      title: "Hybrid Search",
      contentMd: "# Hybrid Search\n\nRRF kombiniert Rankings.",
      count: 2,
      avoid: ["Was ist MCP?"],
    });
    expect(out).toEqual([
      { question: "Was ist RRF?", answer: "Reciprocal Rank Fusion" },
      { question: "Wofür steht RLS?", answer: "Row Level Security" },
    ]);
  });
});
