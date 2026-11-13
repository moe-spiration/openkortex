import { describe, expect, it } from "vitest";
import { energyCorrelations, energySeries, energyStats } from "@kortex/db/daily";
import { MOCK_INSIGHTS } from "@/lib/mock/insights";
import { energyFacts, habitLabelsOf, insightsToday, mockEnergyDays, sparkPath, type StoredDay } from "./energy";

const D = {
  energy: [
    { date: "2026-10-27", label: "27. Okt", v: 6, habit: false },
    { date: "2026-10-28", label: "28. Okt", v: 8, habit: true },
    { date: "2026-10-29", label: "29. Okt", v: null, habit: false },
  ],
  activity: [
    { date: "2026-10-28", v: 3 },
    { date: "2026-10-29", v: 5 },
  ],
  habitLabel: "Morning Mobility",
};

describe("Insights energy facts", () => {
  it("takes today from the newest activity", () => {
    expect(insightsToday(D)).toBe("2026-10-29");
    expect(insightsToday({ activity: [], energy: [] })).toBeNull();
  });

  it("merges server energy, stored check-ins (habits, Top 3) and output per day", () => {
    const stored: StoredDay[] = [
      { date: "2026-10-29", energy: 7, habits: [{ key: "mob", label: "Morning Mobility", done: true }], focus: [{ done: true }, { done: true }, { done: false }] },
      { date: "2026-10-25", energy: 4, habits: [{ key: "mob", label: "Morning Mobility", done: false }], focus: [] },
    ];
    const f = energyFacts(D, "2026-10-29", 5, stored);
    expect(f.map((x) => x.date)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
    // A stored day outside the server window still counts; the server value wins where both exist.
    expect(f.map((x) => x.energy)).toEqual([4, null, 6, 8, 7]);
    // The main habit maps onto the stored key with the same label (no duplicate "main" comparison).
    expect(f[3]!.habits).toEqual({ mob: true });
    expect(f[4]).toMatchObject({ habits: { mob: true }, focusDone: 2, output: 5 });
    expect(f[0]!.focusDone).toBeNull();
    expect(habitLabelsOf(D, stored)).toEqual({ labels: { mob: "Morning Mobility" }, mainKey: "mob" });
  });

  it("without stored days the main habit gets its own key", () => {
    const f = energyFacts(D, "2026-10-29", 3);
    expect(f[0]!.habits).toEqual({ main: false });
    expect(habitLabelsOf(D, []).mainKey).toBe("main");
    expect(energyFacts({ ...D, habitLabel: null }, "2026-10-29", 3)[1]!.habits).toEqual({});
  });

  it("mock: 90 deterministic days that end with the prototype's 14 and give every range a curve and correlations", () => {
    const today = insightsToday(MOCK_INSIGHTS)!;
    const a = mockEnergyDays(MOCK_INSIGHTS, today);
    const b = mockEnergyDays(MOCK_INSIGHTS, today);
    expect(a).toEqual(b);
    expect(a).toHaveLength(90);
    const facts = energyFacts(MOCK_INSIGHTS, today, 90, a);
    for (const range of [7, 30, 90]) {
      const s = energyStats(energySeries(facts.slice(-range), today, range));
      expect(s.enough).toBe(true);
    }
    const c = energyCorrelations(facts, habitLabelsOf(MOCK_INSIGHTS, a).labels);
    expect(c.enough).toBe(true);
    expect(c.habits[0]!.label).toBe("Morning Mobility");
    expect(c.habits[0]!.delta!).toBeGreaterThan(0);
    expect(c.focus.enough && c.output.enough).toBe(true);
  });
});

describe("sparkPath", () => {
  it("breaks the line at days without a check-in and fills only runs of two or more", () => {
    const p = sparkPath([
      { date: "a", energy: 5 },
      { date: "b", energy: 10 },
      { date: "c", energy: null },
      { date: "d", energy: 2 },
      { date: "e", energy: null },
    ]);
    expect(p.line).toBe("M0.0 80.0 L250.0 0.0 M750.0 128.0");
    expect(p.area).toBe("M0.0 80.0 L250.0 0.0 L250.0 160 L0.0 160 Z");
    expect(sparkPath([])).toEqual({ line: "", area: "" });
  });
});
