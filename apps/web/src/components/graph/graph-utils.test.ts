import { describe, expect, it } from "vitest";
import {
  clipSegment,
  groupCounts,
  groupShown,
  neighboursOf,
  searchNodes,
  toggleTypeGroup,
  hubSet,
  labelCandidates,
  LABEL_MAX_CHARS,
  LABEL_ZOOM_ALL,
  shortLabel,
} from "./graph-utils";

const deg = (...d: number[]) => d.map((degree) => ({ degree }));

describe("graph labels (W10)", () => {
  it("cuts titles to 28 characters with an ellipsis", () => {
    expect(shortLabel("Kurz")).toBe("Kurz");
    const long = "Roast-Room SaaS-Bewertung und Preismodell für 2027";
    expect(shortLabel(long)).toHaveLength(LABEL_MAX_CHARS);
    expect(shortLabel(long).endsWith("…")).toBe(true);
    expect(shortLabel("x".repeat(28))).toBe("x".repeat(28));
  });

  it("hubs: more than 3 connections, or the top 15 % by degree", () => {
    // 20 nodes: top 15 % = 3 nodes (degrees 3, 3, 2 → cut at 2); degree 0 never counts.
    const nodes = deg(3, 3, 2, ...Array<number>(17).fill(1));
    expect([...hubSet(nodes)].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(hubSet(deg(5, 1, 1, 1, 1, 1, 1, 1, 1, 1)).has(0)).toBe(true);
    expect(hubSet(deg(0, 0, 0)).size).toBe(0);
    expect(hubSet([]).size).toBe(0);
  });

  it("candidates: only hubs in the default view, every node from zoom 1.6, best connected first", () => {
    const nodes = deg(1, 6, 1, 4, 0);
    const hubs = hubSet(nodes);
    expect(labelCandidates(nodes, hubs, 1)).toEqual([1, 3]);
    expect(labelCandidates(nodes, hubs, LABEL_ZOOM_ALL)).toEqual([1, 3, 0, 2, 4]);
  });
});

describe("clipSegment (A-14)", () => {
  it("keeps a segment inside the box", () => {
    expect(clipSegment(1, 1, 5, 5, 0, 0, 10, 10)).toEqual([1, 1, 5, 5]);
  });
  it("shortens a segment that leaves the box", () => {
    expect(clipSegment(5, 5, 50005, 5, 0, 0, 10, 10)).toEqual([5, 5, 10, 5]);
  });
  it("keeps a segment whose ends are both outside but which crosses the box", () => {
    const c = clipSegment(-100, 5, 100, 5, 0, 0, 10, 10)!;
    [0, 5, 10, 5].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 9));
  });
  it("drops a segment that misses the box", () => {
    expect(clipSegment(-100, -5, 100, -5, 0, 0, 10, 10)).toBeNull();
    expect(clipSegment(20, 20, 30, 40, 0, 0, 10, 10)).toBeNull();
  });
});

describe("graph HUDs (Tactile Craft v2)", () => {
  const ALL = ["notes", "meetings", "objects"];
  it("type toggles: all on by default, a click switches one off, all on again means no filter", () => {
    const off = toggleTypeGroup(new Set(), "meetings", ALL);
    expect([...off].sort()).toEqual(["notes", "objects"]);
    expect(groupShown(off, "meetings")).toBe(false);
    expect(groupShown(new Set(), "meetings")).toBe(true);
    expect(toggleTypeGroup(off, "meetings", ALL).size).toBe(0);
  });

  it("type toggles: the last visible group cannot be switched off", () => {
    const one = new Set(["notes"]);
    expect([...toggleTypeGroup(one, "notes", ALL)]).toEqual(["notes"]);
  });

  it("counts nodes per group", () => {
    const groups = [
      { key: "notes", types: ["note" as const] },
      { key: "objects", types: ["person" as const, "project" as const] },
    ];
    expect(groupCounts([{ type: "note" }, { type: "person" }, { type: "project" }, { type: "video" }], groups)).toEqual({ notes: 1, objects: 2 });
  });

  it("search: prefix matches first, then by connections; empty query finds nothing", () => {
    const nodes = [
      { label: "Kortex Roadmap", degree: 2 },
      { label: "Local-First Kortex", degree: 9 },
      { label: "Kortex", degree: 5 },
      { label: "Anderes", degree: 1 },
    ];
    expect(searchNodes(nodes, "kortex").map((n) => n.label)).toEqual(["Kortex", "Kortex Roadmap", "Local-First Kortex"]);
    expect(searchNodes(nodes, "  ")).toEqual([]);
    expect(searchNodes(nodes, "kortex", 1)).toHaveLength(1);
  });

  it("neighbours: distinct, best connected first", () => {
    const nodes = [{ degree: 1 }, { degree: 3 }, { degree: 7 }, { degree: 2 }];
    const edges: [number, number, number, number][] = [[0, 1, 1, 1], [2, 0, 1, 1], [0, 1, 2, 1], [3, 2, 1, 1]];
    expect(neighboursOf(0, edges, nodes)).toEqual([2, 1]);
  });
});
