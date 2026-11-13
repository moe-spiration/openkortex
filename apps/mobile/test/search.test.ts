import { describe, expect, it } from "vitest";
import type { Entry } from "../src/data/mock";
import { dropChip, groupByRecency, parseQuery, searchEntries } from "../src/lib/search";
import { answerFor, clock, routeOf } from "../src/lib/answers";

const e = (id: string, kind: Entry["kind"], title: string, tag: string, day: number, who: string[] = [], minutes = 600): Entry => ({
  id, kind, type: kind, when: "", img: 0, title, tag, tldr: title, points: [], day, who, opened: 0, time: "", ts: day * 1440 - minutes, whenShort: "",
});

const ENTRIES = [
  e("a", "meeting", "Q4 architecture sync", "#it/platform", 0, ["Tom", "Priya"], 660),
  e("b", "meeting", "1:1 Priya", "#strategy/course", 3, ["Priya"]),
  e("c", "meeting", "Weekly with Tom", "#it/platform", 6, ["Tom"]),
  e("d", "food", "Low-carb salmon and spinach roll", "#recipes/low-carb", 1),
  e("f", "ai", "Coding agent session memory", "#ai/mcp", 1),
];

describe("smart search", () => {
  it("splits natural language into filters and free text", () => {
    const s = parseQuery("Meetings mit Tom diese Woche");
    expect(s.chips.map((c) => c.label)).toEqual(["Meetings", "mit Tom", "Diese Woche"]);
    expect(s.rest).toBe("");
  });

  it("filters by type, person and time window", () => {
    const r = searchEntries(ENTRIES, "Meetings mit Tom diese Woche", "all", "new");
    expect(r.list.map((x) => x.id)).toEqual(["a"]);
    expect(r.answer).toMatch(/^1 Treffer für Meetings, mit Tom, Diese Woche\. Am relevantesten: Q4 architecture sync/);
  });

  it("maps keywords to hashtags and applies the chip filter", () => {
    expect(searchEntries(ENTRIES, "was habe ich zu MCP gespeichert?", "all", "rel").list.map((x) => x.id)).toEqual(["f"]);
    expect(searchEntries(ENTRIES, "", "meeting", "az").list.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts and returns nothing for unknown words", () => {
    expect(searchEntries(ENTRIES, "", "all", "old").list[0]?.id).toBe("c");
    expect(searchEntries(ENTRIES, "quantenphysik", "all", "rel").list).toEqual([]);
  });

  it("removes one chip again", () => {
    const q = "Meetings mit Tom";
    const chip = parseQuery(q).chips[0]!;
    expect(dropChip(q, chip)).toBe("mit Tom");
  });

  it("groups by recency", () => {
    expect(groupByRecency(ENTRIES).map((g) => g.label)).toEqual(["Heute", "Gestern", "Diese Woche", "Letzte Woche"]);
  });
});

describe("mock answers", () => {
  it("cites sources and routes quick notes", () => {
    expect(answerFor("Fasse Kapitel 3 zusammen").ids).toEqual(["e3", "e4"]);
    expect(answerFor("Was habe ich diese Woche gelernt?").ids).toHaveLength(3);
    expect(routeOf("Meeting mit Tom")).toBe("Meetings");
    expect(routeOf("Einkauf Lachs")).toBe("Recipes");
    expect(routeOf("irgendwas")).toBe("Notes");
    expect(clock(7)).toBe("0:07");
  });
});
