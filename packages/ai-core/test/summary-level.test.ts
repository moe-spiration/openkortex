import { describe, expect, it } from "vitest";
import { takeawaysPrompt } from "../src/adapters/ai-chat.adapter";
import { DEFAULT_SUMMARY_LEVEL, SUMMARY_LEVELS } from "../src/adapters/base-adapter";
import { normalizeEnrichment, type OrganizeInput } from "../src/enrichment/auto-organizer";
import { renderOrganizerPrompt } from "../src/prompts/organizer";

// Feedback C1: the clipper's "Detailgrad" (summary_level) reaches the prompts.
const vars = { existingClusters: [], existingTags: [], existingObjects: [], manualPlacement: false };
const raw = {
  title: "T",
  summary: "S",
  key_points: Array.from({ length: 12 }, (_, i) => `Punkt ${i + 1}`),
  cluster_name: null,
  suggested_folder_path: null,
  placement_confidence: null,
  tags: [],
  entities: [],
  action_items: [],
};
const input = (summaryLevel?: "concise" | "detailed"): OrganizeInput => ({
  type: "article",
  sourcePlatform: "web",
  contentMd: "x",
  isManualPlacement: false,
  summaryLevel,
});
const ctx = { existingTags: [], existingClusters: [], existingObjects: [] };

describe("summary level", () => {
  it("defaults to concise", () => {
    expect(SUMMARY_LEVELS).toEqual(["concise", "detailed"]);
    expect(DEFAULT_SUMMARY_LEVEL).toBe("concise");
    expect(renderOrganizerPrompt(vars)).toBe(renderOrganizerPrompt({ ...vars, summaryLevel: "concise" }));
    expect(renderOrganizerPrompt(vars)).toContain(
      '"summary": A 2-3 sentence executive summary (TL;DR) capturing the core insight, decision, or utility. Write it',
    );
    expect(renderOrganizerPrompt(vars)).not.toMatch(/\{\{\w+\}\}/);
  });

  it("detailed asks for more and keeps up to 10 key points", () => {
    const p = renderOrganizerPrompt({ ...vars, summaryLevel: "detailed" });
    expect(p).toContain("detailed summary of 5-8 sentences");
    expect(p).toContain('"pdf" or "epub": 6 to 10 short key points');
    expect(normalizeEnrichment(raw as never, input(), ctx as never).keyPoints).toHaveLength(7);
    expect(normalizeEnrichment(raw as never, input("detailed"), ctx as never).keyPoints).toHaveLength(10);
  });

  it("varies the chat takeaways prompt", () => {
    expect(takeawaysPrompt()).toContain("1-2 Sätze");
    expect(takeawaysPrompt("detailed")).toContain("4-6 Sätze");
    expect(takeawaysPrompt("detailed")).toContain("6-10 Key Takeaways");
  });
});
