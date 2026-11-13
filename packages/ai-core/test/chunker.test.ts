import { describe, expect, it } from "vitest";
import { chunkDocument, estimateTokens, splitMarkdownSections } from "../src/enrichment/chunker";

const sentence = (i: number) =>
  `Satz ${i} beschreibt die Architektur von Kortex mit Supabase und MCP im Detail.`;
const paragraph = (from: number, n: number) =>
  Array.from({ length: n }, (_, k) => sentence(from + k)).join(" ");

describe("splitMarkdownSections", () => {
  it("splits at headings, keeps heading paths and ignores headings in code fences", () => {
    const md =
      "Vorwort\n\n# Teil 1\nA\n## Kapitel 1.1\nB\n```md\n# kein Heading\n```\n## Kapitel 1.2\nC\n# Teil 2\nD";
    expect(splitMarkdownSections(md).map((s) => s.heading)).toEqual([
      null,
      "Teil 1",
      "Teil 1 > Kapitel 1.1",
      "Teil 1 > Kapitel 1.2",
      "Teil 2",
    ]);
  });
});

describe("chunkDocument", () => {
  const longDoc = `# Architektur\n\n${paragraph(0, 30)}\n\n${paragraph(30, 30)}\n\n${paragraph(60, 30)}\n\n# Betrieb\n\n${paragraph(90, 10)}`;
  const chunks = chunkDocument({ title: "Kortex Handbuch", type: "note", contentMd: longDoc });

  it("keeps every chunk within 800 tokens and fills them to roughly 500+", () => {
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.tokenEstimate).toBeLessThanOrEqual(800);
    const architektur = chunks.filter((c) => c.heading === "Architektur");
    // All but the last chunk of a long section are reasonably full.
    for (const c of architektur.slice(0, -1)) expect(c.tokenEstimate).toBeGreaterThanOrEqual(500);
  });

  it("overlaps consecutive chunks of a section by ~15%", () => {
    const [a, b] = chunks.filter((c) => c.heading === "Architektur");
    expect(a && b).toBeTruthy();
    const tail = a!.content.slice(-Math.floor(a!.content.length * 0.1));
    expect(b!.content.startsWith(tail.trim()) || b!.content.includes(tail.trim())).toBe(true);
    const overlap = estimateTokens(b!.content.split("\n\n")[0] ?? "");
    expect(overlap / a!.tokenEstimate).toBeGreaterThan(0.1);
    expect(overlap / a!.tokenEstimate).toBeLessThan(0.2);
  });

  it("never overlaps across headings and prefixes the document header", () => {
    const betrieb = chunks.find((c) => c.heading === "Betrieb");
    expect(betrieb?.content.startsWith("# Betrieb")).toBe(true);
    expect(betrieb?.text).toBe(
      `Dokument: Kortex Handbuch\nTyp: note\nAbschnitt: Betrieb\n\n${betrieb?.content}`,
    );
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("merges small heading sections up to the target size", () => {
    const md = "# A\nkurz\n\n# B\nauch kurz\n\n# C\nnoch kürzer";
    const out = chunkDocument({ title: "T", type: "note", contentMd: md });
    expect(out).toHaveLength(1);
    expect(out[0]?.heading).toBe("A");
    expect(out[0]?.content).toBe("# A\nkurz\n\n# B\nauch kurz\n\n# C\nnoch kürzer");
  });

  it("keeps page and timestamp sections separate with their locator", () => {
    const out = chunkDocument({
      title: "Report",
      type: "pdf",
      contentMd: "ignored when structural chunks exist",
      structuralChunks: [
        { heading: "Einleitung", pageOrTimestamp: "Page 1", text: "kurze Seite" },
        { heading: "Einleitung", pageOrTimestamp: "Page 2", text: paragraph(0, 80) },
        { pageOrTimestamp: "Page 3", text: "   " },
      ],
    });
    expect(out.map((c) => c.pageOrTimestamp)).toEqual([
      "Page 1",
      ...new Array(out.length - 1).fill("Page 2"),
    ]);
    expect(out[0]?.content).toBe("kurze Seite");
    expect(out[0]?.text).toContain("Position: Page 1");
    expect(out.every((c) => c.pageOrTimestamp !== "Page 3")).toBe(true);
    expect(out.filter((c) => c.pageOrTimestamp === "Page 2").length).toBeGreaterThan(1);
  });

  it("hard-splits a single huge paragraph without whitespace", () => {
    const out = chunkDocument({ title: "T", type: "note", contentMd: "x".repeat(10_000) });
    expect(out.length).toBeGreaterThan(2);
    for (const c of out) expect(c.tokenEstimate).toBeLessThanOrEqual(800);
  });

  it("returns nothing for empty content", () => {
    expect(chunkDocument({ title: "T", type: "note", contentMd: "  \n " })).toEqual([]);
  });
});
