import { describe, expect, it } from "vitest";
import { validateTypeMetadata } from "@kortex/db/type-registry";
import { mergeMeta, metaLink, metaValue } from "../src/data/meta";

describe("Eigenschaften metadata", () => {
  it("merges and removes keys with null, keeps other fields", () => {
    expect(mergeMeta({ status: "reading", isbn: "978" }, { status: "read", rating: 8 })).toEqual({ status: "read", isbn: "978", rating: 8 });
    expect(mergeMeta({ status: "read", rating: 8 }, { rating: null })).toEqual({ status: "read" });
    expect(mergeMeta(null, { status: "owned" })).toEqual({ status: "owned" });
  });

  it("the merged result passes the registry schema (lenient keeps adapter fields)", () => {
    const merged = mergeMeta({ isbn: "978-3", ingest: { source: "x" } }, { status: "reading", rating: 6 });
    expect(validateTypeMetadata("book", merged, { lenient: true }).ok).toBe(true);
    expect(validateTypeMetadata("book", mergeMeta({}, { status: "watched" }), { lenient: true }).ok).toBe(false);
  });

  it("formats values and links", () => {
    expect(metaValue(["Drama", "Krimi"])).toBe("Drama, Krimi");
    expect(metaValue(12.5)).toBe("12.5");
    expect(metaValue([{ url: "https://a", title: "A" }])).toBe("A");
    expect(metaLink("imdb_id", "tt0111161")).toBe("https://www.imdb.com/title/tt0111161/");
    expect(metaLink("isbn", "978")).toBeNull();
    expect(metaLink("url", "https://shop.example/x")).toBe("https://shop.example/x");
  });
});
