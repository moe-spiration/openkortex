import { withLocale } from "@kortex/i18n";
import { describe, expect, it } from "vitest";
import {
  addDays,
  currentStreak,
  DEFAULT_TIME_ZONE,
  ENERGY_LABELS,
  energyDelta,
  energyLabel,
  resolveTimeZone,
  reviewDue,
  reviewDueTooltip,
  streakRecord,
  todayIn,
  weekStart,
} from "./daily";

// Fixed instants only. 2026-10-25 is the end of summer time in Europe (03:00 CEST → 02:00 CET,
// i.e. 01:00 UTC); Los Angeles switches on 2026-11-01 (02:00 PDT → 01:00 PST, i.e. 09:00 UTC).
const at = (iso: string) => new Date(iso);

describe("todayIn: day boundary = midnight in the user's time zone", () => {
  it("23:59 vs 00:00 in Europe/Berlin (summer time, +02:00)", () => {
    expect(todayIn("Europe/Berlin", at("2026-10-23T21:59:59Z"))).toBe("2026-10-23"); // 23:59:59
    expect(todayIn("Europe/Berlin", at("2026-10-23T22:00:00Z"))).toBe("2026-10-24"); // 00:00
  });

  it("across the DST change on 2026-10-25 (Berlin): the day is 25 h long", () => {
    expect(todayIn("Europe/Berlin", at("2026-10-24T21:59:59Z"))).toBe("2026-10-24"); // 23:59:59 CEST
    expect(todayIn("Europe/Berlin", at("2026-10-24T22:00:00Z"))).toBe("2026-10-25"); // 00:00 CEST
    expect(todayIn("Europe/Berlin", at("2026-10-25T00:59:59Z"))).toBe("2026-10-25"); // 02:59:59 CEST
    expect(todayIn("Europe/Berlin", at("2026-10-25T01:00:00Z"))).toBe("2026-10-25"); // 02:00 CET
    expect(todayIn("Europe/Berlin", at("2026-10-25T22:59:59Z"))).toBe("2026-10-25"); // 23:59:59 CET
    expect(todayIn("Europe/Berlin", at("2026-10-25T23:00:00Z"))).toBe("2026-10-26"); // 00:00 CET
  });

  it("the same instant is a different day in UTC, Berlin and Los Angeles", () => {
    const now = at("2026-10-24T22:30:00Z");
    expect(todayIn("UTC", now)).toBe("2026-10-24");
    expect(todayIn("Europe/Berlin", now)).toBe("2026-10-25");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-10-24");
    const lateUtc = at("2026-10-25T06:59:59Z");
    expect(todayIn("America/Los_Angeles", lateUtc)).toBe("2026-10-24"); // 23:59:59 PDT
    expect(todayIn("America/Los_Angeles", at("2026-10-25T07:00:00Z"))).toBe("2026-10-25");
  });

  it("Los Angeles DST change on 2026-11-01: midnight moves from 07:00 to 08:00 UTC", () => {
    expect(todayIn("America/Los_Angeles", at("2026-11-01T06:59:59Z"))).toBe("2026-10-31");
    expect(todayIn("America/Los_Angeles", at("2026-11-01T07:00:00Z"))).toBe("2026-11-01");
    expect(todayIn("America/Los_Angeles", at("2026-11-02T07:59:59Z"))).toBe("2026-11-01"); // 23:59:59 PST
    expect(todayIn("America/Los_Angeles", at("2026-11-02T08:00:00Z"))).toBe("2026-11-02");
  });

  it("falls back to Europe/Berlin for a missing or unknown zone", () => {
    const now = at("2026-10-24T22:30:00Z");
    expect(DEFAULT_TIME_ZONE).toBe("Europe/Berlin");
    for (const tz of [undefined, null, "", "  ", "Mars/Olympus"]) {
      expect(resolveTimeZone(tz)).toBe("Europe/Berlin");
      expect(todayIn(tz, now)).toBe("2026-10-25");
    }
  });
});

