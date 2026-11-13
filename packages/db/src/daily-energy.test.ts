import { describe, expect, it } from "vitest";
import {
  energyCorrelations,
  energyDecimal,
  energyDelta,
  energyLabel,
  energySeries,
  energyStats,
  MIN_ENERGY_DAYS,
  normalizeEnergy,
  type EnergyDayFacts,
} from "./daily";

describe("energyLabel / normalizeEnergy", () => {
  it("names every value of the scale and nothing else", () => {
    expect(energyLabel(1)).toBe("Leer");
    expect(energyLabel(7)).toBe("Gut");
    expect(energyLabel(10)).toBe("Voller Energie");
    expect(energyLabel(0)).toBe("");
    expect(energyLabel(11)).toBe("");
    expect(energyLabel(null)).toBe("");
    expect(energyLabel(7.5)).toBe("");
  });

  it("keeps 1..10, rounds, accepts numeric strings (YAML) and rejects the rest", () => {
    expect(normalizeEnergy(9)).toBe(9);
    expect(normalizeEnergy(6.6)).toBe(7);
    expect(normalizeEnergy("8")).toBe(8);
    expect(normalizeEnergy(0)).toBeNull();
    expect(normalizeEnergy(11)).toBeNull();
    expect(normalizeEnergy("")).toBeNull();
    expect(normalizeEnergy(Number.NaN)).toBeNull();
    expect(normalizeEnergy(undefined)).toBeNull();
  });
});

describe("energySeries", () => {
  it("returns the window ending today, oldest first, with gaps as null", () => {
    const s = energySeries(
      [
        { date: "2026-10-27", energy: 6 },
        { date: "2026-10-29", energy: 8 },
        { date: "2026-10-10", energy: 3 },
      ],
      "2026-10-29",
      4,
    );
    expect(s).toEqual([
      { date: "2026-10-26", energy: null },
      { date: "2026-10-27", energy: 6 },
      { date: "2026-10-28", energy: null },
      { date: "2026-10-29", energy: 8 },
    ]);
  });

  it("lets a later entry for the same day win (live check-in over the stored one)", () => {
    const s = energySeries([{ date: "2026-10-29", energy: 4 }, { date: "2026-10-29", energy: 9 }], "2026-10-29", 1);
    expect(s[0]!.energy).toBe(9);
  });

  it("crosses month ends and DST switches without skipping a day", () => {
    const s = energySeries([], "2026-11-01", 8);
    expect(s.map((p) => p.date)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });
});

describe("energyStats", () => {
  it("averages known days only and reports the trend of the second half", () => {
    const s = energyStats([
      { date: "a", energy: 4 },
      { date: "b", energy: 6 },
      { date: "c", energy: null },
      { date: "d", energy: 8 },
      { date: "e", energy: 8 },
      { date: "f", energy: 7 },
    ]);
    expect(s.count).toBe(5);
    expect(s.avg).toBeCloseTo(6.6);
    expect(s.min).toBe(4);
    expect(s.max).toBe(8);
    expect(s.last).toEqual({ date: "f", energy: 7 });
    // first half: 4, 6 -> 5; second half: 8, 8, 7 -> 7.67
    expect(s.trend).toBeCloseTo(2.667, 2);
    expect(s.enough).toBe(true);
  });

  it("is not enough below MIN_ENERGY_DAYS and empty without values", () => {
    const few = energyStats(Array.from({ length: MIN_ENERGY_DAYS - 1 }, (_, i) => ({ date: String(i), energy: 5 })));
    expect(few.enough).toBe(false);
    const none = energyStats([{ date: "a", energy: null }]);
    expect(none).toMatchObject({ count: 0, avg: null, min: null, max: null, last: null, trend: null, enough: false });
  });
});

describe("energyCorrelations", () => {
  const day = (i: number, energy: number | null, mob: boolean | undefined, focusDone: number | null, output: number | null): EnergyDayFacts => ({
    date: `2026-10-${String(10 + i).padStart(2, "0")}`,
    energy,
    habits: mob === undefined ? {} : { mob, carb: i % 2 === 0 },
    focusDone,
    output,
  });
  const days = [
    day(0, 8, true, 3, 5),
    day(1, 9, true, 2, 6),
    day(2, 5, false, 0, 1),
    day(3, 6, false, 1, 2),
    day(4, 8, true, 2, 4),
    day(5, null, true, 3, 9), // no check-in: ignored everywhere
    day(6, 7, undefined, null, null), // habits and focus unknown: on no side
  ];

  it("compares the mean energy with and without each habit", () => {
    const c = energyCorrelations(days, { mob: "Morning Mobility" });
    expect(c.days).toBe(6);
    expect(c.enough).toBe(true);
    const mob = c.habits.find((h) => h.key === "habit:mob")!;
    expect(mob.label).toBe("Morning Mobility");
    expect(mob.nWith).toBe(3);
    expect(mob.nWithout).toBe(2);
    expect(mob.withAvg).toBeCloseTo(25 / 3);
    expect(mob.withoutAvg).toBeCloseTo(5.5);
    expect(mob.delta).toBeCloseTo(25 / 3 - 5.5);
    // The clearest habit comes first; unlabelled keys fall back to the key.
    expect(c.habits[0]!.key).toBe("habit:mob");
    expect(c.habits.find((h) => h.key === "habit:carb")!.label).toBe("carb");
  });

  it("splits focus at 2 of 3 and output at the median", () => {
    const c = energyCorrelations(days);
    expect(c.focus).toMatchObject({ nWith: 3, nWithout: 2, enough: true });
    expect(c.focus.delta).toBeCloseTo(25 / 3 - 5.5);
    // outputs of the days with energy: 5, 6, 1, 2, 4 -> median 4
    expect(c.output.withLabel).toBe("mehr als 4");
    expect(c.output).toMatchObject({ nWith: 2, nWithout: 3, enough: true });
    expect(c.output.withAvg).toBeCloseTo(8.5);
  });

  it("marks a comparison without enough days per side instead of guessing", () => {
    const c = energyCorrelations([day(0, 8, true, 3, 5), day(1, 6, true, 3, 5), day(2, 4, false, 0, 1)]);
    expect(c.enough).toBe(false);
    const mob = c.habits.find((h) => h.key === "habit:mob")!;
    expect(mob.enough).toBe(false);
    expect(mob.delta).toBeNull();
    expect(mob.withAvg).toBe(7);
  });

  it("returns empty comparisons for no data", () => {
    const c = energyCorrelations([]);
    expect(c).toMatchObject({ days: 0, enough: false, habits: [] });
    expect(c.focus.delta).toBeNull();
    expect(c.output.delta).toBeNull();
  });
});

describe("formatting", () => {
  it("writes German decimals and signed differences", () => {
    expect(energyDecimal(8.06)).toBe("8,1");
    expect(energyDelta(1.64)).toBe("+1,6");
    expect(energyDelta(-0.44)).toBe("−0,4");
    expect(energyDelta(0.02)).toBe("±0,0");
  });
});
