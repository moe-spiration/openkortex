import { describe, expect, it } from "vitest";
import type { GraphNode } from "@/server/graph/types";
import { adjacency, flatPositions, hash01, initPositions, layoutRequest, placeLabels, worldRadius } from "./layout3d";

const node = (id: string, x: number, y: number): GraphNode => ({ id, label: id, type: "note", domain: null, degree: 1, updated: "2026-11-01T00:00:00Z", x, y });

describe("3D graph helpers", () => {
  it("flattens the server layout around the origin, y up, z = 0", () => {
    const p = flatPositions([node("a", 100, 100), node("b", 300, 100), node("c", 200, 300)]);
    const cx = (p[0]! + p[3]! + p[6]!) / 3;
    const cy = (p[1]! + p[4]! + p[7]!) / 3;
    expect(Math.abs(cx)).toBeLessThan(1e-4);
    expect(Math.abs(cy)).toBeLessThan(1e-4);
    expect([p[2], p[5], p[8]]).toEqual([0, 0, 0]);
    expect(p[7]!).toBeLessThan(p[1]!); // screen y 300 lies below 100
  });

  it("keeps known positions and lifts new nodes by a stable z", () => {
    const nodes = [node("a", 0, 0), node("b", 10, 0)];
    const { init, reused } = initPositions(nodes, new Map([["a", [1, 2, 3] as const]]));
    expect(reused).toBe(1);
    expect([init[0], init[1], init[2]]).toEqual([1, 2, 3]);
    expect(init[5]).toBeCloseTo((hash01("b") - 0.5) * worldRadius(2), 3);
    expect(initPositions(nodes, new Map()).init[5]).toBe(init[5]);
  });

  it("drops self loops and out-of-range edges from adjacency and the layout request", () => {
    const edges: [number, number, number, number][] = [
      [0, 1, 1, 50],
      [1, 1, 1, 50],
      [0, 9, 1, 50],
    ];
    expect(adjacency(2, edges)).toEqual([[1], [0]]);
    const req = layoutRequest(2, edges, new Float32Array(6), false, 1);
    expect([...req.edges]).toEqual([0, 1]);
    expect([...req.degree]).toEqual([1, 1]);
  });

  it("places labels by priority without overlap and inside the viewport", () => {
    const cands = [
      { i: 0, x: 100, y: 100, r: 4, priority: 1, width: 80 },
      { i: 1, x: 104, y: 104, r: 4, priority: 5, width: 80 },
      { i: 2, x: 100, y: 200, r: 4, priority: 2, width: 80 },
      { i: 3, x: 2000, y: 100, r: 4, priority: 9, width: 80 },
    ];
    const out = placeLabels(cands, 800, 600, 10);
    expect(out.map((l) => l.i)).toEqual([1, 2]);
    expect(placeLabels(cands, 800, 600, 1).map((l) => l.i)).toEqual([1]);
  });
});
