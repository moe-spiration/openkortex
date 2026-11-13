import { withLocale } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import { bulkActions, flattenMenu, menuFor } from "./model";
import { EMPTY_SELECTION, clearSelection, clickSelect, pruneSelection, selectAll, targetsOf, toggleSelect } from "./selection";
import { isContextMenuKey, navigate, placeMenu } from "./keys";

const ids = (sections: ReturnType<typeof menuFor>) => flattenMenu(sections).map((a) => a.id);

describe("menuFor", () => {
  it("offers the full item menu in the planned order", () => {
    expect(ids(menuFor({ kind: "item" }))).toEqual(["open", "open-split", "copy-link", "move", "tags", "favorite", "archive", "delete"]);
  });

  it("flips favorite and archive according to the state", () => {
    const list = ids(menuFor({ kind: "item", favorite: true, archived: true }));
    expect(list).toContain("unfavorite");
    expect(list).toContain("unarchive");
    expect(list).not.toContain("favorite");
    expect(list).not.toContain("archive");
  });

  it("drops split where it does not exist", () => {
    expect(ids(menuFor({ kind: "item", split: false }))).not.toContain("open-split");
  });

  it("gives a selection the bulk variant with counts and no navigation", () => {
    const list = flattenMenu(menuFor({ kind: "item", count: 3 }));
    expect(list.map((a) => a.id)).toEqual(["move", "tags", "favorite", "archive", "delete"]);
    expect(list.find((a) => a.id === "delete")?.label).toBe("Löschen (3)");
    expect(list.find((a) => a.id === "move")?.label).toBe("Verschieben (3) …");
    expect(list.find((a) => a.id === "move")?.submenu).toBe("folders");
  });

  it("marks delete as the dangerous action", () => {
    expect(flattenMenu(menuFor({ kind: "item" })).find((a) => a.id === "delete")?.danger).toBe(true);
  });

  it("builds task menus around done / reopen", () => {
    expect(ids(menuFor({ kind: "task" }))).toEqual(["open", "open-split", "done", "delete"]);
    expect(ids(menuFor({ kind: "task", done: true, hasSource: false }))).toEqual(["reopen", "delete"]);
  });

  it("keeps folders and graph nodes small", () => {
    expect(ids(menuFor({ kind: "folder" }))).toEqual(["open", "open-split", "copy-link"]);
    expect(ids(menuFor({ kind: "graph-node" }))).toEqual(["open", "open-split", "copy-link", "favorite"]);
  });

  it("lets inbox rows accept, move or discard", () => {
    const list = flattenMenu(menuFor({ kind: "inbox" }));
    expect(list.map((a) => a.id)).toEqual(["accept", "open", "move", "delete"]);
    expect(list.at(-1)?.label).toBe("Verwerfen");
  });

  it("covers journal entries, Life areas and flashcard decks", () => {
    expect(ids(menuFor({ kind: "journal-entry" }))).toEqual(["open", "open-split", "copy-link", "export-note", "delete"]);
    expect(ids(menuFor({ kind: "life-area" }))).toEqual(["open", "open-split", "copy-link", "edit"]);
    expect(ids(menuFor({ kind: "life-area", hasSource: false, split: false }))).toEqual(["open", "copy-link", "edit"]);
    const deck = flattenMenu(menuFor({ kind: "flashcard-deck" }));
    expect(deck.map((a) => a.id)).toEqual(["study", "edit", "copy-link", "delete"]);
    expect(deck.at(-1)?.label).toBe("Deck löschen");
  });

  it("derives the bulk bar from the same model", () => {
    expect(bulkActions("item", 1).map((a) => a.id)).toEqual(["move", "tags", "favorite", "archive", "delete"]);
    expect(bulkActions("task", 2).map((a) => a.id)).toEqual(["done", "delete"]);
  });
});

