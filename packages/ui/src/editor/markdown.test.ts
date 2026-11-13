import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  markdownToBlocks,
  splitFrontmatter,
  type KortexPartialBlock,
} from "./markdown";

const roundTrip = (md: string) => {
  const { frontmatter, blocks } = markdownToBlocks(md);
  return blocksToMarkdown(blocks, frontmatter);
};

/** Canonical documents: `blocksToMarkdown(markdownToBlocks(md))` must reproduce them exactly. */
const CANONICAL: Record<string, string> = {
  "meeting note with frontmatter": `---
title: Q4 Architektur-Sync
type: meeting
tags: [automotive/it, sync]
created: 2026-10-22T09:05:00Z
---

# Executive Summary

Vorbereitung auf den Q4-Sync mit **zwei offenen** Action Items aus dem letzten Call mit [[Sven Müller|Sven]].

## Kernpunkte

- SHA-256 Checksum pro Datei
- Konflikte als \`.conflict.md\` ablegen
- Zeitplan für *Q4* mit [[Projekt Vault]] abstimmen

## Action Items

- [ ] Checksum-Konzept an Sven senden
- [x] Agenda verschicken
`,
  "headings and inline styles": `# Titel

## Abschnitt

### Unterabschnitt

Text mit **fett**, *kursiv*, ~~durch~~, \`code\`, [Link](https://example.com) und **fett *und kursiv***.

Zweite Zeile
mit weichem Umbruch.
`,
  "nested lists": `- Ebene 1
  - Ebene 2
    - Ebene 3
  - Zurück auf 2
- Wieder 1

1. Erstens
2. Zweitens
   1. Zwei-a
   2. Zwei-b
3. Drittens

- [ ] Aufgabe
  - [x] Teilaufgabe erledigt
  - Notiz zur Aufgabe
`,
  "ordered list with start": `3. drei
4. vier
`,
  table: `| Tool | Zweck | Status |
| - | :-: | -: |
| Supabase | Datenbank | **live** |
| [[MCP Server]] | Agenten | \`beta\` |
`,
  "callouts and ai summary": `> [!note]
> Wichtiger Hinweis für später.

> [!warning] Achtung
> Erste Zeile
> zweite Zeile

> [!ai] KI-Zusammenfassung
> Die Notiz beschreibt das **Sync-Protokoll** und verlinkt [[Vault Backend]].
`,
  "quote and code": `> Ein Zitat mit *Betonung*.

\`\`\`ts
const x = 1;
console.log(x);
\`\`\`

\`\`\`
kortex sync --vault ~/KortexVault
\`\`\`
`,
  "wikilinks with aliases": `Siehe [[Projekt Alpha]], [[Personen/Anna Schmidt|Anna]] und [[Notiz#Abschnitt|den Abschnitt]].
`,
  "subpage embed and image": `Einleitung.

![[Neue Unterseite]]

![[Archiv/2025 Planung|Planung]]

![Architektur-Diagramm](https://example.com/diagram.png "Abbildung 1")

![](https://example.com/x.png)
`,
  "unicode and umlauts": `# Größenänderung & Übermaß

Äpfel, Öl, Übung, ß – „Anführungszeichen“ und emoji 🚀 sowie 日本語.

- Straße
- Café
`,
  "raw html and footnotes": `Absatz mit Fußnote[^1].

<details>
<summary>Mehr</summary>
Versteckter Inhalt.
</details>

[^1]: Die Fußnote selbst.

#### Tiefe Überschrift

$$
E = mc^2
$$
`,
  "divider and code fence with backticks": `Oben

---

\`\`\`\`md
\`\`\`js
x
\`\`\`
\`\`\`\`
`,
  "list item with nested blocks": `- Punkt mit Details

  Ein zweiter Absatz im Punkt.

  \`\`\`sh
  pnpm install
  \`\`\`
- Nächster Punkt
`,
  "nested raw html in list": `- Punkt
  - Unterpunkt

  <div class="x">
  roh
  </div>
`,
  "empty todo and escapes": `- [ ]
- [x] erledigt

Sternchen \\* und Unterstrich in snake_case, eckige \\[Klammern] und \\[\\[keine Wiki]].
`,
  "frontmatter only": `---
title: Leer
---
`,
};