describe("currentStreak / streakRecord (one implementation for Home, Journal, Insights)", () => {
  const run = (end: string, n: number) => Array.from({ length: n }, (_, i) => addDays(end, -i));

  it("ends today when today has an entry", () => {
    expect(currentStreak(run("2026-10-25", 5), "2026-10-25")).toBe(5);
  });

  it("ends yesterday when today has no entry yet", () => {
    expect(currentStreak(run("2026-10-24", 3), "2026-10-25")).toBe(3);
  });

  it("is 0 when neither today nor yesterday has an entry; a gap ends the streak", () => {
    expect(currentStreak(run("2026-10-23", 4), "2026-10-25")).toBe(0);
    expect(currentStreak(["2026-10-25", "2026-10-24", "2026-10-22", "2026-10-21"], "2026-10-25")).toBe(2);
    expect(currentStreak([], "2026-10-25")).toBe(0);
  });

  it("ignores duplicates, order and invalid strings", () => {
    const dates = ["2026-10-24", "2026-10-25", "2026-10-25", "garbage", "2026-10-23", ""];
    expect(currentStreak(dates, "2026-10-25")).toBe(3);
    expect(streakRecord(dates)).toBe(3);
  });

  it("counts across the DST day and month/year ends (calendar days, not 24 h blocks)", () => {
    expect(currentStreak(["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-26")).toBe(3);
    expect(currentStreak(["2026-12-31", "2027-01-01"], "2027-01-01")).toBe(2);
    expect(currentStreak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01")).toBe(3);
  });

  it("with todayIn: an entry written at 00:30 Berlin counts for the new day", () => {
    const now = at("2026-10-24T22:30:00Z"); // 2026-10-25 00:30 Berlin, still 10-24 in UTC
    const dates = run("2026-10-25", 2);
    expect(currentStreak(dates, todayIn("Europe/Berlin", now))).toBe(2);
    expect(currentStreak(dates, todayIn("UTC", now))).toBe(1); // 10-25 is "tomorrow" there
  });

  it("record is the longest run anywhere, at least the current streak", () => {
    const dates = [...run("2026-10-10", 6), ...run("2026-10-25", 3)];
    expect(streakRecord(dates)).toBe(6);
    expect(currentStreak(dates, "2026-10-25")).toBe(3);
    expect(streakRecord([])).toBe(0);
    expect(streakRecord(["2026-10-01"])).toBe(1);
  });
});

describe("reviewDue (Wochen-Review badge)", () => {
  // 2026-10-25 is a Sunday, 2026-10-26 a Monday.
  it("is due today when today is the review day", () => {
    const due = reviewDue(at("2026-10-25T10:00:00Z"), "Europe/Berlin", 0);
    expect(due).toEqual({ date: "2026-10-25", weekdayShort: "So", daysUntil: 0, weekStart: "2026-10-19" });
  });

  it("otherwise the next review weekday", () => {
    expect(reviewDue(at("2026-10-25T10:00:00Z"), "Europe/Berlin", 5)).toMatchObject({
      date: "2026-10-30",
      weekdayShort: "Fr",
      daysUntil: 5,
    });
  });

  it("midnight: Saturday 23:59 Berlin → Sunday review is tomorrow; 00:00 → today", () => {
    expect(reviewDue(at("2026-10-24T21:59:59Z"), "Europe/Berlin", 0)).toMatchObject({
      date: "2026-10-25",
      daysUntil: 1,
    });
    expect(reviewDue(at("2026-10-24T22:00:00Z"), "Europe/Berlin", 0)).toMatchObject({
      date: "2026-10-25",
      daysUntil: 0,
    });
  });

  it("after the review day passes, the next one is a week later (no 'overdue' yesterday)", () => {
    // Sunday review; Monday 00:00 Berlin (CET, DST already over) → next Sunday.
    expect(reviewDue(at("2026-10-25T23:00:00Z"), "Europe/Berlin", 0)).toMatchObject({
      date: "2026-11-01",
      daysUntil: 6,
      weekStart: "2026-10-26",
    });
  });

  it("time zones: one instant, three answers (Friday review)", () => {
    const now = at("2026-10-23T22:30:00Z"); // Fri 22:30 UTC = Sat 00:30 Berlin = Fri 15:30 LA
    expect(reviewDue(now, "UTC", 5)).toMatchObject({ date: "2026-10-23", daysUntil: 0 });
    expect(reviewDue(now, "America/Los_Angeles", 5)).toMatchObject({ date: "2026-10-23", daysUntil: 0 });
    expect(reviewDue(now, "Europe/Berlin", 5)).toMatchObject({ date: "2026-10-30", daysUntil: 6 });
  });

  it("DST change week: the badge never switches weekday, only the date moves on", () => {
    const fri = 5;
    const instants = [
      "2026-10-24T21:00:00Z", // Sat 23:00 CEST
      "2026-10-25T00:30:00Z", // Sun 02:30 CEST (before the switch)
      "2026-10-25T01:30:00Z", // Sun 02:30 CET (after the switch)
      "2026-10-25T23:30:00Z", // Mon 00:30 CET
    ];
    const badges = instants.map((i) => reviewDue(at(i), "Europe/Berlin", fri)!);
    expect(new Set(badges.map((b) => b.weekdayShort))).toEqual(new Set(["Fr"]));
    expect(badges.map((b) => b.date)).toEqual(["2026-10-30", "2026-10-30", "2026-10-30", "2026-10-30"]);
  });

  it("week starts Monday: on Monday a Sunday review is the coming Sunday of the same week", () => {
    const monday = at("2026-10-26T08:00:00Z");
    expect(reviewDue(monday, "Europe/Berlin", 0)).toMatchObject({
      date: "2026-11-01",
      weekStart: "2026-10-26",
    });
    expect(reviewDue(monday, "Europe/Berlin", 1)).toMatchObject({
      date: "2026-10-26",
      daysUntil: 0,
      weekStart: "2026-10-26",
    });
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday belongs to the week before
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
  });

  it("no badge for a missing or invalid digest day (no So/Fr guess while loading)", () => {
    const now = at("2026-10-25T10:00:00Z");
    for (const d of [undefined, null, -1, 7, 2.5, Number.NaN]) expect(reviewDue(now, "UTC", d)).toBeNull();
  });

  it("unknown zone falls back to Europe/Berlin", () => {
    const now = at("2026-10-24T22:30:00Z");
    expect(reviewDue(now, "Nowhere/City", 0)).toEqual(reviewDue(now, "Europe/Berlin", 0));
  });

  it("tooltip carries the date", () => {
    expect(reviewDueTooltip(reviewDue(at("2026-10-25T10:00:00Z"), "Europe/Berlin", 5)!)).toBe(
      "Wochen-Review fällig: Fr, 30.10.2026",
    );
    expect(reviewDueTooltip(reviewDue(at("2026-10-25T10:00:00Z"), "Europe/Berlin", 0)!)).toBe(
      "Wochen-Review heute fällig (So, 25.10.2026)",
    );
  });
});

describe("daily texts in English", () => {
  it("names the review weekday and writes the tooltip in the current language", () => {
    // 2026-10-28 is a Wednesday; the review is due on Friday (5).
    const now = new Date("2026-10-28T10:00:00Z");
    const de = reviewDue(now, "Europe/Berlin", 5)!;
    expect(de.weekdayShort).toBe("Fr");
    expect(reviewDueTooltip(de)).toBe("Wochen-Review fällig: Fr, 30.10.2026");
    withLocale("en", () => {
      const en = reviewDue(now, "Europe/Berlin", 5)!;
      expect(en.weekdayShort).toBe("Fri");
      expect(reviewDueTooltip(en)).toBe("Weekly review due: Fri, Oct 30, 2026");
      expect(energyLabel(2)).toBe("Very tired");
      expect(ENERGY_LABELS).toHaveLength(11);
      expect(energyDelta(1.62)).toBe("+1.6");
    });
    expect(energyLabel(2)).toBe("Sehr müde");
    expect(ENERGY_LABELS[10]).toBe("Voller Energie");
    expect(energyDelta(0)).toBe("±0,0");
  });
});
