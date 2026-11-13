import { t } from "@/i18n";
import { z } from "zod";
import {
  cardsFromSection,
  generateFlashcards,
  parseFlashcardsSection,
  stripFlashcardsSection,
  withFlashcardsSection,
  isDue,
  mergeCards,
  newCard,
  normalizeCards,
  REVIEW_GRADES,
  reviewCard,
  type Flashcard,
  type ModelRouter,
} from "@kortex/ai-core";
import type { Json } from "@kortex/db";
import { badRequest, notFound } from "../api-error";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { getItem, updateItem } from "../repo";

/*
 * Flashcards on a note (knowledge_items.flashcards, array) with spaced-repetition state:
 * generate from the note's Markdown, list one deck or everything due, record a review (SM-2).
 * Runs as the signed-in user, so knowledge_items RLS scopes every read and write.
 * Portable Markdown: every change of the questions/answers is mirrored into the note's content_md as
 * a "## Karteikarten" section; a section edited in the vault wins for Q/A (review state is kept).
 */

export const GenerateRequestSchema = z.object({
  item_id: z.string().uuid(),
  count: z.number().int().min(1).max(30).default(10),
  /** append: new cards join the deck; replace: the deck becomes the new cards (state kept for matching questions). */
  mode: z.enum(["append", "replace"]).default("append"),
  /** Exact model id for this run (like /api/digest); default: summarize route. */
  model: z.string().trim().min(1).max(200).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const ReviewRequestSchema = z.object({
  item_id: z.string().uuid(),
  card_id: z.string().trim().min(1).max(64),
  grade: z.enum(REVIEW_GRADES),
});

export const ListQuerySchema = z.object({
  item_id: z.string().uuid().optional(),
  /** decks=1: list every deck with its card and due counts. */
  decks: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

const MIN_CONTENT = 80;

export interface DeckResponse {
  ok: true;
  item_id: string;
  title: string;
  cards: Flashcard[];
  due_count: number;
}

export interface DueResponse {
  ok: true;
  total_due: number;
  cards: { item_id: string; title: string; card: Flashcard }[];
}

async function loadDeck(ctx: AuthContext, itemId: string) {
  const item = await getItem(ctx.client, ctx.userId, itemId, [
    "id",
    "title",
    "content_md",
    "flashcards",
  ]);
  if (!item) throw notFound(t("Entry not found"));
  return item;
}

/** The deck: JSON review state, questions/answers from the Markdown section when it differs. */
function currentCards(item: { flashcards: unknown; content_md: string | null }, now: Date) {
  const cards = normalizeCards(item.flashcards, now);
  const section = parseFlashcardsSection(item.content_md ?? "");
  if (!section) return cards;
  const same =
    section.length === cards.length &&
    section.every((c, i) => c.question === cards[i]?.question && c.answer === cards[i]?.answer);
  return same ? cards : cardsFromSection(cards, section, now);
}

const deck = (itemId: string, title: string, cards: Flashcard[], now: Date): DeckResponse => ({
  ok: true,
  item_id: itemId,
  title,
  cards,
  due_count: cards.filter((c) => isDue(c, now)).length,
});

export async function generateDeck(
  deps: Pick<ServerDeps, "now">,
  ctx: AuthContext,
  req: GenerateRequest,
  models: ModelRouter,
): Promise<DeckResponse & { added: number }> {
  const item = await loadDeck(ctx, req.item_id);
  // The cards' own section is not source material for new cards.
  const content = stripFlashcardsSection(item.content_md ?? "").trim();
  if (content.length < MIN_CONTENT) throw badRequest(t("Not enough content for flashcards"));
  const now = deps.now();
  const existing = currentCards(item, now);
  const drafts = await generateFlashcards(models, {
    title: item.title,
    contentMd: content,
    count: req.count,
    avoid: req.mode === "append" ? existing.map((c) => c.question) : [],
  });
  const generated = drafts.map((d) => newCard(d.question, d.answer, now, "kortex"));
  const cards = mergeCards(existing, generated, req.mode);
  await updateItem(ctx.client, ctx.userId, item.id, {
    flashcards: cards as unknown as Json,
    content_md: withFlashcardsSection(item.content_md ?? "", cards),
  });
  const before = new Set(existing.map((c) => c.id));
  return {
    ...deck(item.id, item.title, cards, now),
    added: cards.filter((c) => !before.has(c.id)).length,
  };
}

export async function getDeck(
  deps: Pick<ServerDeps, "now">,
  ctx: AuthContext,
  itemId: string,
): Promise<DeckResponse> {
  const item = await loadDeck(ctx, itemId);
  return deck(item.id, item.title, currentCards(item, deps.now()), deps.now());
}

/** Due cards across the user's notes, most overdue first. */
export async function dueCards(
  deps: Pick<ServerDeps, "now">,
  ctx: AuthContext,
  limit: number,
): Promise<DueResponse> {
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id,title,flashcards")
    .eq("user_id", ctx.userId)
    .not("flashcards", "is", null)
    .neq("flashcards", "[]")
    .not("status", "in", "(error,archived)")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`load flashcards: ${error.message}`);
  const now = deps.now();
  const due: DueResponse["cards"] = [];
  for (const r of (data ?? []) as { id: string; title: string; flashcards: unknown }[])
    for (const card of normalizeCards(r.flashcards, now))
      if (isDue(card, now)) due.push({ item_id: r.id, title: r.title, card });
  due.sort((a, b) => a.card.due_at.localeCompare(b.card.due_at));
  return { ok: true, total_due: due.length, cards: due.slice(0, limit) };
}

export interface DecksResponse {
  ok: true;
  total_due: number;
  decks: { item_id: string; title: string; total: number; due: number; next_due_at: string | null }[];
}

/** Every deck of the user (notes with cards), decks with due cards first. */
export async function listDecks(
  deps: Pick<ServerDeps, "now">,
  ctx: AuthContext,
): Promise<DecksResponse> {
  const { data, error } = await ctx.client
    .from("knowledge_items")
    .select("id,title,flashcards")
    .eq("user_id", ctx.userId)
    .not("flashcards", "is", null)
    .neq("flashcards", "[]")
    .not("status", "in", "(error,archived)")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`load flashcards: ${error.message}`);
  const now = deps.now();
  const decks: DecksResponse["decks"] = [];
  for (const r of (data ?? []) as { id: string; title: string; flashcards: unknown }[]) {
    const cards = normalizeCards(r.flashcards, now);
    if (!cards.length) continue;
    decks.push({
      item_id: r.id,
      title: r.title,
      total: cards.length,
      due: cards.filter((c) => isDue(c, now)).length,
      next_due_at: cards.map((c) => c.due_at).sort()[0] ?? null,
    });
  }
  decks.sort((a, b) => b.due - a.due);
  return { ok: true, total_due: decks.reduce((n, d) => n + d.due, 0), decks };
}

export async function recordReview(
  deps: Pick<ServerDeps, "now">,
  ctx: AuthContext,
  req: z.infer<typeof ReviewRequestSchema>,
): Promise<{ ok: true; item_id: string; card: Flashcard; due_count: number }> {
  const item = await loadDeck(ctx, req.item_id);
  const now = deps.now();
  const cards = currentCards(item, now);
  const i = cards.findIndex((c) => c.id === req.card_id);
  if (i < 0) throw notFound(t("Card not found"));
  cards[i] = reviewCard(cards[i]!, req.grade, now);
  await updateItem(ctx.client, ctx.userId, item.id, { flashcards: cards as unknown as Json });
  return {
    ok: true,
    item_id: item.id,
    card: cards[i]!,
    due_count: cards.filter((c) => isDue(c, now)).length,
  };
}
