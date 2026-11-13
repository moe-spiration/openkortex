import { describe, expect, it } from "vitest";
import { bulkActions, clickSelect, EMPTY_SELECTION, menuFor, flattenMenu } from "@kortex/ui/menu-model";

// The mobile list menu and selection mode are built on the platform-free model of @kortex/ui.
describe("shared menu model on mobile", () => {
  it("resolves the platform-free subpath and gives the phone menu without split", () => {
    const ids = flattenMenu(menuFor({ kind: "item", split: false })).map((a) => a.id);
    expect(ids).toEqual(["open", "copy-link", "move", "tags", "favorite", "archive", "delete"]);
  });

  it("derives the selection bar actions", () => {
    expect(bulkActions("item", 3).map((a) => a.id)).toEqual(["move", "tags", "favorite", "archive", "delete"]);
  });

  it("selects rows like the web lists", () => {
    const s = clickSelect(clickSelect(EMPTY_SELECTION, "a", ["a", "b", "c"]), "c", ["a", "b", "c"], { shift: true });
    expect([...s.selected]).toEqual(["a", "b", "c"]);
  });
});
