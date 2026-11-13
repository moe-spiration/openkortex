import { describe, expect, it } from "vitest";
import {
  autoFormat,
  backspaceAtStart,
  block,
  convert,
  inlineSegments,
  insertedNewline,
  normalize,
  numberOf,
  parse,
  serialize,
  setIndent,
  slashMatches,
  slashQuery,
  splitAt,
  type Block,
} from "../src/lib/blocks";

const types = (b: Block[]) => b.map((x) => x.type);

describe("markdown ⇄ blocks", () => {
  const md = [
    "# Titel",
    "",
    "Ein Absatz mit **fett** und _kursiv_.",
    "Zweite Zeile im selben Absatz.",
    "",
    "## Aufgaben",
    "",
    "- [ ] offen",
    "- [x] erledigt",
    "  - [ ] Unterpunkt",
    "",
    "1. eins",
    "2. zwei",
    "",
    "> Zitat",
    "> weiter",
    "",
    "```ts",
    "const a = 1;",
    "",
    "console.log(a);",
    "```",
    "",
    "---",
    "",
    "![Skizze](https://example.com/a.png)",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
  ].join("\n");

  it("parses every block type", () => {
    const b = parse(md);
    expect(types(b)).toEqual(["h1", "p", "h2", "check", "check", "check", "number", "number", "quote", "code", "divider", "image", "raw"]);
    expect(b[1]!.text).toBe("Ein Absatz mit **fett** und _kursiv_.\nZweite Zeile im selben Absatz.");
    expect(b[4]!.checked).toBe(true);
    expect(b[5]!.indent).toBe(1);
    expect(b[8]!.text).toBe("Zitat\nweiter");
    expect(b[9]).toMatchObject({ lang: "ts", text: "const a = 1;\n\nconsole.log(a);" });
    expect(b[11]).toMatchObject({ text: "Skizze", url: "https://example.com/a.png" });
  });

  it("round-trips clean markdown unchanged", () => {
    expect(serialize(parse(md))).toBe(md);
    expect(normalize(normalize(md))).toBe(normalize(md));
  });

  it("normalizes cosmetic variants", () => {
    expect(normalize("* a\n* b\n\n3) c\n7) d")).toBe("- a\n- b\n\n1. c\n2. d\n");
    expect(normalize("#### tief")).toBe("### tief\n");
    expect(normalize("")).toBe("");
  });

  it("keeps front matter verbatim and skips empty paragraphs", () => {
    const b = parse("---\ntitle: x\n---\nText");
    expect(types(b)).toEqual(["raw", "p"]);
    expect(serialize([...b, block("p", "")])).toBe("---\ntitle: x\n---\n\nText\n");
  });
});

