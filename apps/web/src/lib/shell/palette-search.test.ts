import { describe, expect, it } from "vitest";
import { hitFromSearch, mergePaletteHits } from "./palette-search";

const h = (id: string) => ({ id, title: id.toUpperCase(), hint: "" });

describe("palette search", () => {
  it("shows local hits until the server answers", () => {
    expect(mergePaletteHits([h("a"), h("b")], null).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("puts hybrid hits first and keeps unseen local ones, without duplicates", () => {
    expect(mergePaletteHits([h("a"), h("b")], [h("c"), h("a")], 3).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(mergePaletteHits([h("a")], []).map((x) => x.id)).toEqual(["a"]);
  });

  it("maps a search result, passage before folder", () => {
    expect(hitFromSearch({ item_id: "1", title: "T", type: "movie", folder_path: "30_Clippings/Movies", snippet: "" })).toEqual({ id: "1", title: "T", type: "movie", hint: "30_Clippings/Movies" });
    expect(hitFromSearch({ item_id: "1", title: "T", type: "note", folder_path: null, snippet: "x".repeat(120) }).hint).toHaveLength(90);
  });
});
