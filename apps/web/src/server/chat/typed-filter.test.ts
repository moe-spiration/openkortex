import { describe, expect, it } from "vitest";
import { filteredSources } from "./retrieval";
import { parseTypedFilter } from "./typed-filter";
import type { AuthContext } from "../auth";

describe("parseTypedFilter", () => {
  it.each([
    ["Welche Filme will ich sehen?", { type: "movie", status: "to_watch" }],
    ["Welche Filme habe ich schon gesehen?", { type: "movie", status: "watched" }],
    ["Welche Serien habe ich noch nicht gesehen", { type: "movie", status: "to_watch" }],
    ["Welche Bücher will ich lesen?", { type: "book", status: "want_to_read" }],
    ["Welche Bücher habe ich gelesen", { type: "book", status: "read" }],
    ["Was lese ich gerade für ein Buch?", { type: "book", status: "reading" }],
    ["Welche Produkte stehen auf meiner Wunschliste", { type: "product", status: "wishlist" }],
    ["Zeig mir alle Filme", { type: "movie", status: null }],
  ])("%s", (q, expected) => {
    expect(parseTypedFilter(q)).toEqual(expected);
  });

  it("leaves ordinary questions to the hybrid search", () => {
    expect(parseTypedFilter("Was steht im Buch über Stoizismus zu Gelassenheit?")).toBeNull();
    expect(parseTypedFilter("Wie funktioniert RLS in Supabase?")).toBeNull();
    expect(parseTypedFilter("Film Empfehlungen für Mathe Nachhilfe")).toBeNull();
  });
});

describe("filteredSources", () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "contains", "order"])
      b[m] = (...a: unknown[]) => (calls.push([m, ...a]), b);
    b.limit = async () => ({ data: rows, error: null });
    return b;
  };
  const ctx = (rows: unknown[]) =>
    ({ userId: "u1", client: { from: () => builder(rows) } }) as unknown as AuthContext;

  it("filters by type and metadata.status and returns the items as sources", async () => {
    calls.length = 0;
    const out = await filteredSources(
      ctx([
        {
          id: "i1",
          title: "Dune",
          type: "movie",
          summary: "Sci-Fi",
          content_md: "",
          folder_path: "30_Clippings/Movies",
          source_url: null,
          metadata: { status: "to_watch", year: 2021, genres: ["scifi"] },
        },
      ]),
      { type: "movie", status: "to_watch" },
      8,
    );
    expect(calls).toContainEqual(["eq", "type", "movie"]);
    expect(calls).toContainEqual(["contains", "metadata", { status: "to_watch" }]);
    expect(calls).toContainEqual(["eq", "user_id", "u1"]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ item_id: "i1", title: "Dune" });
    expect(out[0]?.text).toContain("status: to_watch");
  });

  it("returns nothing when no item matches (caller falls back to hybrid search)", async () => {
    expect(await filteredSources(ctx([]), { type: "book", status: null }, 8)).toEqual([]);
  });
});
