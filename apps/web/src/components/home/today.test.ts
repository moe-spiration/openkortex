import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/date/today", () => ({ todayIso: () => "2026-10-22" }));

const { msUntilNextDay, watchToday } = await import("./today");

/** Workspace day in Europe/Berlin (what todayIso does live). */
const berlin = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** document / window stand-ins with dispatchable events. */
function fakeEnv() {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const win = new EventTarget();
  return { doc, win };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("workspace today (N5 #11)", () => {
  it("msUntilNextDay finds Berlin midnight, also from a browser in another zone", () => {
    // 2026-10-25 22:30 UTC = 23:30 CET (after the DST switch): midnight in 30 min.
    const ms = msUntilNextDay(new Date("2026-10-25T22:30:00Z"), berlin)!;
    expect(Math.abs(ms - 30 * 60_000)).toBeLessThanOrEqual(1000);
    // 23:30 UTC: a UTC browser still says 2026-10-25, the workspace (Berlin) is on the next day.
    expect(berlin(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
  });

  it("msUntilNextDay is null when the day never changes (mock mode)", () => {
    expect(msUntilNextDay(new Date(), () => "2026-10-22")).toBeNull();
  });

  it("a tab left open over midnight switches the day at Berlin midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T22:59:00Z")); // 23:59 Berlin
    const { doc, win } = fakeEnv();
    const onDay = vi.fn();
    const stop = watchToday(onDay, { today: berlin, doc, win });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onDay).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onDay).toHaveBeenCalledWith("2026-10-26");
    stop();
  });

  it("re-evaluates when the tab becomes visible or gets focus (timers throttled in the background)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T20:00:00Z"));
    const { doc, win } = fakeEnv();
    const onDay = vi.fn();
    const stop = watchToday(onDay, { today: berlin, doc, win });
    // The machine slept through midnight: the clock jumps, no timer has fired yet.
    vi.setSystemTime(new Date("2026-10-26T07:00:00Z"));
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(onDay).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(onDay).toHaveBeenCalledWith("2026-10-26");
    // Same day again on focus: no second call.
    win.dispatchEvent(new Event("focus"));
    expect(onDay).toHaveBeenCalledTimes(1);
    stop();
  });

  it("unsubscribes listeners and the timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T22:59:00Z"));
    const { doc, win } = fakeEnv();
    const onDay = vi.fn();
    watchToday(onDay, { today: berlin, doc, win })();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    win.dispatchEvent(new Event("focus"));
    expect(onDay).not.toHaveBeenCalled();
  });
});
