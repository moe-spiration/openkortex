import { describe, expect, it } from "vitest";
import { answerNote, citedNumbers, parseAnswer, parseInline } from "./answer-format";

describe("parseInline", () => {
  it("splits citations, bold, code and links", () => {
    expect(parseInline("Checksums **SHA-256** [1, 3] via `md-sync` [2] [Docs](https://x.dev)")).toEqual([
      { t: "text", v: "Checksums " },
      { t: "b", c: [{ t: "text", v: "SHA-256" }] },
      { t: "text", v: " " },
      { t: "cite", n: 1 },
      { t: "cite", n: 3 },
      { t: "text", v: " via " },
      { t: "code", v: "md-sync" },
      { t: "text", v: " " },
      { t: "cite", n: 2 },
      { t: "text", v: " " },
      { t: "link", href: "https://x.dev", c: [{ t: "text", v: "Docs" }] },
    ]);
  });

  it("leaves half-streamed markup as text", () => {
    expect(parseInline("Das ist **wich")).toEqual([{ t: "text", v: "Das ist **wich" }]);
    expect(parseInline("Quelle [1")).toEqual([{ t: "text", v: "Quelle [1" }]);
  });
});

describe("parseAnswer", () => {
  it("builds headings, lists, quotes and code blocks", () => {
    const blocks = parseAnswer("## Ergebnis\n\nErster Satz\nzweiter Satz [1].\n\n- a [2]\n- b\n\n1. x\n2. y\n\n> Zitat\n\n```\ncode\n```");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol", "quote", "pre"]);
    expect(blocks[1]).toMatchObject({ t: "p" });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("collects cited numbers in order", () => {
    expect(citedNumbers("A [2]. B [1][2].\n\n- C [3]")).toEqual([2, 1, 3]);
  });
});

describe("answerNote (Als Notiz speichern)", () => {
  it("question as title, answer as body, cited sources as numbered wiki links", () => {
    const n = answerNote("Was habe ich über Preisgestaltung gesammelt?", "Freemium [1] und Tests vor dem Launch [3].", [
      { n: 1, title: "App monetarisieren" },
      { n: 2, title: "Nicht zitiert" },
      { n: 3, title: "Preisgestaltung [Podcast]" },
    ]);
    expect(n.title).toBe("Was habe ich über Preisgestaltung gesammelt");
    expect(n.body).toBe(
      "> Was habe ich über Preisgestaltung gesammelt?\n\nFreemium [1] und Tests vor dem Launch [3].\n\n## Quellen\n\n1. [[App monetarisieren]]\n3. [[Preisgestaltung Podcast]]",
    );
  });

  it("without sources no list; long questions are cut", () => {
    const n = answerNote("x".repeat(200), "Antwort");
    expect(n.title).toHaveLength(120);
    expect(n.body.endsWith("Antwort")).toBe(true);
    expect(n.body).not.toContain("Quellen");
  });
});
