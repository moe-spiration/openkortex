import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBridge, MOCK_START_ELAPSED, mockDb } from "@/bridge/mock";
import { resolveWindow } from "@/windowRoute";
import { waveBars } from "@/components/Wave";

describe("mock bridge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks the meeting clock from 18:42 and emits ~30 dB levels per second around the prototype values", () => {
    const b = createMockBridge();
    const ticks: number[] = [];
    const levels: number[][] = [];
    b.listen("meeting:tick", ({ elapsed }) => ticks.push(elapsed));
    b.listen("audio:levels", ({ ch0, ch1 }) => levels.push([ch0.db, ch1.db]));
    vi.advanceTimersByTime(3000);
    expect(ticks).toEqual([MOCK_START_ELAPSED + 1, MOCK_START_ELAPSED + 2, MOCK_START_ELAPSED + 3]);
    // Like the native core (audio.rs LEVEL_INTERVAL 33 ms): ~90 levels in 3 s.
    expect(levels.length).toBeGreaterThanOrEqual(85);
    const [a, b2] = levels[0]!;
    expect(a).toBeLessThanOrEqual(mockDb(MOCK_START_ELAPSED, -12, 3));
    expect(a).toBeGreaterThanOrEqual(mockDb(MOCK_START_ELAPSED, -12, 3) - 6);
    expect(b2).toBeLessThanOrEqual(mockDb(MOCK_START_ELAPSED, -17, 2));
    expect(b2).toBeGreaterThanOrEqual(mockDb(MOCK_START_ELAPSED, -17, 2) - 6);
    b.dispose();
  });

  it("stops ticking after stop_recording and restarts from 0", async () => {
    const b = createMockBridge();
    const ticks: number[] = [];
    b.listen("meeting:tick", ({ elapsed }) => ticks.push(elapsed));
    const stopped = b.invoke("stop_recording");
    vi.advanceTimersByTime(2000);
    await expect(stopped).resolves.toMatchObject({ uploading: true });
    expect(ticks).toEqual([]);
    await b.invoke("start_recording");
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([1]);
    b.dispose();
  });

  it("unsubscribes listeners", () => {
    const b = createMockBridge();
    const cb = vi.fn();
    const off = b.listen("meeting:tick", cb);
    off();
    vi.advanceTimersByTime(2000);
    expect(cb).not.toHaveBeenCalled();
    b.dispose();
  });
});

describe("window routing", () => {
  it("maps known labels and falls back to the preview", () => {
    expect(resolveWindow("hud")).toBe("hud");
    expect(resolveWindow("settings")).toBe("settings");
    expect(resolveWindow("nope")).toBeNull();
    expect(resolveWindow(null)).toBeNull();
  });
});

describe("waveform", () => {
  it("matches the prototype envelope (deterministic, min 14 %)", () => {
    const bars = waveBars(16, 0.9);
    expect(bars).toHaveLength(16);
    expect(Math.min(...bars.map((b) => b.hp))).toBeGreaterThanOrEqual(14);
    expect(waveBars(16, 0.9)).toEqual(bars);
    // symmetric envelope: middle bars are fuller than the edges
    expect(Number(bars[8]!.op)).toBeGreaterThan(Number(bars[0]!.op));
  });
});