describe("selection", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("selects one row on a plain click", () => {
    const s = clickSelect(EMPTY_SELECTION, "b", order);
    expect([...s.selected]).toEqual(["b"]);
    expect(s.anchor).toBe("b");
  });

  it("toggles with Ctrl", () => {
    let s = clickSelect(EMPTY_SELECTION, "a", order);
    s = clickSelect(s, "c", order, { ctrl: true });
    expect([...s.selected].sort()).toEqual(["a", "c"]);
    s = clickSelect(s, "a", order, { ctrl: true });
    expect([...s.selected]).toEqual(["c"]);
  });

  it("selects a range with Shift, in either direction", () => {
    let s = clickSelect(EMPTY_SELECTION, "b", order);
    s = clickSelect(s, "d", order, { shift: true });
    expect([...s.selected].sort()).toEqual(["b", "c", "d"]);
    s = clickSelect(s, "a", order, { shift: true });
    expect([...s.selected].sort()).toEqual(["a", "b"]);
    expect(s.anchor).toBe("b");
  });

  it("adds a range to the selection with Ctrl+Shift", () => {
    let s = clickSelect(EMPTY_SELECTION, "a", order);
    s = clickSelect(s, "c", order, { ctrl: true });
    s = clickSelect(s, "e", order, { ctrl: true, shift: true });
    expect([...s.selected].sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("treats Shift without an anchor as a plain click", () => {
    expect([...clickSelect(EMPTY_SELECTION, "c", order, { shift: true }).selected]).toEqual(["c"]);
  });

  it("selects everything and clears", () => {
    expect(selectAll(order).selected.size).toBe(5);
    expect(clearSelection().selected.size).toBe(0);
  });

  it("prunes rows that left the list and keeps identity when nothing changed", () => {
    const s = selectAll(order);
    expect(pruneSelection(s, order)).toBe(s);
    const pruned = pruneSelection(s, ["a", "c"]);
    expect([...pruned.selected].sort()).toEqual(["a", "c"]);
    expect(pruned.anchor).toBe("a");
  });

  it("applies a menu to the whole selection only when the row belongs to it", () => {
    const s = toggleSelect(toggleSelect(EMPTY_SELECTION, "a"), "b");
    expect(targetsOf(s, "a").sort()).toEqual(["a", "b"]);
    expect(targetsOf(s, "e")).toEqual(["e"]);
  });
});

describe("keys", () => {
  it("recognises the keyboard ways to open a context menu", () => {
    expect(isContextMenuKey({ key: "ContextMenu" })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "F10" })).toBe(false);
    expect(isContextMenuKey({ key: "F10", shiftKey: true, ctrlKey: true })).toBe(false);
  });

  it("navigates with wrap-around", () => {
    expect(navigate(-1, 4, "ArrowDown")).toBe(0);
    expect(navigate(3, 4, "ArrowDown")).toBe(0);
    expect(navigate(0, 4, "ArrowUp")).toBe(3);
    expect(navigate(2, 4, "Home")).toBe(0);
    expect(navigate(1, 4, "End")).toBe(3);
    expect(navigate(1, 4, "x")).toBeNull();
    expect(navigate(0, 0, "ArrowDown")).toBeNull();
  });

  it("keeps the menu inside the viewport", () => {
    const vp = { w: 1000, h: 800 };
    expect(placeMenu({ x: 100, y: 100 }, { w: 200, h: 300 }, vp)).toEqual({ left: 100, top: 100 });
    expect(placeMenu({ x: 950, y: 100 }, { w: 200, h: 300 }, vp)).toEqual({ left: 750, top: 100 });
    expect(placeMenu({ x: 100, y: 700 }, { w: 200, h: 300 }, vp)).toEqual({ left: 100, top: 492 });
  });
});

describe("menu labels in English", () => {
  it("builds the labels in the language of the call", () => {
    withLocale("en", () => {
      const single = flattenMenu(menuFor({ kind: "item" }));
      expect(single.map((a) => a.label)).toEqual(["Open", "Open in split", "Copy link", "Move to …", "Tags …", "Mark as favorite", "Archive", "Delete"]);
      const bulk = flattenMenu(menuFor({ kind: "item", count: 3 }));
      expect(bulk.find((a) => a.id === "move")?.label).toBe("Move (3) …");
      expect(bulk.find((a) => a.id === "delete")?.shortcut).toBe("Del");
    });
    expect(flattenMenu(menuFor({ kind: "item" })).map((a) => a.label)).toEqual([
      "Öffnen",
      "In Split öffnen",
      "Link kopieren",
      "Verschieben nach …",
      "Tags …",
      "Als Favorit markieren",
      "Archivieren",
      "Löschen",
    ]);
  });
});
