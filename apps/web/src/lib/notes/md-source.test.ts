import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "@/lib/workspace-data";
import { markdownSource, yamlScalar } from "./md-source";

const item = (over: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  id: "n1",
  type: "article",
  title: "Local-First: Software",
  path: "30_Clippings/Tech/local-first.md",
  date: "2026-10-29",
  time: "09:12",
  tags: ["#ai/mcp", "#kortex"],
  tldr: "Daten gehören dem Nutzer.",
  links: [],
  contentMd: "# Local-First: Software\n\n**TL;DR:** Daten gehören dem Nutzer.\n\nText.\n",
  cover: null,
  actionItems: [],
  metadata: { duration: "12 min", key_takeaways: ["A", "B"] },
  manualPlacement: false,
  folderSuggestion: null,
  source: { url: "https://example.com/lf" },
  ...over,
});

describe("Markdown-Quelle (raw vault file from the metadata)", () => {
  it("builds the frontmatter from the item in md-sync order", () => {
    const src = markdownSource(item());
    expect(src.path).toBe("30_Clippings/Tech/local-first.md");
    expect(src.frontmatter.split("\n")).toEqual([
      "---",
      "id: n1",
      'title: "Local-First: Software"',
      "type: article",
      'source_ref: "https://example.com/lf"',
      "folder_path: 30_Clippings/Tech",
      'tags: ["#ai/mcp", "#kortex"]',
      'created_at: "2026-10-29T09:12"',
      "summary: Daten gehören dem Nutzer.",
      "metadata:",
      "  duration: 12 min",
      "  key_takeaways: [A, B]",
      "---",
    ]);
  });

  it("marks the hidden H1 and TL;DR, the rest stays verbatim", () => {
    const src = markdownSource(item());
    expect(src.marked).toBe("# Local-First: Software\n\n**TL;DR:** Daten gehören dem Nutzer.\n\n");
    expect(src.rest).toBe("Text.\n");
  });

  it("shows existing frontmatter in content_md as written, and nothing marked without a head", () => {
    const src = markdownSource(item({ contentMd: "---\nid: x\n---\nNur Text." }));
    expect(src.frontmatter).toBe("---\nid: x\n---");
    expect(src.marked).toBe("");
    expect(src.rest).toBe("Nur Text.");
  });

  it("leaves out empty fields", () => {
    const src = markdownSource(item({ tldr: "", source: undefined, metadata: {} }));
    expect(src.frontmatter).not.toMatch(/summary|source_ref|metadata/);
  });

  it("quotes YAML scalars only when needed", () => {
    expect(yamlScalar("plain text")).toBe("plain text");
    expect(yamlScalar("a: b")).toBe('"a: b"');
    expect(yamlScalar("true")).toBe('"true"');
    expect(yamlScalar("12")).toBe('"12"');
    expect(yamlScalar("#tag")).toBe('"#tag"');
    expect(yamlScalar(3)).toBe("3");
    expect(yamlScalar(null)).toBe("null");
  });
});
