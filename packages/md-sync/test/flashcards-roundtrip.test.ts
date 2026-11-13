import { afterEach, describe, expect, it } from "vitest";
import { parseFlashcardsSection, withFlashcardsSection } from "@kortex/ai-core";
import { parseMarkdown } from "../src/frontmatter";
import { createHarness, type Harness } from "./helpers";

// Portable Markdown (backlog #7): der Karteikarten-Abschnitt im content_md landet lesbar im Vault,
// ein Edit in der Datei kommt unverändert zurück und parst zu denselben Karten.

let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

describe("flashcards markdown roundtrip", () => {
  it("cloud -> vault -> edit -> cloud keeps the section parseable", async () => {
    h = await createHarness();
    await h.engine.start();
    await h.settle();
    const cards = [
      { question: "Was kombiniert RRF?", answer: "Volltext- und Vektor-Rankings" },
      { question: "Wofür steht RLS?", answer: "Row Level Security" },
    ];
    const item = h.store.seedItem({
      title: "Hybrid Search",
      slug: "hybrid-search",
      folder_path: "10_Notes",
      content_md: withFlashcardsSection("# Hybrid Search\n\nRRF und RLS.", cards),
    });
    await h.settle();
    const rel = "10_Notes/hybrid-search.md";
    const body = parseMarkdown(await h.read(rel)).body;
    expect(body).toContain(
      "## Karteikarten\n\n- **F:** Was kombiniert RRF?\n  **A:** Volltext- und Vektor-Rankings",
    );
    expect(parseFlashcardsSection(body)).toEqual(cards);

    // The user edits an answer and adds a card in the vault.
    const edited = (await h.read(rel))
      .replace("**A:** Row Level Security", "**A:** Row Level Security (pro Nutzer)")
      .concat("\n- **F:** Was ist MCP?\n  **A:** Model Context Protocol\n");
    await h.write(rel, edited);
    await h.engine.handleLocalFile(rel);
    await h.settle();
    const stored = (await h.store.getItem(item.id))?.content_md ?? "";
    expect(parseFlashcardsSection(stored)).toEqual([
      cards[0],
      { question: "Wofür steht RLS?", answer: "Row Level Security (pro Nutzer)" },
      { question: "Was ist MCP?", answer: "Model Context Protocol" },
    ]);
    expect(stored.startsWith("# Hybrid Search\n\nRRF und RLS.")).toBe(true);
  });
});