describe("editing", () => {
  it("detects a single typed newline", () => {
    expect(insertedNewline("abcd", "ab\ncd")).toBe(2);
    expect(insertedNewline("ab", "abc")).toBeNull();
    expect(insertedNewline("ab", "ab\n\n")).toBeNull();
    // Keyboard autocorrect commits the word together with Enter.
    expect(insertedNewline("ich teh", "ich the\n")).toBe(7);
    expect(insertedNewline("a\nteh x", "a\nthe\n x")).toBe(5);
  });

  it("splits a block and continues lists", () => {
    const b = [block("check", "Milch kaufen", { checked: true, indent: 0 })];
    const r = splitAt(b, 0, 5);
    expect(r.blocks.map((x) => [x.type, x.text, x.checked])).toEqual([
      ["check", "Milch", true],
      ["check", " kaufen", false],
    ]);
    expect(r.focus).toEqual({ id: r.blocks[1]!.id, pos: 0 });
    const h = splitAt([block("h2", "Titel")], 0, 5);
    expect(types(h.blocks)).toEqual(["h2", "p"]);
  });

  it("leaves a list on Enter in an empty item (outdents first)", () => {
    const nested = splitAt([block("bullet", "a"), block("bullet", "", { indent: 1 })], 1, 0);
    expect(nested.blocks[1]!.indent).toBe(0);
    const flat = splitAt([block("bullet", "a"), block("bullet", "", { indent: 0 })], 1, 0);
    expect(flat.blocks[1]!.type).toBe("p");
  });

  it("backspace at start lifts formatting, then merges", () => {
    const b = [block("p", "eins"), block("bullet", "zwei")];
    const lifted = backspaceAtStart(b, 1)!;
    expect(lifted.blocks[1]!.type).toBe("p");
    const merged = backspaceAtStart(lifted.blocks, 1)!;
    expect(merged.blocks.map((x) => x.text)).toEqual(["einszwei"]);
    expect(merged.focus).toEqual({ id: b[0]!.id, pos: 4 });
    expect(backspaceAtStart([block("p", "x")], 0)).toBeNull();
    const afterRule = backspaceAtStart([block("divider"), block("p", "x")], 1)!;
    expect(types(afterRule.blocks)).toEqual(["p"]);
  });

  it("turns markdown shortcuts into blocks", () => {
    expect(autoFormat(block("p", "## Ziel"))).toMatchObject({ type: "h2", text: "Ziel" });
    expect(autoFormat(block("p", "[] Aufgabe"))).toMatchObject({ type: "check", text: "Aufgabe", checked: false });
    expect(autoFormat(block("p", "- [x] fertig"))).toMatchObject({ type: "check", checked: true });
    expect(autoFormat(block("p", "- "))).toMatchObject({ type: "bullet", text: "" });
    expect(autoFormat(block("p", "1. "))).toMatchObject({ type: "number" });
    expect(autoFormat(block("p", "---"))).toMatchObject({ type: "divider" });
    expect(autoFormat(block("p", "Hallo - Welt"))).toBeNull();
    expect(autoFormat(block("h2", "# x"))).toBeNull();
    // "## " inside a checklist item or bullet makes a heading, without the checkbox.
    const h = autoFormat(block("check", "## Ziel", { checked: true, indent: 1 }))!;
    expect(h).toMatchObject({ type: "h2", text: "Ziel" });
    expect(h.checked).toBeUndefined();
    expect(h.indent).toBeUndefined();
    expect(autoFormat(block("bullet", "# Titel", { indent: 0 }))).toMatchObject({ type: "h1", text: "Titel" });
    expect(autoFormat(block("check", "- x", { checked: false, indent: 0 }))).toBeNull();
  });

  it("converts types and keeps a text block after atoms", () => {
    const r = convert([block("p", "/trenn")], 0, "divider");
    expect(types(r.blocks)).toEqual(["divider", "p"]);
    expect(r.focus?.id).toBe(r.blocks[1]!.id);
    expect(convert([block("p", "a\nb")], 0, "h1").blocks[0]!.text).toBe("a b");
  });

  it("indents only under a list item", () => {
    const b = [block("bullet", "a", { indent: 0 }), block("bullet", "b", { indent: 0 })];
    expect(setIndent(b, 1, 1)[1]!.indent).toBe(1);
    expect(setIndent(setIndent(b, 1, 1), 1, 1)[1]!.indent).toBe(1);
    expect(setIndent(b, 0, 1)[0]!.indent).toBe(0);
  });

  it("numbers runs per indent", () => {
    const b = [block("number", "a"), block("number", "b"), block("number", "b1", { indent: 1 }), block("number", "c"), block("p", "x"), block("number", "neu")];
    expect(b.map((x, i) => (x.type === "number" ? numberOf(b, i) : 0))).toEqual([1, 2, 1, 3, 0, 1]);
    expect(serialize(b)).toBe("1. a\n2. b\n  1. b1\n3. c\n\nx\n\n1. neu\n");
  });
});

describe("slash menu", () => {
  it("reads the query and filters kinds", () => {
    expect(slashQuery(block("p", "/che"))).toBe("che");
    expect(slashQuery(block("p", "/"))).toBe("");
    expect(slashQuery(block("p", "a/b"))).toBeNull();
    expect(slashMatches("che").map((k) => k.type)).toEqual(["check"]);
    expect(slashMatches("über").map((k) => k.type)).toEqual(["h1", "h2", "h3"]);
    expect(slashMatches("").length).toBeGreaterThan(8);
  });
});

describe("inline segments", () => {
  it("covers the text exactly and styles the marks", () => {
    const t = "a **b** _c_ `d` [[e]] [f](https://x.y) ~~g~~ *h*";
    const s = inlineSegments(t);
    expect(s.map((x) => x.text).join("")).toBe(t);
    expect(s.filter((x) => x.bold).map((x) => x.text)).toEqual(["b"]);
    expect(s.filter((x) => x.italic).map((x) => x.text)).toEqual(["c", "h"]);
    expect(s.filter((x) => x.code).map((x) => x.text)).toEqual(["d"]);
    expect(s.filter((x) => x.link).map((x) => x.text)).toEqual(["e", "f"]);
    expect(s.filter((x) => x.strike).map((x) => x.text)).toEqual(["g"]);
    expect(inlineSegments("snake_case_name")).toEqual([{ text: "snake_case_name" }]);
  });
});
