import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks } from "./markdown";
import { nestSections } from "./sections";

const MD = [
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

describe("nestSections (folded chapters)", () => {
  it("nests each section under its heading; the table of contents stays open and flat", () => {
    const blocks = nestSections(markdownToBlocks(MD).blocks) as Array<{
      type: string;
      props?: { isToggleable?: boolean };
      children?: Array<{ type: string; children?: unknown[] }>;
    }>;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "bulletListItem", "bulletListItem", "heading", "heading"]);
    expect(blocks[0]!.props?.isToggleable).toBeUndefined();
    expect(blocks[3]!.props?.isToggleable).toBe(true);
    expect(blocks[3]!.children!.map((c) => c.type)).toEqual(["paragraph", "heading"]);
    expect(blocks[3]!.children![1]!.children).toHaveLength(1);
    expect(blocks[4]!.children).toHaveLength(1);
  });

  it("writes byte-identical Markdown back (portable)", () => {
    const { blocks } = markdownToBlocks(MD);
    expect(blocksToMarkdown(nestSections(blocks))).toBe(blocksToMarkdown(blocks));
  });

  it("a single H1 (title) is not folded, several H1 chapters are", () => {
    const one = nestSections(markdownToBlocks("# Titel\n\nIntro\n\n## A\n\nx\n").blocks);
    expect(one.map((b) => b.type)).toEqual(["heading", "paragraph", "heading"]);
    const two = nestSections(markdownToBlocks("# A\n\nx\n\n# B\n\ny\n").blocks);
    expect(two).toHaveLength(2);
  });
});
