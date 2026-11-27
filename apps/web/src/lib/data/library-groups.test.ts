import { describe, expect, it } from "vitest";
import { bucketTotals, dayBucket, gridBucket, groupRows, rowWhen } from "./library-groups";

const today = "2026-11-26";

describe("library groups", () => {
  it("buckets by day, week, then month", () => {
    expect(dayBucket("2026-11-26", today).key).toBe("today");
    expect(dayBucket("2026-11-25", today).key).toBe("yesterday");
    expect(dayBucket("2026-11-21", today).key).toBe("week");
    expect(dayBucket("2026-11-02", today)).toEqual({ key: "m:2026-11", label: "November" });
    expect(dayBucket("2025-10-02", today)).toEqual({ key: "m:2025-10", label: "Oktober 2025" });
  });

  it("says time, weekday or day", () => {
    expect(rowWhen("2026-11-26", "10:30", today, "de-DE")).toBe("10:30");
    expect(rowWhen("2026-11-25", "18:50", today, "de-DE")).toBe("18:50");
    expect(rowWhen("2026-11-23", "08:00", today, "de-DE")).toBe("Mo");
    expect(rowWhen("2026-10-14", "08:00", today, "de-DE")).toBe("14.10.");
    expect(rowWhen("2026-10-14", "08:00", today, "en-US")).toBe("10/14");
  });

  it("groups consecutive rows and keeps the order", () => {
    const rows = [{ date: "2026-11-26" }, { date: "2026-11-26" }, { date: "2026-11-25" }, { date: "2026-10-01" }];
    const g = groupRows(rows, today, true)!;
    expect(g.map((x) => [x.key, x.items.length])).toEqual([
      ["today", 2],
      ["yesterday", 1],
      ["m:2026-10", 1],
    ]);
    expect(groupRows(rows, today, false)).toBeNull();
  });

  it("joins today and yesterday in the grid and counts whole buckets", () => {
    const rows = [{ date: "2026-11-26" }, { date: "2026-11-25" }, { date: "2026-11-21" }];
    expect(groupRows(rows, today, true, gridBucket)!.map((x) => [x.label, x.items.length])).toEqual([
      ["Heute und gestern", 2],
      ["Diese Woche", 1],
    ]);
    expect([...bucketTotals(rows, today)]).toEqual([
      ["today", 1],
      ["yesterday", 1],
      ["week", 1],
    ]);
  });
});
