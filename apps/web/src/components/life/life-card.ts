import type { LifeAreaDetail, LifeRange } from "@/lib/mock/life";

/* Pure parts of the Life overview (Feinschliff Live r4), kept apart from the components for the tests. */

type Scored = Pick<LifeAreaDetail, "score" | "empty" | "ranges">;

/** Score of an area in a range; live data has one per range, the mock only its fixed score. Null = no data. */
export function lifeRangeScore(a: Scored, range: LifeRange): number | null {
  if (a.ranges) return a.ranges[range]?.score ?? null;
  return a.empty ? null : a.score;
}

/** Mean score of the areas with data in that range (the ring). */
export function lifeAverage(areas: readonly Scored[], range: LifeRange): number | null {
  const xs = areas.map((a) => lifeRangeScore(a, range)).filter((x): x is number => x !== null);
  return xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : null;
}

/** Trend against the window before ("+4", "−3", "±0"); null when either window has no data. */
export function lifeTrend(a: Scored, range: LifeRange): { text: string; dir: "up" | "down" | "flat" } | null {
  const r = a.ranges?.[range];
  if (!r || r.score === null || r.prev === null) return null;
  const d = r.score - r.prev;
  if (d > 0) return { text: `+${d}`, dir: "up" };
  if (d < 0) return { text: `−${-d}`, dir: "down" };
  return { text: "±0", dir: "flat" };
}