describe("markdown round trip (canonical docs are fixed points)", () => {
  for (const [name, md] of Object.entries(CANONICAL)) {
    it(name, () => {
      expect(roundTrip(md)).toBe(md);
    });
  }

  it("empty document", () => {
    expect(markdownToBlocks("")).toEqual({ frontmatter: null, blocks: [] });
    expect(blocksToMarkdown([])).toBe("");
  });
});

describe("markdownToBlocks structure", () => {
  it("maps the meeting note", () => {
    const { frontmatter, blocks } = markdownToBlocks(CANONICAL["meeting note with frontmatter"]!);
    expect(frontmatter).toMatch(/^---\ntitle: Q4/);
    expect(frontmatter!.endsWith("---\n\n")).toBe(true);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "bulletListItem",
      "bulletListItem",
      "bulletListItem",
      "heading",
      "checkListItem",
      "checkListItem",
    ]);
    expect(blocks[1]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Vorbereitung auf den Q4-Sync mit ", styles: {} },
        { type: "text", text: "zwei offenen", styles: { bold: true } },
        { type: "text", text: " Action Items aus dem letzten Call mit ", styles: {} },
        { type: "wikiLink", props: { target: "Sven Müller", alias: "Sven" } },
        { type: "text", text: ".", styles: {} },
      ],
    });
    expect(blocks[8]).toMatchObject({ type: "checkListItem", props: { checked: true } });
  });

  it("maps custom blocks", () => {
    const callouts = markdownToBlocks(CANONICAL["callouts and ai summary"]!).blocks;
    expect(callouts[0]).toEqual({
      type: "callout",
      props: { kind: "note", title: "", fold: "" },
      content: [{ type: "text", text: "Wichtiger Hinweis für später.", styles: {} }],
    });
    expect(callouts[1]).toMatchObject({
      type: "callout",
      props: { kind: "warning", title: "Achtung" },
    });
    expect(callouts[2]).toMatchObject({
      type: "aiSummary",
      props: { title: "KI-Zusammenfassung" },
    });

    const embeds = markdownToBlocks(CANONICAL["subpage embed and image"]!).blocks;
    expect(embeds[1]).toEqual({ type: "subpage", props: { target: "Neue Unterseite", alias: "" } });
    expect(embeds[2]).toEqual({
      type: "subpage",
      props: { target: "Archiv/2025 Planung", alias: "Planung" },
    });
    expect(embeds[3]).toEqual({
      type: "image",
      props: {
        url: "https://example.com/diagram.png",
        name: "Architektur-Diagramm",
        caption: "Abbildung 1",
      },
    });
  });

  it("keeps unsupported Markdown verbatim in rawMarkdown blocks", () => {
    const { blocks } = markdownToBlocks(CANONICAL["raw html and footnotes"]!);
    expect(blocks.map((b) => b.type)).toEqual([
      "rawMarkdown",
      "rawMarkdown",
      "rawMarkdown",
      "rawMarkdown",
      "paragraph",
    ]);
    expect(blocks[1]).toEqual({
      type: "rawMarkdown",
      content: "<details>\n<summary>Mehr</summary>\nVersteckter Inhalt.\n</details>",
    });
    expect(blocks[2]).toEqual({ type: "rawMarkdown", content: "[^1]: Die Fußnote selbst." });

    const nestedRaw = markdownToBlocks(CANONICAL["nested raw html in list"]!).blocks;
    expect(nestedRaw[0]?.children?.[1]).toEqual({
      type: "rawMarkdown",
      content: '<div class="x">\nroh\n</div>',
    });
  });

  it("nests list children", () => {
    const { blocks } = markdownToBlocks(CANONICAL["nested lists"]!);
    expect(blocks[0]?.children?.[0]?.children?.[0]).toMatchObject({ type: "bulletListItem" });
    expect(blocks[2]).toMatchObject({ type: "numberedListItem" });
    expect(markdownToBlocks(CANONICAL["ordered list with start"]!).blocks[0]).toMatchObject({
      props: { start: 3 },
    });
  });

  it("keeps escaped brackets as text", () => {
    const { blocks } = markdownToBlocks(CANONICAL["empty todo and escapes"]!);
    expect(blocks[0]).toEqual({ type: "checkListItem", props: { checked: false }, content: [] });
    expect(blocks[2]).toMatchObject({ type: "paragraph" });
    expect(
      (blocks[2] as { content: unknown[] }).content.every(
        (c) => (c as { type: string }).type === "text",
      ),
    ).toBe(true);
  });
});

