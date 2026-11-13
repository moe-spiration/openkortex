import { describe, expect, it } from "vitest";
import {
  BENTO_DEFAULT,
  BENTO_LAYOUT,
  bentoSpans,
  dueTaskLine,
  glyphTint,
  HOME_TOGGLES,
  lifeMiniRows,
  moveKey,
  dropBefore,
  parseHidden,
  parseOrder,
  quoted,
  restLabel,
  savedAgo,
} from "./home-utils";

describe("Home bento helpers", () => {
  it("parseHidden keeps known section keys (incl. Life and Mixes) and drops old or broken ones", () => {
    expect([...parseHidden(JSON.stringify({ hidden: ["b", "l", "m", "q", 3] }))].sort()).toEqual(["b", "l", "m"]);
    expect(parseHidden("{not json").size).toBe(0);
    expect(parseHidden(null).size).toBe(0);
    expect(HOME_TOGGLES.map((t) => t.key)).toEqual(["t", "b", "j", "c", "r", "l", "d", "s", "m"]);
  });

  it("restLabel says what is left of an entry", () => {
    expect(restLabel(null)).toBe("");
    expect(restLabel(42)).toBe("noch 58 %");
    expect(restLabel(99.8)).toBe("noch 1 %");
    expect(restLabel(100)).toBe("fertig");
  });

  it("savedAgo counts whole months and years", () => {
    const now = new Date(2026, 9, 29);
    expect(savedAgo(new Date(2026, 2, 12), now)).toBe("vor 7 Monaten gespeichert");
    expect(savedAgo(new Date(2025, 9, 29), now)).toBe("vor einem Jahr gespeichert");
    expect(savedAgo(new Date(2023, 9, 1), now)).toBe("vor 3 Jahren gespeichert");
    expect(savedAgo(new Date(2026, 9, 2), now)).toBeNull();
    expect(savedAgo(null, now)).toBeNull();
  });

  it("quoted swaps any quotes for German ones", () => {
    expect(quoted('"Ich will nicht mehr ablegen."')).toBe("„Ich will nicht mehr ablegen.“");
    expect(quoted("„Schon deutsch“")).toBe("„Schon deutsch“");
    expect(quoted("   ")).toBe("");
  });

  it("lifeMiniRows: mock keeps the prototype scores, live leaves out inactive areas", () => {
    const areas = [
      { key: "overview", score: null },
      { key: "health", score: 82 },
      { key: "career", score: 70 },
    ];
    expect(lifeMiniRows(areas, null).map((a) => [a.key, a.pct])).toEqual([["health", 82], ["career", 70]]);
    expect(lifeMiniRows(areas, [{ key: "health", score: 40 }, { key: "career", score: 10, active: false }]).map((a) => [a.key, a.pct])).toEqual([["health", 40]]);
    // W-08: live, while loading or after an error, no prototype numbers.
    expect(lifeMiniRows(areas, null, true).map((a) => [a.key, a.pct])).toEqual([["health", null], ["career", null]]);
  });
});

describe("Feinschliff rows", () => {
  it("dueTaskLine names the source and flags overdue tasks", () => {
    expect(dueTaskLine({ due: "2026-11-07", sourceId: "x", sourceKind: "meeting" }, "2026-11-07")).toBe("Aufgabe · Meeting");
    expect(dueTaskLine({ due: "2026-11-05", sourceId: "", sourceKind: "note" }, "2026-11-07")).toBe("Aufgabe · überfällig");
    expect(dueTaskLine({ due: "2026-11-05", sourceId: "y", sourceKind: "article" }, "2026-11-07")).toBe("Aufgabe · Artikel · überfällig");
  });

  it("glyphTint falls back to the note tint", () => {
    expect(glyphTint("meeting")).toBe("#FB7185");
    expect(glyphTint("unknown")).toBe(glyphTint("note"));
    expect(glyphTint(null)).toBe(glyphTint("note"));
  });
});

describe("home bento order (Anpassen, drag & drop)", () => {
  it("parseOrder keeps the saved order, drops unknown keys and appends missing ones", () => {
    expect(parseOrder(JSON.stringify({ order: ["l", "x", "c", "l"], layout: BENTO_LAYOUT }))).toEqual(["l", "c", "t", "d", "j", "r", "s", "m"]);
    // An order saved for the older bento layout falls back to the Feinschliff default.
    expect(parseOrder(JSON.stringify({ order: ["l", "c"] }))).toEqual([...BENTO_DEFAULT]);
    expect(BENTO_DEFAULT.slice(0, 4)).toEqual(["t", "c", "d", "j"]);
    expect(parseOrder(null)).toEqual([...BENTO_DEFAULT]);
    expect(parseOrder("{broken")).toEqual([...BENTO_DEFAULT]);
  });

  it("dropBefore: down lands after the target, up before it, the row itself moves nothing", () => {
    const o = ["a", "b", "c", "d"];
    expect(moveKey(o, "a", dropBefore(o, "a", "c")!)).toEqual(["b", "c", "a", "d"]);
    expect(moveKey(o, "a", dropBefore(o, "a", "d") as string | null)).toEqual(["b", "c", "d", "a"]);
    expect(moveKey(o, "d", dropBefore(o, "d", "b")!)).toEqual(["a", "d", "b", "c"]);
    expect(dropBefore(o, "b", "b")).toBeUndefined();
    expect(dropBefore(o, "b", null)).toBeUndefined();
  });

  it("moveKey puts a key before another or at the end", () => {
    expect(moveKey(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveKey(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("bentoSpans pairs narrow neighbours and widens a lone narrow card, so no holes appear", () => {
    // Feinschliff Live: overview full width, "Heute fällig" 7 next to "Weiter, wo Du warst" 5.
    expect(bentoSpans(["c", "d", "j", "r", "l"])).toEqual({ c: 12, d: 7, j: 5, r: 7, l: 5 });
    // Two wide-ish neighbours share the row evenly, a lone narrow card takes the full row.
    expect(bentoSpans(["c", "d", "r", "l", "m"])).toEqual({ c: 12, d: 6, r: 6, l: 12, m: 12 });
    expect(bentoSpans(["r", "d", "l"])).toEqual({ r: 6, d: 6, l: 12 });
    for (const order of [["c", "r", "l"], ["j", "c", "r"], ["c", "d", "j"]]) {
      const spans = bentoSpans(order);
      let row = 0;
      for (const k of order) {
        row += spans[k]!;
        if (row > 12) throw new Error(`row overflow in ${order.join(",")}`);
        if (row === 12) row = 0;
      }
      expect(row).toBe(0);
    }
  });
});
