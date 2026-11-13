import { describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ on: false, notes: [] as { id: string; date: string; energy?: number | null }[] }));
vi.mock("@/lib/workspace-data", () => ({
  isLiveData: () => live.on,
  get DAILY_NOTES() {
    return live.notes;
  },
}));

const { energyHistory, energyNotes, HISTORY_DAYS } = await import("./overview");

describe("energyHistory", () => {
  it("returns the 7 days ending today, oldest first, today from the live check-in", () => {
    const h = energyHistory("2026-10-25", 4, [
      { date: "2026-10-25", energy: 9 },
      { date: "2026-10-24", energy: 6 },
      { date: "2026-10-19", energy: 3 },
      { date: "2026-10-18", energy: 10 },
    ]);
    expect(h.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(h.map((d) => d.energy)).toEqual([3, null, null, null, null, 6, 4]);
  });

  it("covers the 14 bars of the streak tile when asked", () => {
    const h = energyHistory("2026-10-29", 7, [{ date: "2026-10-16", energy: 5 }], HISTORY_DAYS);
    expect(h).toHaveLength(14);
    expect(h[0]).toEqual({ date: "2026-10-16", energy: 5 });
    expect(h[13]).toEqual({ date: "2026-10-29", energy: 7 });
  });

  it("crosses month and DST boundaries without skipping a day", () => {
    const h = energyHistory("2026-11-01", null, []);
    expect(h.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(h.every((d) => d.energy === null)).toBe(true);
  });

  it("treats a missing energy field (older snapshots) as no check-in", () => {
    expect(energyHistory("2026-10-25", null, [{ date: "2026-10-24" }])[5]).toEqual({ date: "2026-10-24", energy: null });
  });
});

describe("energyNotes", () => {
  it("mock: the 13 fixed days before today", () => {
    live.on = false;
    const n = energyNotes("2026-10-22");
    expect(n).toHaveLength(13);
    expect(n[0]!.date).toBe("2026-10-09");
    expect(n[12]!.date).toBe("2026-10-21");
  });

  it("live: the snapshot's daily notes", () => {
    live.on = true;
    live.notes = [{ id: "a", date: "2026-10-24", energy: 7 }];
    expect(energyNotes("2026-10-25")).toEqual([{ id: "a", date: "2026-10-24", energy: 7 }]);
  });
});
