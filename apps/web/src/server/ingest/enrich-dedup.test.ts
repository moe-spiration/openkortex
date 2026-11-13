import { describe, expect, it } from "vitest";
import { dedupKeys, findDuplicateIn, planMerge, type DedupItem } from "@kortex/db";
import { enrichedCandidate } from "./enrich-dedup";

// S16: after enrichment resolved an IMDb id / ISBN, an existing item with the same id is merged.
const existing = {
  id: "old",
  type: "movie",
  title: "The Matrix",
  source_url: null,
  source_url_norm: null,
  content_hash: null,
  content_md: "# The Matrix",
  tags: ["scifi"],
  metadata: { imdb_id: "tt0133093", director: "Lana Wachowski" },
} as unknown as DedupItem;

const row = {
  type: "movie",
  title: "Matrix",
  content_md: "# Matrix",
  metadata: {
    imdb_id: "TT0133093",
    year: 1999,
    director: "Someone Else",
    enrichment: { source: "omdb", confidence: 0.7 },
  },
  tags: ["film"],
};

describe("enrichedCandidate", () => {
  it("is null for un-enriched items and other types", () => {
    expect(enrichedCandidate({ ...row, metadata: { imdb_id: "tt1" } }, "new")).toBeNull();
    expect(enrichedCandidate({ ...row, type: "note" }, "new")).toBeNull();
  });

  it("finds the existing item by external id and merges without overwriting", async () => {
    const c = enrichedCandidate(row, "new");
    expect(c).not.toBeNull();
    const keys = await dedupKeys(c!);
    const hit = findDuplicateIn([existing], c!, keys);
    expect(hit).toMatchObject({ item: { id: "old" }, reason: "external_id" });

    const patch = planMerge(existing, c!, keys);
    // Gaps are filled, existing values stay.
    expect(patch.metadata).toMatchObject({ year: 1999, director: "Lana Wachowski" });
    expect(patch.tags).toEqual(expect.arrayContaining(["scifi", "film"]));
  });

  it("never matches itself", async () => {
    const c = enrichedCandidate(row, "old")!;
    expect(findDuplicateIn([existing], c, await dedupKeys(c))).toBeNull();
  });
});