describe("non-canonical input normalizes once, then is stable", () => {
  const cases: [string, string, string][] = [
    ["star bullets", "* a\n* b\n", "- a\n- b\n"],
    ["plus bullets", "+ a\n", "- a\n"],
    ["underscore strong/em", "__fett__ und _kursiv_\n", "**fett** und *kursiv*\n"],
    ["setext headings", "Titel\n=====\n\nSub\n---\n", "# Titel\n\n## Sub\n"],
    ["loose list", "- a\n\n- b\n", "- a\n- b\n"],
    ["4-space nesting", "- a\n    - b\n", "- a\n  - b\n"],
    ["indented code", "    code\n", "```\ncode\n```\n"],
    ["tilde fence", "~~~js\nx\n~~~\n", "```js\nx\n```\n"],
    ["CRLF line endings", "# T\r\n\r\ntext\r\n", "# T\n\ntext\n"],
    ["extra blank lines", "a\n\n\n\nb", "a\n\nb\n"],
    ["hard break", "a  \nb\n", "a\nb\n"],
    ["ordered with parens", "1) a\n2) b\n", "1. a\n2. b\n"],
    ["star thematic break", "a\n\n***\n\nb\n", "a\n\n---\n\nb\n"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      const once = roundTrip(input);
      expect(once).toBe(expected);
      expect(roundTrip(once)).toBe(once);
    });
  }
});

