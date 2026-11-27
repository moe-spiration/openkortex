import type { Flashcard } from "@kortex/ai-core";
import type { DeckResponse, DecksResponse, DueResponse } from "@/server/flashcards/service";
import { MOCK_TODAY } from "./workspace";

/*
 * Flashcard decks of the mock workspace (KORTEX_DATA_SOURCE=mock): three notes with cards, some due, so /flashcards
 * shows filled decks and a quiz instead of waiting for /api/flashcards (which needs a signed-in user). Reviews stay in
 * memory for the session; a graded card moves out of "due".
 */

type Raw = { item_id: string; title: string; cards: [question: string, answer: string, dueInDays: number][] };

const RAW: Raw[] = [
  {
    item_id: "n3",
    title: "AI Engineering: Contextual Retrieval",
    cards: [
      ["Why do chunks without context lose meaning?", "A sentence on its own names neither source nor topic, so its embedding matches vague questions less well.", 0],
      ["Which indexes gain from the added context?", "Embeddings and BM25 alike, because both see the same extra context.", 0],
      ["How do you cut the cost of writing the context?", "With prompt caching: the document is cached once and every chunk uses the cache.", -1],
      ["When is the context written?", "Once, at indexing time, not per question.", 3],
    ],
  },
  {
    item_id: "n12",
    title: "Podcast: Zone 2 Training",
    cards: [
      ["How do you know you are in zone 2?", "You can still talk in full sentences; roughly 60 to 70 % of the maximum heart rate.", 0],
      ["Why train most runs slowly?", "It builds the aerobic base and mitochondria without the fatigue of hard sessions.", 2],
    ],
  },
  {
    item_id: "n11",
    title: "Blue Ocean Notes (Strategy Course)",
    cards: [
      ["What are the four actions of the ERRC grid?", "Eliminate, reduce, raise, create.", 5],
      ["What does a strategy canvas compare?", "The factors an industry competes on and how strongly each player offers them.", 9],
    ],
  },
];

const base = new Date(`${MOCK_TODAY}T08:00:00Z`).getTime();
const iso = (days: number) => new Date(base + days * 864e5).toISOString();

const decks: { item_id: string; title: string; cards: Flashcard[] }[] = RAW.map((d) => ({
  item_id: d.item_id,
  title: d.title,
  cards: d.cards.map(([question, answer, dueIn], i) => ({
    id: `${d.item_id}-c${i + 1}`,
    question,
    answer,
    created_at: iso(-14),
    source: "kortex",
    due_at: iso(dueIn),
    interval_days: Math.max(1, dueIn),
    ease: 2.5,
    reps: dueIn > 0 ? 2 : 1,
    lapses: 0,
    last_reviewed_at: iso(-3),
  })),
}));

const isDue = (c: Flashcard) => new Date(c.due_at).getTime() <= base;

/** GET /api/flashcards?decks=1 */
export function mockDecks(): DecksResponse {
  const list = decks
    .map((d) => ({
      item_id: d.item_id,
      title: d.title,
      total: d.cards.length,
      due: d.cards.filter(isDue).length,
      next_due_at: d.cards.map((c) => c.due_at).sort()[0] ?? null,
    }))
    .sort((a, b) => b.due - a.due);
  return { ok: true, total_due: list.reduce((n, d) => n + d.due, 0), decks: list };
}

/** GET /api/flashcards?limit= */
export function mockDue(): DueResponse {
  const cards = decks.flatMap((d) => d.cards.filter(isDue).map((card) => ({ item_id: d.item_id, title: d.title, card })));
  cards.sort((a, b) => a.card.due_at.localeCompare(b.card.due_at));
  return { ok: true, total_due: cards.length, cards };
}

/** GET /api/flashcards?item_id= */
export function mockDeck(itemId: string): DeckResponse {
  const d = decks.find((x) => x.item_id === itemId);
  if (!d) throw new Error("Deck not found");
  return { ok: true, item_id: d.item_id, title: d.title, cards: d.cards, due_count: d.cards.filter(isDue).length };
}

/** POST /api/flashcards/review: "again" keeps the card due, every other grade moves it a few days on. */
export function mockReview(itemId: string, cardId: string, grade: "again" | "hard" | "good" | "easy"): void {
  const card = decks.find((x) => x.item_id === itemId)?.cards.find((c) => c.id === cardId);
  if (!card || grade === "again") return;
  const days = grade === "hard" ? 1 : grade === "good" ? 3 : 6;
  card.due_at = iso(days);
  card.interval_days = days;
  card.reps += 1;
  card.last_reviewed_at = iso(0);
}
