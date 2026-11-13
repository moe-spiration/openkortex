import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks, type KortexPartialBlock } from "./markdown";

// A-17: canonical fixtures (callout, toggle, task, table, underline). Load → save → load must give
// the identical text, and a second pass must change nothing.
// Loaded raw by Vite (the package has no Node types; vitest resolves import.meta.glob).
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}
const FILES = Object.fromEntries(
  Object.entries(
    import.meta.glob("./fixtures/*.md", { query: "?raw", import: "default", eager: true }),
  ).map(([p, md]) => [p.replace("./fixtures/", ""), md]),
);
const FIXTURES = Object.keys(FILES);
const fixture = (name: string) => FILES[name]!;

const save = (md: string) => {
  const { frontmatter, blocks } = markdownToBlocks(md);
  return blocksToMarkdown(blocks, frontmatter);
};

describe("canonical fixtures round trip (A-17)", () => {
  it("covers callout, toggle, tasks, table and underline", () => {
    expect(FIXTURES.sort()).toEqual([
      "callout.md",
      "table.md",
      "tasks.md",
      "toggle.md",
      "underline.md",
    ]);
  });

  it.each(FIXTURES)("%s: load, save, load gives identical text", (file: string) => {
    const md = fixture(file);
    const once = save(md);
    expect(once).toBe(md);
    expect(save(once)).toBe(md);
    // No block fell back to raw Markdown: everything is modelled.
    const raw = (blocks: readonly KortexPartialBlock[]): boolean =>
      blocks.some((b) => b.type === "rawMarkdown" || raw(b.children ?? []));
    expect(raw(markdownToBlocks(md).blocks)).toBe(false);
  });
});

describe("toggle blocks (K4: > [!toggle]- Titel)", () => {
  const blocks = markdownToBlocks(fixture("toggle.md")).blocks;

  it("title is the block text, the body lines are child blocks", () => {
    expect(blocks[0]).toEqual({
      type: "toggle",
      props: { fold: "-" },
      content: [{ type: "text", text: "Alternativen zu Freemium", styles: {} }],
      children: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Abo mit Testphase oder Einmalkauf.", styles: {} }],
        },
      ],
    });
    expect(blocks[1]!.children!.map((c) => c.type)).toEqual([
      "paragraph",
      "bulletListItem",
      "bulletListItem",
      "checkListItem",
    ]);
    expect(blocks[1]!.children![2]!.children![0]).toMatchObject({ type: "bulletListItem" });
  });

  it("keeps the fold marker, formatting and links in the title", () => {
    expect(blocks[2]).toMatchObject({ type: "toggle", props: { fold: "+" } });
    expect(blocks[2]!.type === "toggle" && blocks[2]!.content).toEqual([
      { type: "text", text: "Schon offen mit ", styles: {} },
      { type: "text", text: "Format", styles: { bold: true } },
      { type: "text", text: " und ", styles: {} },
      { type: "wikiLink", props: { target: "Pricing", alias: "" } },
    ]);
  });

  it("untitled, nested, empty and list-nested toggles", () => {
    expect(blocks[3]).toMatchObject({
      type: "toggle",
      content: [],
      children: [{ type: "heading" }, { type: "paragraph" }],
    });
    expect(blocks[4]!.children![1]).toMatchObject({
      type: "toggle",
      children: [{ type: "paragraph" }],
    });
    expect(blocks[5]).toEqual({
      type: "toggle",
      props: { fold: "-" },
      content: [{ type: "text", text: "Leer", styles: {} }],
    });
    expect(blocks[6]!.children![0]).toMatchObject({
      type: "toggle",
      children: [{ type: "paragraph" }],
    });
  });

  it("a new toggle from the editor is written closed by default", () => {
    const md = blocksToMarkdown([
      {
        type: "toggle",
        props: { fold: "-" },
        content: [{ type: "text", text: "Neu", styles: {} }],
        children: [{ type: "paragraph", content: [{ type: "text", text: "Body", styles: {} }] }],
      },
    ]);
    expect(md).toBe("> [!toggle]- Neu\n> Body\n");
  });

  it("a body that starts with a table or a setext-looking line gets an empty > line first", () => {
    const md = blocksToMarkdown([
      {
        type: "toggle",
        props: { fold: "-" },
        content: [{ type: "text", text: "T", styles: {} }],
        children: [
          {
            type: "table",
            content: {
              type: "tableContent",
              headerRows: 1,
              rows: [
                {
                  cells: [
                    {
                      type: "tableCell",
                      props: {},
                      content: [{ type: "text", text: "a", styles: {} }],
                    },
                  ],
                },
                {
                  cells: [
                    {
                      type: "tableCell",
                      props: {},
                      content: [{ type: "text", text: "1", styles: {} }],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(md).toBe("> [!toggle]- T\n>\n> | a |\n> | - |\n> | 1 |\n");
    expect(save(md)).toBe(md);
  });

  it("other [!kinds] and plain quotes are unchanged", () => {
    expect(markdownToBlocks("> [!note]- Zu\n> Text\n").blocks[0]).toMatchObject({
      type: "callout",
      props: { fold: "-" },
    });
    expect(markdownToBlocks("> \\[!toggle]- kein Toggle\n").blocks[0]).toMatchObject({
      type: "quote",
    });
  });
});

describe("underline (K3: <u>…</u>)", () => {
  it("parses balanced <u> pairs into the underline style", () => {
    const { blocks } = markdownToBlocks("a <u>b **c**</u> d\n");
    expect(blocks[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "a ", styles: {} },
        { type: "text", text: "b ", styles: { underline: true } },
        { type: "text", text: "c", styles: { underline: true, bold: true } },
        { type: "text", text: " d", styles: {} },
      ],
    });
  });

  it("serializes the underline style as <u>", () => {
    expect(
      blocksToMarkdown([
        {
          type: "paragraph",
          content: [{ type: "text", text: "unter", styles: { underline: true } }],
        },
      ]),
    ).toBe("<u>unter</u>\n");
  });

  it("unbalanced or other inline HTML stays raw Markdown (lossless)", () => {
    for (const md of ["nur <u>offen\n", "<b>fett</b>\n", "zu</u> spät\n"]) {
      expect(markdownToBlocks(md).blocks[0]).toMatchObject({ type: "rawMarkdown" });
      expect(save(md)).toBe(md);
    }
  });
});
