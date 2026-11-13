import { describe, expect, it } from "vitest";
import { MOCK_TODAY } from "@/lib/workspace-data";
import { todayDate, todayIso } from "./today";

// The test environment runs in mock mode (no Supabase keys), so "today" is the prototype's day.
describe("today (mock mode)", () => {
  it("is the frozen mock day, whatever the clock says", () => {
    expect(todayIso(new Date("2030-01-05T12:00:00Z"))).toBe(MOCK_TODAY);
  });

  it("keeps the current time of day on the mock date", () => {
    const now = new Date(2030, 0, 5, 18, 30, 0);
    const d = todayDate(now);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-")).toBe(MOCK_TODAY.split("-").map(Number).join("-"));
    expect([d.getHours(), d.getMinutes()]).toEqual([18, 30]);
  });
});
