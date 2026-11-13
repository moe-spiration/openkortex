import { describe, expect, it } from "vitest";
import { weekDays } from "./week";

describe("weekDays (journal week tab)", () => {
  it("returns Monday to Sunday of the week around today with the daily notes", () => {
    // 2026-11-05 is a Thursday.
    const days = weekDays("2026-11-05", [
      { id: "d1", date: "2026-11-02" },
      { id: "d4", date: "2026-11-05" },
      { id: "old", date: "2026-10-30" },
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(days.map((d) => d.short)).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    expect(days.map((d) => d.noteId)).toEqual(["d1", null, null, "d4", null, null, null]);
    expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-11-05"]);
    expect(days.filter((d) => d.isFuture).length).toBe(3);
    expect(days[0]!.day).toBe("2");
  });

  it("counts extra entry dates as done without a note, across a month edge", () => {
    const days = weekDays("2026-11-01", [], ["2026-10-27"]); // Sunday: the week starts on 26 October
    expect(days[0]!.date).toBe("2026-10-26");
    expect(days[1]).toMatchObject({ date: "2026-10-27", done: true, noteId: null });
    expect(days[6]).toMatchObject({ date: "2026-11-01", isToday: true, done: false });
  });
});