describe("blocks -> markdown -> blocks", () => {
  it("is stable for editor-shaped blocks", () => {
    const blocks: KortexPartialBlock[] = [
      {
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Neuer Abschnitt", styles: {} }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a", styles: { bold: true } },
          { type: "text", text: "b", styles: { bold: true, italic: true } },
          { type: "text", text: " ", styles: {} },
          {
            type: "link",
            href: "https://kortex.app",
            content: [{ type: "text", text: "Kortex", styles: { code: true } }],
          },
          { type: "text", text: " ", styles: {} },
          { type: "wikiLink", props: { target: "Ziel", alias: "" } },
        ],
      },
      {
        type: "checkListItem",
        props: { checked: false },
        content: [{ type: "text", text: "Neue Aufgabe", styles: {} }],
      },
      {
        type: "callout",
        props: { kind: "note", title: "", fold: "" },
        content: [{ type: "text", text: "Hinweis", styles: {} }],
      },
      {
        type: "aiSummary",
        props: { title: "KI-Zusammenfassung" },
        content: [{ type: "text", text: "Kurz.", styles: {} }],
      },
      {
        type: "codeBlock",
        props: { language: "shell" },
        content: "kortex sync --vault ~/KortexVault",
      },
      { type: "subpage", props: { target: "Neue Unterseite", alias: "" } },
      { type: "rawMarkdown", content: "<br>" },
      {
        type: "table",
        content: {
          type: "tableContent",
          headerRows: 1,
          rows: [
            { cells: [cell("A"), cell("B")] },
            {
              cells: [
                cell("1"),
                {
                  type: "tableCell",
                  props: {},
                  content: [{ type: "wikiLink", props: { target: "X", alias: "y" } }],
                },
              ],
            },
          ],
        },
      },
    ];
    const md = blocksToMarkdown(blocks);
    expect(markdownToBlocks(md).blocks).toEqual(blocks);
  });

  it("moves whitespace at mark edges out of the mark", () => {
    const md = blocksToMarkdown([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "fett ", styles: { bold: true } },
          { type: "text", text: "weiter", styles: {} },
          { type: "text", text: " und ", styles: { italic: true } },
          { type: "text", text: "beides", styles: { italic: true, bold: true } },
        ],
      },
    ]);
    expect(md).toBe("**fett** weiter *und **beides***\n");
    expect(blocksToMarkdown(markdownToBlocks(md).blocks)).toBe(md);
  });

  it("drops whitespace at block edges and around line breaks (typing leftovers)", () => {
    const md = blocksToMarkdown([
      { type: "paragraph", content: [{ type: "text", text: " Hallo \n Welt  ", styles: {} }] },
      { type: "paragraph", content: [{ type: "text", text: "   ", styles: {} }] },
    ]);
    expect(md).toBe("Hallo\nWelt\n");
  });

  it("flattens children of non-list blocks and drops empty paragraphs", () => {
    const md = blocksToMarkdown([
      {
        type: "paragraph",
        content: [{ type: "text", text: "p", styles: {} }],
        children: [{ type: "bulletListItem", content: "kind" }],
      },
      { type: "paragraph", content: [] },
      { type: "bulletListItem", content: "sibling" },
    ]);
    expect(md).toBe("p\n\n- kind\n- sibling\n");
  });

  it("re-emits frontmatter verbatim", () => {
    const fm = "---\r\na: 1\r\n---\r\n";
    expect(splitFrontmatter(`${fm}text`)).toEqual({ frontmatter: fm, body: "text" });
    expect(blocksToMarkdown([{ type: "paragraph", content: "x" }], fm)).toBe(`${fm}x\n`);
    // A thematic break at the top is not frontmatter.
    expect(splitFrontmatter("---\n\ntext\n\n---\n").frontmatter).toBeNull();
  });
});

function cell(text: string) {
  return {
    type: "tableCell" as const,
    props: {},
    content: [{ type: "text" as const, text, styles: {} }],
  };
}

describe("@-mention, mermaid and fence info roundtrips", () => {
  const roundtrip = (md: string) => blocksToMarkdown(markdownToBlocks(md).blocks, null);

  it("an @-inserted link is a plain [[Ziel|Alias]] in Markdown", () => {
    const md = "Frag [[Lea Hoffmann|Lea]] und [[Projekt Alpha]].\n";
    const { blocks } = markdownToBlocks(md);
    expect(JSON.stringify(blocks)).toContain('"wikiLink"');
    expect(roundtrip(md)).toBe(md);
  });

  it("a mermaid fence stays a standard fenced code block", () => {
    const md = "```mermaid\ngraph TD\n  A-->B\n```\n";
    const { blocks } = markdownToBlocks(md);
    expect(blocks[0]).toMatchObject({ type: "codeBlock", props: { language: "mermaid" }, content: "graph TD\n  A-->B" });
    expect(roundtrip(md)).toBe(md);
  });

  it("a fence with extra info degrades to a code block and keeps the info", () => {
    const md = '```ts title="a.ts" {1,3}\nconst a = 1;\n```\n';
    const { blocks } = markdownToBlocks(md);
    expect(blocks[0]).toMatchObject({ type: "codeBlock", props: { language: "ts", meta: 'title="a.ts" {1,3}' } });
    expect(roundtrip(md)).toBe(md);
  });
});
