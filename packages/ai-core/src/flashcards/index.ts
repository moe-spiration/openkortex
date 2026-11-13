import { byLocale } from "../i18n";
import { createHash } from "node:crypto";
import { generateText, Output } from "ai";
import { z } from "zod";
import { modelFor, type ModelRouter } from "../router/model-router";

/*
 * Flashcards from a note plus spaced repetition (SM-2 as in Anki: again / hard / good / easy).
 * Stored in knowledge_items.flashcards as an array. The older shape [{question, answer}] (chat
 * action "flashcards") stays readable: normalizeCards() adds the review fields.
 */

export const REVIEW_GRADES = ["again", "hard", "good", "easy"] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  created_at: string;
  /** "kortex" (generator), "copilot" (chat action), "user". */
  source: string;
  /** When the card is due next (ISO). */
  due_at: string;
  interval_days: number;
  /** SM-2 ease factor, 1.3 … 3.0 (start 2.5). */
  ease: number;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
}

export const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
/** "Again" brings a card back in this session. */
const RELEARN_MINUTES = 10;
const DAY = 86_400_000;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Stable id from the question (the same card keeps its id when generated again). */
export const cardId = (question: string) =>
  createHash("sha256").update(norm(question)).digest("hex").slice(0, 16);

export function newCard(question: string, answer: string, now: Date, source = "kortex"): Flashcard {
  return {
    id: cardId(question),
    question: question.trim(),
    answer: answer.trim(),
    created_at: now.toISOString(),
    source,
    due_at: now.toISOString(),
    interval_days: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    last_reviewed_at: null,
  };
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Any stored value → valid cards ([{question, answer}], [[q, a]] or full cards); junk is dropped. */
export function normalizeCards(raw: unknown, now: Date): Flashcard[] {
  if (!Array.isArray(raw)) return [];
  const out: Flashcard[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const r = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const question = Array.isArray(c) ? str(c[0]) : str(r.question);
    const answer = Array.isArray(c) ? str(c[1]) : str(r.answer);
    if (!question.trim() || !answer.trim()) continue;
    const base = newCard(question, answer, now, str(r.source) || "kortex");
    const card: Flashcard = {
      ...base,
      id: str(r.id) || base.id,
      created_at: str(r.created_at) || base.created_at,
      due_at: str(r.due_at) || str(r.created_at) || base.due_at,
      interval_days: Math.max(0, num(r.interval_days, 0)),
      ease: Math.min(MAX_EASE, Math.max(MIN_EASE, num(r.ease, DEFAULT_EASE))),
      reps: Math.max(0, Math.floor(num(r.reps, 0))),
      lapses: Math.max(0, Math.floor(num(r.lapses, 0))),
      last_reviewed_at: str(r.last_reviewed_at) || null,
    };
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}

/** SM-2 step for one answer. */
export function reviewCard(card: Flashcard, grade: ReviewGrade, now: Date): Flashcard {
  const at = now.toISOString();
  if (grade === "again") {
    return {
      ...card,
      reps: 0,
      lapses: card.lapses + 1,
      interval_days: 0,
      ease: Math.max(MIN_EASE, round2(card.ease - 0.2)),
      due_at: new Date(now.getTime() + RELEARN_MINUTES * 60_000).toISOString(),
      last_reviewed_at: at,
    };
  }
  const ease =
    grade === "hard"
      ? Math.max(MIN_EASE, card.ease - 0.15)
      : grade === "easy"
        ? Math.min(MAX_EASE, card.ease + 0.15)
        : card.ease;
  let interval: number;
  if (card.reps === 0) interval = grade === "hard" ? 1 : grade === "good" ? 1 : 4;
  else if (card.reps === 1) interval = grade === "hard" ? 2 : grade === "good" ? 3 : 6;
  else {
    const prev = Math.max(1, card.interval_days);
    interval =
      grade === "hard" ? prev * 1.2 : grade === "good" ? prev * card.ease : prev * card.ease * 1.3;
  }
  interval = Math.min(3650, Math.max(1, Math.round(interval)));
  return {
    ...card,
    reps: card.reps + 1,
    ease: round2(ease),
    interval_days: interval,
    due_at: new Date(now.getTime() + interval * DAY).toISOString(),
    last_reviewed_at: at,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const isDue = (card: Flashcard, now: Date) =>
  new Date(card.due_at).getTime() <= now.getTime();

/** New cards join the deck; a card with the same question keeps its review state. */
export function mergeCards(
  existing: Flashcard[],
  generated: Flashcard[],
  mode: "append" | "replace",
): Flashcard[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  if (mode === "replace")
    return generated.map((g) => (byId.has(g.id) ? { ...byId.get(g.id)!, answer: g.answer } : g));
  const out = [...existing];
  for (const g of generated) if (!byId.has(g.id)) out.push(g);
  return out;
}

export const FlashcardDraftSchema = z.object({
  flashcards: z.array(z.object({ question: z.string(), answer: z.string() })),
});

const SYSTEM_EN = `You create flashcards for spaced repetition from a note in the Second Brain Kortex.
Rules:
- One card tests exactly one fact, term, relation or step (atomic).
- The question is unambiguous and understandable without the note; the answer is short (1-2 sentences or a list of at most 5 points).
- Only content from the text, invent nothing. No questions about formatting, metadata or links.
- No duplicate or nearly identical cards. The most important content first.
- Language of the note (default English).
Deliver JSON { "flashcards": [{ "question", "answer" }] }.`;

const SYSTEM_DE = `Du erstellst Lernkarten (Flashcards) für Spaced Repetition aus einer Notiz im Second Brain Kortex.
Regeln:
- Eine Karte prüft genau einen Fakt, Begriff, Zusammenhang oder Schritt (atomar).
- Frage eindeutig und ohne die Notiz verständlich; Antwort kurz (1-2 Sätze oder eine Liste von max. 5 Punkten).
- Nur Inhalte aus dem Text, nichts erfinden. Keine Fragen zu Formatierung, Metadaten oder Links.
- Keine doppelten oder fast gleichen Karten. Die wichtigsten Inhalte zuerst.
- Sprache der Notiz (Standard Deutsch).
Liefere JSON { "flashcards": [{ "question", "answer" }] }.`;

export const FLASHCARD_TEXT_CHARS = 60_000;

/** Card drafts for a note (one model call on the `summarize` route). */
export async function generateFlashcards(
  models: ModelRouter,
  note: { title: string; contentMd: string; count: number; avoid?: string[] },
): Promise<{ question: string; answer: string }[]> {
  const avoid = (note.avoid ?? []).slice(0, 100);
  const { output } = await generateText({
    model: modelFor(models, "summarize"),
    system: byLocale({ en: SYSTEM_EN, de: SYSTEM_DE }),
    prompt: byLocale({
      en: [
        `Create up to ${note.count} cards.`,
        avoid.length
          ? `These questions already exist (do not repeat):\n${avoid.map((q) => `- ${q}`).join("\n")}`
          : null,
        `Title: ${note.title}`,
        `<note>\n${note.contentMd.slice(0, FLASHCARD_TEXT_CHARS)}\n</note>`,
      ],
      de: [
        `Erstelle bis zu ${note.count} Karten.`,
        avoid.length
          ? `Diese Fragen gibt es schon (nicht wiederholen):\n${avoid.map((q) => `- ${q}`).join("\n")}`
          : null,
        `Titel: ${note.title}`,
        `<notiz>\n${note.contentMd.slice(0, FLASHCARD_TEXT_CHARS)}\n</notiz>`,
      ],
    })
      .filter(Boolean)
      .join("\n\n"),
    output: Output.object({ schema: FlashcardDraftSchema, name: "flashcards" }),
    temperature: 0.3,
  });
  const seen = new Set(avoid.map(norm));
  return output.flashcards
    .map((c) => ({ question: c.question.trim(), answer: c.answer.trim() }))
    .filter(
      (c) => c.question && c.answer && !seen.has(norm(c.question)) && seen.add(norm(c.question)),
    )
    .slice(0, note.count);
}
export * from "./markdown";
