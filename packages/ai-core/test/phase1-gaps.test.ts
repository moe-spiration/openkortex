import { describe, expect, it } from "vitest";
import { firstImage, readingMinutes } from "../src/adapters/web-article.adapter";
import { normalizeEnrichment, resolveFolderPath, type Enrichment } from "../src/enrichment/auto-organizer";
import { anthropicListPrice } from "../src/providers/catalog";

describe("web article metadata (Doc 01 A2)", () => {
  it("estimates reading time from words, ignoring image/link markup", () => {
    expect(readingMinutes("wort ".repeat(660))).toBe(3);
    expect(readingMinutes("![Bild](https://x.test/a.png) kurz")).toBe(1);
  });

  it("takes the first content image as hero-cover fallback, skipping SVGs", () => {
    expect(firstImage("Text ![logo](https://x.test/logo.svg) ![Hero](https://x.test/hero.jpg \"t\")")).toBe("https://x.test/hero.jpg");
    expect(firstImage("no images here")).toBeUndefined();
  });
});

describe("Anthropic list prices (catalog has none)", () => {
  it("prices by family, older Haiku generations cheaper, unknown lines null", () => {
    expect(anthropicListPrice("fx-haiku-new")).toEqual({ input_per_mtok: 1, output_per_mtok: 5 });
    expect(anthropicListPrice("vendor-3-haiku-2024")).toEqual({ input_per_mtok: 0.25, output_per_mtok: 1.25 });
    expect(anthropicListPrice("vendor-3-5-haiku-2024")).toEqual({ input_per_mtok: 0.8, output_per_mtok: 4 });
    expect(anthropicListPrice("fx-sonnet-new")).toEqual({ input_per_mtok: 3, output_per_mtok: 15 });
    expect(anthropicListPrice("fx-opus-new")).toEqual({ input_per_mtok: 15, output_per_mtok: 75 });
    expect(anthropicListPrice("fx-other")).toBeNull();
    expect(anthropicListPrice("claude-haiku-5-5")).toEqual({ input_per_mtok: 0.1, output_per_mtok: 0.5 });
    expect(anthropicListPrice("claude-sonnet-5-5")).toEqual({ input_per_mtok: 2, output_per_mtok: 10 });
    expect(anthropicListPrice("claude-sonnet-5")).toEqual({ input_per_mtok: 2, output_per_mtok: 10 });
    expect(anthropicListPrice("claude-opus-5-5")).toEqual({ input_per_mtok: 4, output_per_mtok: 20 });
    expect(anthropicListPrice("claude-opus-4-8")).toEqual({ input_per_mtok: 5, output_per_mtok: 25 });
    expect(anthropicListPrice("claude-haiku-4-5")).toEqual({ input_per_mtok: 1, output_per_mtok: 5 });
  });
});

describe("domain objects always land in their type folder", () => {
  it("ignores a translated folder suggestion for objects", () => {
    expect(resolveFolderPath("70_Objects/Personen", "person")).toBe("70_Objects/People");
    expect(resolveFolderPath("10_Notes", "goal")).toBe("70_Objects/Goals");
  });

  it("keeps the confidence for objects (folder mismatch is not doubt)", () => {
    const raw: Enrichment = {
      title: "Sven Krüger",
      summary: "CTO bei AutoCorp.",
      cluster_name: null,
      suggested_folder_path: "70_Objects/Personen",
      placement_confidence: 0.9,
      tags: ["automotive/it", "kontakte/kunden"],
      entities: [],
      action_items: [],
    };
    const r = normalizeEnrichment(raw, { type: "person", sourcePlatform: "manual", contentMd: "x", isManualPlacement: false }, { existingTags: [], existingClusters: [], existingObjects: [] });
    expect(r.folderPath).toBe("70_Objects/People");
    expect(r.placementConfidence).toBe(0.9);
  });
});
