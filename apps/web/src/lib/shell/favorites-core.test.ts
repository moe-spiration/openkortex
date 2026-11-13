import { describe, expect, it } from "vitest";
import { insertFavorite, moveFavorite, orderFavorites } from "./favorites-core";

const items = ["a", "b", "c", "d"].map((id) => ({ id }));

describe("sidebar favourites order", () => {
  it("applies the stored order and appends unknown items in loaded order", () => {
    expect(orderFavorites(items, ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(orderFavorites(items, []).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(orderFavorites(items, ["x", "d"]).map((x) => x.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("moves an entry before the target index", () => {
    expect(moveFavorite(["a", "b", "c", "d"], "a", 4)).toEqual(["b", "c", "d", "a"]);
    expect(moveFavorite(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveFavorite(["a", "b", "c", "d"], "b", 3)).toEqual(["a", "c", "b", "d"]);
    expect(moveFavorite(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(moveFavorite(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });

  it("inserts a new favourite once", () => {
    expect(insertFavorite(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(insertFavorite(["a", "b"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(insertFavorite(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });
});
