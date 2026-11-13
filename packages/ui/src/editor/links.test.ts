import { describe, expect, it } from "vitest";
import { safeHref } from "./links";
import { blocksToMarkdown, markdownToBlocks } from "./markdown";

describe("safeHref (N5 #24)", () => {
  it("allows http(s), mailto and relative / internal targets", () => {
    for (const ok of ["https://kortex.app/x", "http://example.com", "mailto:a@b.de", "/notes/n1", "#abschnitt", "./datei.md", "../a/b.md", "notes/n2"])
      expect(safeHref(ok)).toBe(ok);
  });

  it("refuses script, data and other schemes, also when disguised", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "\u0001javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.example/x",
      "",
    ])
      expect(safeHref(bad)).toBeNull();
  });
});

describe("Markdown with unsafe links (N5 #24)", () => {
  it("keeps a javascript: link as source text, never as a link block", () => {
    const md = "Klick [hier](javascript:alert(1)) bitte.\n";
    const { blocks } = markdownToBlocks(md);
    const json = JSON.stringify(blocks);
    expect(json).not.toContain('"type":"link"');
    // Lossless: the text comes back unchanged.
    expect(blocksToMarkdown(blocks)).toBe(md);
  });

  it("still turns safe links into links", () => {
    const { blocks } = markdownToBlocks("Siehe [Doku](https://kortex.app/doku).\n");
    expect(JSON.stringify(blocks)).toContain('"href":"https://kortex.app/doku"');
  });

  it("writes an unsafe link held in the editor as its plain text", () => {
    const blocks = [
      {
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "Vor ", styles: {} },
          { type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "Falle", styles: {} }] },
          { type: "text", text: " nach.", styles: {} },
        ],
        children: [],
      },
    ];
    expect(blocksToMarkdown(blocks as never)).toBe("Vor Falle nach.\n");
  });
});
