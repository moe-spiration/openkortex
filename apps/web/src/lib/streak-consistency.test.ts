import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDays, currentStreak, streakRecord, todayIn } from "@kortex/db/daily";
import { dailyStreak } from "@/lib/supabase/live-views";
import { streaks } from "@/server/insights/compute";
import type { DailyEntry } from "@/server/life/source";

/*
 * W6/A-08: Home (hero + check-in, via the snapshot's dailyStreak), Journal (dailyStreakNow = the
 * same snapshot value) and Insights (streaks) show one number for the same daily notes. All of them
 * go through @kortex/db/daily currentStreak.
 */

const entry = (date: string): DailyEntry => ({ date, energy: null, habits: [], focusDone: 0, focusTotal: 0 });
const run = (end: string, n: number) => Array.from({ length: n }, (_, i) => addDays(end, -i));

// 2026-10-25: end of summer time in Europe/Berlin (03:00 CEST → 02:00 CET, 01:00 UTC).
const INSTANTS = [
  "2026-10-24T21:59:59Z", // Sat 23:59:59 CEST
  "2026-10-24T22:00:00Z", // Sun 00:00 CEST
  "2026-10-25T00:30:00Z", // Sun 02:30 CEST (before the switch)
  "2026-10-25T01:30:00Z", // Sun 02:30 CET (after the switch)
  "2026-10-25T22:59:59Z", // Sun 23:59:59 CET
  "2026-10-25T23:00:00Z", // Mon 00:00 CET
];

const DATASETS: string[][] = [
  [],
  run("2026-10-25", 1), // only the DST day
  run("2026-10-24", 5), // up to the Saturday before
  run("2026-10-25", 9), // across the switch
  [...run("2026-10-26", 3), ...run("2026-10-20", 4)], // gap on 10-23
  ["2026-10-25", "2026-10-25", "2026-10-24", "kaputt"], // duplicates, garbage
];

describe("one streak for Home, Journal and Insights (A-08)", () => {
  it.each(INSTANTS)("same value everywhere at %s (Europe/Berlin)", (iso) => {
    const today = todayIn("Europe/Berlin", new Date(iso));
    for (const dates of DATASETS) {
      const shared = currentStreak(dates, today);
      expect(dailyStreak(dates, today)).toBe(shared); // Home + Journal (snapshot)
      expect(streaks(dates.map(entry), today).streak).toBe(shared); // Insights
    }
  });

  it("the DST day counts as one calendar day: a streak runs straight through it", () => {
    const dates = run("2026-10-26", 4); // 23, 24, 25, 26
    expect(currentStreak(dates, todayIn("Europe/Berlin", new Date("2026-10-25T23:00:00Z")))).toBe(4);
    // 00:30 Berlin on the DST morning: the Saturday note keeps the streak alive, today has none yet.
    const sat = run("2026-10-24", 3);
    expect(currentStreak(sat, todayIn("Europe/Berlin", new Date("2026-10-24T22:30:00Z")))).toBe(3);
    // The same instant is still Saturday in UTC and Los Angeles.
    expect(todayIn("UTC", new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-24");
    expect(todayIn("America/Los_Angeles", new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-24");
  });

  it("Insights record = the shared streakRecord, never below the current streak", () => {
    const dates = [...run("2026-10-10", 6), ...run("2026-10-25", 2)];
    expect(streaks(dates.map(entry), "2026-10-25")).toEqual({ streak: 2, record: streakRecord(dates) });
    expect(streakRecord(dates)).toBe(6);
  });

  it("code search: no other streak loop left in the web app", () => {
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const src = readFileSync(p, "utf8");
          // The old copies counted back day by day: `while (set.has(day))` / `while (days.has(day))`.
          if (/while\s*\(\s*\w+\.has\(\s*day\s*\)\s*\)/.test(src)) offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
