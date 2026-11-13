import { describe, expect, it } from "vitest";
import {
  cardsFromSection,
  newCard,
  parseFlashcardsSection,
  renderFlashcardsSection,
  reviewCard,
  stripFlashcardsSection,
  withFlashcardsSection,
} from "../src/flashcards";

const NOW = new Date("2026-10-31T10:00:00.000Z");
const cards = [
  { question: "Was kombiniert RRF?", answer: "Volltext- und Vektor-Rankings" },
  { question: "Wofür steht\nRLS?", answer: "Row Level Security\n- je Nutzer\n- in Postgres" },
];

describe("flashcards markdown mirror", () => {
  it("renders a readable section that parses back to the same cards", () => {
    const section = renderFlashcardsSection(cards);
    expect(section).toBe(
      "## Karteikarten\n\n" +
        "- **F:** Was kombiniert RRF?\n  **A:** Volltext- und Vektor-Rankings\n\n" +
        "- **F:** Wofür steht RLS?\n  **A:** Row Level Security\n  - je Nutzer\n  - in Postgres\n",
    );
    expect(parseFlashcardsSection(section)).toEqual([
      cards[0],
      { question: "Wofür steht RLS?", answer: "Row Level Security\n- je Nutzer\n- in Postgres" },
    ]);
  });

  it("replaces the section in place and leaves the rest of the note untouched", () => {
    const note =
      "# Hybrid Search\n\nText.\n\n## Karteikarten\n\n- **F:** alt\n  **A:** alt\n\n## Quellen\n\n- x\n";
    const next = withFlashcardsSection(note, cards.slice(0, 1));
    expect(next).toBe(
      "# Hybrid Search\n\nText.\n\n## Karteikarten\n\n- **F:** Was kombiniert RRF?\n  **A:** Volltext- und Vektor-Rankings\n\n## Quellen\n\n- x\n",
    );
    expect(withFlashcardsSection("Text.", cards.slice(0, 1))).toMatch(
      /^Text\.\n\n## Karteikarten\n/,
    );
    expect(stripFlashcardsSection(next)).toBe("# Hybrid Search\n\nText.\n\n## Quellen\n\n- x\n");
    expect(withFlashcardsSection(next, [])).toBe(stripFlashcardsSection(next));
    expect(parseFlashcardsSection("# Ohne Karten")).toBeNull();
  });

  it("a vault edit keeps the review state of unchanged questions", () => {
    const reviewed = reviewCard(newCard("Was kombiniert RRF?", "Rankings", NOW), "good", NOW);
    const dropped = newCard("Weg", "damit", NOW);
    const next = cardsFromSection(
      [reviewed, dropped],
      [
        { question: "Was kombiniert RRF?", answer: "Volltext + Vektor" },
        { question: "Neu?", answer: "Ja" },
      ],
      NOW,
    );
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: reviewed.id, reps: 1, answer: "Volltext + Vektor" });
    expect(next[1]).toMatchObject({ question: "Neu?", reps: 0, source: "vault" });
  });
});
