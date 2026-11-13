import { describe, expect, it } from "vitest";
import { lifeAverage, lifeRangeScore, lifeTrend } from "./life-card";

const ranges = (s7: number | null, p7: number | null, s30: number | null, p30: number | null) => ({
  7: { score: s7, prev: p7 },
  30: { score: s30, prev: p30 },
  90: { score: null, prev: null },
});

describe("Life overview scores", () => {
  it("takes the range's score from live data and the fixed score from the mock", () => {
    const live = { score: 70, ranges: ranges(55, 50, 70, 66) };
    expect(lifeRangeScore(live, 7)).toBe(55);
    expect(lifeRangeScore(live, 30)).toBe(70);
    expect(lifeRangeScore(live, 90)).toBeNull();
    expect(lifeRangeScore({ score: 82 }, 7)).toBe(82);
    expect(lifeRangeScore({ score: 0, empty: true }, 30)).toBeNull();
  });

  it("averages only areas with data in the range", () => {
    const areas = [
      { score: 80, ranges: ranges(80, null, 80, 70) },
      { score: 0, empty: true, ranges: ranges(null, null, null, null) },
      { score: 61, ranges: ranges(60, 60, 61, 64) },
    ];
    expect(lifeAverage(areas, 30)).toBe(71);
    expect(lifeAverage(areas, 90)).toBeNull();
    expect(lifeAverage([], 30)).toBeNull();
  });

  it("trend against the window before, none without both windows", () => {
    const a = { score: 70, ranges: ranges(80, null, 70, 66) };
    expect(lifeTrend(a, 30)).toEqual({ text: "+4", dir: "up" });
    expect(lifeTrend(a, 7)).toBeNull();
    expect(lifeTrend({ score: 61, ranges: ranges(60, 60, 61, 64) }, 30)).toEqual({ text: "−3", dir: "down" });
    expect(lifeTrend({ score: 61, ranges: ranges(60, 60, 61, 64) }, 7)).toEqual({ text: "±0", dir: "flat" });
    expect(lifeTrend({ score: 82 }, 30)).toBeNull();
  });
});
