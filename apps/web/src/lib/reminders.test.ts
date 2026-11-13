import { describe, expect, it } from "vitest";
import { dateToRemindIso, endOfDayIso, isDueOn, remindLabel, snoozePresets, zonedInstant } from "./reminders";

const TZ = "Europe/Berlin";

describe("zonedInstant / endOfDayIso", () => {
  it("honours summer and winter time", () => {
    expect(zonedInstant("2026-07-01", "08:00", TZ).toISOString()).toBe("2026-07-01T06:00:00.000Z");
    expect(zonedInstant("2026-12-01", "08:00", TZ).toISOString()).toBe("2026-12-01T07:00:00.000Z");
    expect(endOfDayIso("2026-11-01", TZ)).toBe("2026-11-01T22:59:59.999Z");
  });
  it("handles the DST switch day (25 hours long)", () => {
    // 2026-10-25: clocks go back, midnight to midnight is 25 h.
    expect(endOfDayIso("2026-10-25", TZ)).toBe("2026-10-25T22:59:59.999Z");
  });
});

describe("isDueOn", () => {
  it("is due when the reminder lies at or before the end of today", () => {
    expect(isDueOn("2026-11-01T22:59:59.999Z", "2026-11-01", TZ)).toBe(true);
    expect(isDueOn("2026-10-20T08:00:00Z", "2026-11-01", TZ)).toBe(true); // overdue stays due
    expect(isDueOn("2026-11-01T23:00:00.000Z", "2026-11-01", TZ)).toBe(false); // tomorrow 00:00
    expect(isDueOn(null, "2026-11-01", TZ)).toBe(false);
    expect(isDueOn("kaputt", "2026-11-01", TZ)).toBe(false);
  });
  it("a snoozed item leaves today's list until its new time", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const tomorrow = snoozePresets(now, "2026-11-01", TZ).find((p) => p.key === "tomorrow")!;
    expect(isDueOn(tomorrow.iso, "2026-11-01", TZ)).toBe(false);
    expect(isDueOn(tomorrow.iso, "2026-11-02", TZ)).toBe(true);
  });
});

describe("snoozePresets", () => {
  it("offers tonight 18:00, tomorrow 08:00 and next Monday 08:00", () => {
    // Sunday 2026-11-01, 10:00 Berlin
    const p = snoozePresets(new Date("2026-11-01T09:00:00Z"), "2026-11-01", TZ);
    expect(p.map((x) => [x.key, x.iso])).toEqual([
      ["tonight", "2026-11-01T17:00:00.000Z"],
      ["tomorrow", "2026-11-02T07:00:00.000Z"],
      ["next-week", "2026-11-02T07:00:00.000Z"], // Sunday: next Monday is tomorrow
    ]);
  });
  it("moves tonight to 21:00 after 18:00 and drops it after 21:00", () => {
    const evening = snoozePresets(new Date("2026-11-03T17:30:00Z"), "2026-11-03", TZ); // 18:30 Berlin
    expect(evening[0]).toMatchObject({ key: "tonight", iso: "2026-11-03T20:00:00.000Z" });
    const late = snoozePresets(new Date("2026-11-03T21:00:00Z"), "2026-11-03", TZ); // 22:00 Berlin
    expect(late.map((x) => x.key)).toEqual(["tomorrow", "next-week"]);
    expect(late[1]!.iso).toBe("2026-11-09T07:00:00.000Z"); // Tue -> next Monday
  });
});

describe("dateToRemindIso / remindLabel", () => {
  it("turns a picked day into 08:00 local and rejects junk", () => {
    expect(dateToRemindIso("2026-12-24", TZ)).toBe("2026-12-24T07:00:00.000Z");
    expect(dateToRemindIso("", TZ)).toBeNull();
    expect(dateToRemindIso("morgen", TZ)).toBeNull();
  });
  it("labels relative to today", () => {
    expect(remindLabel("2026-11-01T17:00:00Z", "2026-11-01", TZ)).toBe("heute 18:00");
    expect(remindLabel("2026-11-02T07:00:00Z", "2026-11-01", TZ)).toBe("morgen 08:00");
    expect(remindLabel("2026-10-29T07:00:00Z", "2026-11-01", TZ)).toBe("fällig seit 3 Tagen");
    expect(remindLabel("2026-10-31T07:00:00Z", "2026-11-01", TZ)).toBe("gestern fällig");
  });
});
