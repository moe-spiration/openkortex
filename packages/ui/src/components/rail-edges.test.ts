import { describe, expect, it } from "vitest";
import { railEdges, railStep } from "./rail-edges";

describe("rail edges (Tactile Craft horizontal strips)", () => {
  it("at the start only the right side has more", () => {
    expect(railEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 })).toEqual({ left: false, right: true });
  });
  it("in the middle both sides have more", () => {
    expect(railEdges({ scrollLeft: 300, clientWidth: 400, scrollWidth: 1000 })).toEqual({ left: true, right: true });
  });
  it("at the end (with sub-pixel slack) only the left side has more", () => {
    expect(railEdges({ scrollLeft: 597.5, clientWidth: 400, scrollWidth: 1000 })).toEqual({ left: true, right: false });
  });
  it("content that fits needs no arrows", () => {
    expect(railEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 402 })).toEqual({ left: false, right: false });
  });
  it("step: explicit value or 80 % of the visible width", () => {
    expect(railStep(500, 420)).toBe(420);
    expect(railStep(500)).toBe(400);
    expect(railStep(0)).toBe(1);
  });
});
