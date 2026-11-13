// @vitest-environment jsdom
import { BlockNoteEditor, filterSuggestionItems } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { getBridge } from "./bridge";
import { blocksToMarkdown, markdownToBlocks } from "./markdown";
import { slashItems } from "./menus";
import { kortexSchema, type KortexEditorPartialBlock } from "./schema";
import { nestSections } from "./sections";

const BOOK = [
  "## Inhaltsverzeichnis",
  "",
  "- Kapitel 1",
  "- Kapitel 2",
  "",
  "## Kapitel 1",
  "",
  "Text eins.",
  "",
  "### Abschnitt 1.1",
  "",
  "Text eins-eins.",
  "",
  "## Kapitel 2",
  "",
  "Text zwei.",
  "",
].join("\n");

describe("folded chapters in the real editor (headless, jsdom)", () => {
  it("chapters become toggle headings and the editor writes the same Markdown back", () => {
    const { blocks } = markdownToBlocks(BOOK);
    const editor = BlockNoteEditor.create({
      schema: kortexSchema,
      initialContent: nestSections(blocks) as unknown as KortexEditorPartialBlock[],
    });
    const doc = editor.document;
    const chapter = doc.find((b) => b.type === "heading" && b.children.length > 0);
    expect(chapter?.props).toMatchObject({ isToggleable: true });
    expect(doc[0]?.props).toMatchObject({ isToggleable: false }); // table of contents stays open
    expect(blocksToMarkdown(doc)).toBe(blocksToMarkdown(blocks));
  });
});

describe("slash \"Daily Note (heute)\"", () => {
  it("is offered when the host links daily notes and inserts a [[Wiki-Link]] to today's note", async () => {
    const editor = BlockNoteEditor.create({ schema: kortexSchema });
    expect(slashItems(editor as never).some((i) => i.key === "daily-note")).toBe(false);
    getBridge(editor).set({ wikiTargets: [], onDailyNote: () => ({ id: "d1", title: "Daily Journal 2026-11-03" }) });
    const hits = filterSuggestionItems(slashItems(editor as never), "daily");
    expect(hits[0]?.key).toBe("daily-note");
    editor.setTextCursorPosition(editor.document[0]!, "end");
    hits[0]!.onItemClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(blocksToMarkdown(editor.document)).toContain("[[Daily Journal 2026-11-03]]");
  });
});
