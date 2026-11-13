// Portable-Markdown-Spiegel der Karteikarten (backlog #7): `knowledge_items.flashcards` (JSON mit
// SRS-Zustand) steht zusätzlich als lesbarer, rückparsbarer Abschnitt im content_md der Notiz:
//
//   ## Karteikarten
//
//   - **F:** Was kombiniert RRF?
//     **A:** Volltext- und Vektor-Rankings
//
// Frage/Antwort kommen aus dem Markdown (auch Vault-Edits), der Lernzustand bleibt im JSON.
//
// English accounts write `## Flashcards` with `- **Q:** …` / `**A:** …`; the reader accepts both
// forms (the pairs live in ../i18n/content.ts).

import { headingRe, ph, phAlt } from "../i18n";
import { mergeCards, newCard, type Flashcard } from "./index";

/** German heading (the original). `flashcardsHeading()` is the heading in the user's language. */
export const FLASHCARDS_HEADING = "## Karteikarten";
export const flashcardsHeading = (): string => `## ${ph("flashcards")}`;

export interface CardText {
  question: string;
  answer: string;
}

const HEADING_RE = headingRe("flashcards");
const QUESTION_RE = new RegExp(`^[-*]\\s+\\*\\*${phAlt("flashcardQuestion")}:\\*\\*\\s*(.*)$`);
const ANSWER_RE = new RegExp(`^\\s*\\*\\*${phAlt("flashcardAnswer")}:\\*\\*\\s*(.*)$`);

/** [start, end) of the section incl. heading; null without one. Ends at the next `#`/`##` heading. */
function sectionRange(md: string): [number, number] | null {
  const m = HEADING_RE.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = /^#{1,2} /m.exec(rest);
  return [m.index, next ? m.index + m[0].length + next.index : md.length];
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

/** The section for these cards (empty string for none). */
export function renderFlashcardsSection(cards: readonly CardText[]): string {
  const items = cards
    .filter((c) => c.question.trim() && c.answer.trim())
    .map((c) => {
      const answer = c.answer.trim().replace(/\r\n?/g, "\n").split("\n");
      return [
        `- **${ph("flashcardQuestion")}:** ${oneLine(c.question)}`,
        `  **${ph("flashcardAnswer")}:** ${answer[0]}`,
        ...answer.slice(1).map((l) => `  ${l}`),
      ]
        .join("\n")
        .replace(/[ \t]+$/gm, "");
    });
  return items.length ? `${flashcardsHeading()}\n\n${items.join("\n\n")}\n` : "";
}

/** Cards of the section; null when the note has none (then the JSON stays as it is). */
export function parseFlashcardsSection(md: string): CardText[] | null {
  const range = sectionRange(md.replace(/\r\n?/g, "\n"));
  if (!range) return null;
  const body = md.replace(/\r\n?/g, "\n").slice(range[0], range[1]).split("\n").slice(1);
  const cards: CardText[] = [];
  let cur: { q: string[]; a: string[] | null } | null = null;
  const flush = () => {
    if (cur && cur.a) {
      const question = cur.q.join(" ").trim();
      const answer = cur.a.join("\n").trim();
      if (question && answer) cards.push({ question, answer });
    }
  };
  for (const line of body) {
    const q = QUESTION_RE.exec(line);
    if (q) {
      flush();
      cur = { q: [q[1] ?? ""], a: null };
      continue;
    }
    if (!cur) continue;
    const a = ANSWER_RE.exec(line);
    if (a) cur.a = [a[1] ?? ""];
    else if (cur.a) cur.a.push(line.replace(/^ {2}/, ""));
    else if (line.trim()) cur.q.push(line.trim());
  }
  flush();
  return cards;
}

/** content_md without the section (what the generator and the reader see as the note itself). */
export function stripFlashcardsSection(md: string): string {
  const range = sectionRange(md);
  if (!range) return md;
  const rest = [md.slice(0, range[0]).trimEnd(), md.slice(range[1]).trim()].filter(Boolean);
  return rest.length ? `${rest.join("\n\n")}\n` : "";
}

/** Replaces (or appends, or with no cards removes) the section; the rest of the note is untouched. */
export function withFlashcardsSection(md: string, cards: readonly CardText[]): string {
  const section = renderFlashcardsSection(cards);
  const range = sectionRange(md);
  if (!range) return section ? `${md.trimEnd()}${md.trim() ? "\n\n" : ""}${section}` : md;
  const before = md.slice(0, range[0]).trimEnd();
  const after = md.slice(range[1]).trim();
  return [before, section.trimEnd(), after].filter(Boolean).join("\n\n") + "\n";
}

/**
 * The deck after the Markdown changed (vault edit): Q/A from the section, review state kept for
 * cards whose question is unchanged, edited answers taken over, removed cards dropped.
 */
export function cardsFromSection(
  existing: Flashcard[],
  section: readonly CardText[],
  now: Date,
): Flashcard[] {
  return mergeCards(
    existing,
    section.map((c) => newCard(c.question, c.answer, now, "vault")),
    "replace",
  );
}
