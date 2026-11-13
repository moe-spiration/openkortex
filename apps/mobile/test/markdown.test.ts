import { describe, expect, it } from "vitest";
import { keyPointsOf, parseInline, parseMarkdown } from "../src/lib/markdown";
import { ingestError, pointsOf } from "../src/data/live";

describe("markdown", () => {
  it("parses blocks of a clipped article", () => {
    const md = [
      "---",
      "type: article",
      "---",
      "# Titel",
      "",
      "Erster **fetter** Satz mit [Link](https://a.de) und",
      "Fortsetzung.",
      "",
      "![Cover](https://img.de/a.jpg)",
      "- Punkt",
      "- [x] Erledigt",
      "1. Erstens",
      "> Zitat",
      "---",
      "Text ![](https://img.de/b.png) danach",
      "![rel](/relative.png)",
    ].join("\n");
    const b = parseMarkdown(md);
    expect(b.map((x) => x.kind)).toEqual(["heading", "para", "image", "bullet", "bullet", "bullet", "quote", "rule", "para", "image"]);
    expect(b[1]).toEqual({
      kind: "para",
      text: [{ text: "Erster " }, { text: "fetter", bold: true }, { text: " Satz mit " }, { text: "Link", href: "https://a.de" }, { text: " und Fortsetzung." }],
    });
    expect(b[4]).toMatchObject({ kind: "bullet", done: true });
    expect(b[5]).toMatchObject({ kind: "bullet", ordered: 1 });
  });

  it("handles wiki links and code", () => {
    expect(parseInline("[[Note|Alias]] `x`")).toEqual([{ text: "Alias", bold: true, wiki: "Note" }, { text: " " }, { text: "x", code: true }]);
  });

  it("keeps checklist items as tasks with their nesting", () => {
    const b = parseMarkdown("- [ ] offen\n- [x] erledigt\n  - [ ] Unterpunkt\n- Punkt\n    1. tief");
    expect(b).toMatchObject([
      { kind: "bullet", task: true, done: false },
      { kind: "bullet", task: true, done: true },
      { kind: "bullet", task: true, done: false, indent: 1 },
      { kind: "bullet" },
      { kind: "bullet", ordered: 1, indent: 2 },
    ]);
    expect(b[3]).not.toHaveProperty("task");
  });

  it("takes key points only from a key-point section", () => {
    expect(keyPointsOf("- Menü\n- Login\n## Text\n- egal")).toEqual([]);
    expect(keyPointsOf("# A\n- nav\n## Kernaussagen\n- Eins\n- Zwei\n## Weiter\n- nein")).toEqual(["Eins", "Zwei"]);
  });

  it("prefers adapter key points and explains failed extraction", () => {
    expect(pointsOf({ metadata: { takeaways: ["T1"] }, content_md: "" })).toEqual(["T1"]);
    expect(ingestError({ status: "error", metadata: { ingest: { error: "web-article: could not extract x (direct: content too short)" } } })).toMatch(/nicht auslesen/);
    expect(ingestError({ status: "processed", metadata: null })).toBeNull();
  });
});
