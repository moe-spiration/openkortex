// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks } from "./markdown";
import { kortexSchema, type KortexEditorPartialBlock } from "./schema";

const DOC = `---
title: Editor Round Trip
---

# Executive Summary

Text mit **fett**, *kursiv*, ~~durch~~, \`code\`, [Link](https://example.com) und [[Projekt Alpha|Alpha]].

## Kernpunkte

- Punkt eins
  - Unterpunkt
- Punkt zwei

1. Erstens
2. Zweitens

## Action Items

- [ ] Offen
- [x] Erledigt

> Ein Zitat.

> [!note]
> Hinweis

> [!ai] KI-Zusammenfassung
> Kurzfassung.

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
| - | :-: |
| 1 | [[X\\|y]] |

![Diagramm](https://example.com/d.png "Abbildung")

![[Neue Unterseite]]

---

<div>roh</div>
`;

/** Strips ids and BlockNote's default props so editor blocks compare to parsed blocks. */
function project(blocks: readonly unknown[]): unknown[] {
  return markdownToBlocks(blocksToMarkdown(blocks as never)).blocks;
}

describe("BlockNote editor round trip (headless, jsdom)", () => {
  it("loads markdown into the editor and serializes it back unchanged", () => {
    const { frontmatter, blocks } = markdownToBlocks(DOC);
    const editor = BlockNoteEditor.create({
      schema: kortexSchema,
      initialContent: blocks as unknown as KortexEditorPartialBlock[],
    });
    const doc = editor.document;
    expect(blocksToMarkdown(doc, frontmatter)).toBe(DOC);
    expect(project(doc)).toEqual(blocks);
    expect(doc.find((b) => b.type === "subpage")?.props).toMatchObject({
      target: "Neue Unterseite",
    });
  });

  it("serializes edits made through the editor API", () => {
    const editor = BlockNoteEditor.create({ schema: kortexSchema });
    editor.replaceBlocks(editor.document, [
      { type: "heading", props: { level: 2 }, content: "Neuer Abschnitt" },
      { type: "checkListItem", content: "Neue Aufgabe" },
      { type: "callout", content: "Wichtiger Hinweis für später." },
      {
        type: "codeBlock",
        props: { language: "shell" },
        content: "kortex sync --vault ~/KortexVault",
      },
      { type: "aiSummary", content: "Die Notiz wird für Dich zusammengefasst" },
      {
        type: "paragraph",
        content: [
          "Siehe ",
          { type: "wikiLink", props: { target: "Vault Backend", alias: "" } },
          { type: "text", text: " jetzt", styles: { bold: true } },
        ],
      },
    ]);
    expect(blocksToMarkdown(editor.document)).toBe(
      [
        "## Neuer Abschnitt",
        "- [ ] Neue Aufgabe",
        "> [!note]\n> Wichtiger Hinweis für später.",
        "```shell\nkortex sync --vault ~/KortexVault\n```",
        "> [!ai] KI-Zusammenfassung\n> Die Notiz wird für Dich zusammengefasst",
        "Siehe [[Vault Backend]] **jetzt**",
      ].join("\n\n") + "\n",
    );
  });
});
