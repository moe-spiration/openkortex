import { describe, expect, it } from "vitest";
import { currentStreak } from "@kortex/db/daily";
import { mockCheckinStreak } from "../src/lib/streak";

describe("mobile check-in streak (W6/A-08: same rule as the web)", () => {
  it("prototype days: 14, and saving today's check-in makes it 15", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    expect(mockCheckinStreak(false, now)).toBe(14);
    expect(mockCheckinStreak(true, now)).toBe(15);
  });

  it("stays 14/15 through the DST change night of 2026-10-25", () => {
    for (const iso of ["2026-10-24T21:59:59Z", "2026-10-24T22:00:00Z", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "2026-10-25T23:00:00Z"]) {
      expect([mockCheckinStreak(false, new Date(iso)), mockCheckinStreak(true, new Date(iso))]).toEqual([14, 15]);
    }
  });

  it("uses the shared function (a gap ends it the same way as on the web)", () => {
    expect(currentStreak(["2026-10-25", "2026-10-23"], "2026-10-25")).toBe(1);
  });
});
