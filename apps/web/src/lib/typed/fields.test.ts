import { describe, expect, it } from "vitest";
import { NEW_TYPED_TYPES, validateTypeMetadata } from "@kortex/db";
import { parseTypedValue, typedFieldsOf, typedInput, typedMetadata } from "./fields";

describe("typed fields from the type registry", () => {
  it("derives status (enum from the registry), typed fields, rating and feedback", () => {
    const movie = typedFieldsOf("movie");
    expect(movie[0]).toMatchObject({ key: "status", kind: "enum", options: ["to_watch", "watched"] });
    expect(movie.find((f) => f.key === "imdb_id")).toMatchObject({ kind: "text", label: "IMDb-ID" });
    expect(movie.find((f) => f.key === "year")).toMatchObject({ kind: "number", min: 1880, max: 2200 });
    expect(movie.find((f) => f.key === "genres")).toMatchObject({ kind: "list" });
    expect(movie.find((f) => f.key === "pitch")).toMatchObject({ kind: "longtext" });
    expect(movie.slice(-2).map((f) => f.key)).toEqual(["rating", "feedback"]);
    expect(typedFieldsOf("book").map((f) => f.key)).toEqual(expect.arrayContaining(["status", "author", "isbn"]));
    expect(typedFieldsOf("receipt").find((f) => f.key === "date")).toMatchObject({ kind: "date" });
  });

  it("skips structured fields and free types", () => {
    expect(typedFieldsOf("product").some((f) => f.key === "specs")).toBe(false);
    expect(typedFieldsOf("session").map((f) => f.key)).toEqual(["rating", "feedback"]);
    expect(typedFieldsOf("note")).toEqual([]);
    expect(typedFieldsOf("person")).toEqual([]); // domain objects have their own pills
    expect(typedFieldsOf(undefined)).toEqual([]);
    for (const t of NEW_TYPED_TYPES) expect(typedFieldsOf(t).length, t).toBeGreaterThan(0);
  });

  it("parses inputs into values the registry schema accepts", () => {
    const f = (t: string, k: string) => typedFieldsOf(t).find((x) => x.key === k)!;
    const ok = (t: string, k: string, input: string) => {
      const r = parseTypedValue(f(t, k), input);
      expect(r.ok).toBe(true);
      const v = (r as { value: unknown }).value;
      expect(validateTypeMetadata(t, { [k]: v }).ok).toBe(true);
      return v;
    };
    expect(ok("product", "price", "1.299,90")).toBe(1299.9);
    expect(ok("movie", "genres", "Drama, Sci-Fi ,")).toEqual(["Drama", "Sci-Fi"]);
    expect(ok("movie", "status", "watched")).toBe("watched");
    expect(ok("receipt", "date", "2026-10-31")).toBe("2026-10-31");
    expect(parseTypedValue(f("movie", "rating"), "11")).toMatchObject({ ok: false });
    expect(parseTypedValue(f("movie", "status"), "gesehen")).toMatchObject({ ok: false });
    expect(parseTypedValue(f("movie", "director"), "  ")).toEqual({ ok: true, value: undefined });
    expect(typedInput(f("product", "price"), 4.5)).toBe("4,5");
  });

  it("keeps only schema fields of stored metadata", () => {
    expect(typedMetadata("movie", { status: "watched", placement: { x: 1 }, imdb_id: "tt1" })).toEqual({ status: "watched", imdb_id: "tt1" });
    expect(typedMetadata("note", { a: 1 })).toEqual({});
  });
});
