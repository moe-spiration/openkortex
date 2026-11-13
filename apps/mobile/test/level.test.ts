import { describe, expect, it } from "vitest";
import { autoGain, dbToLevel, GAIN_START, pushLevel, smooth, voiceRejection } from "../src/capture/level";

describe("mic level (A4)", () => {
  it("maps dBFS to 0 … 1", () => {
    expect(dbToLevel(undefined)).toBe(0);
    expect(dbToLevel(-160)).toBe(0);
    expect(dbToLevel(-50)).toBe(0);
    expect(dbToLevel(-5)).toBe(1);
    expect(dbToLevel(0)).toBe(1);
    expect(dbToLevel(-27.5)).toBeCloseTo(0.5);
    expect(dbToLevel(Number.NaN)).toBe(0);
  });

  it("rises fast and falls slowly", () => {
    expect(smooth(0, 1)).toBeCloseTo(0.65);
    expect(smooth(1, 0)).toBeCloseTo(0.75);
  });

  it("keeps a fixed-length history, newest last", () => {
    expect(pushLevel([0.1, 0.2, 0.3], 0.9, 3)).toEqual([0.2, 0.3, 0.9]);
    expect(pushLevel([], 0.5, 3)).toEqual([0, 0, 0.5]);
  });
});

describe("auto gain", () => {
  it("treats a zero amplitude (-160) and junk as silence without moving", () => {
    expect(autoGain(GAIN_START, -160)).toEqual({ gain: GAIN_START, level: 0 });
    expect(autoGain(GAIN_START, undefined).level).toBe(0);
  });

  it("moves the meter for a quiet microphone that the fixed window would miss", () => {
    let g = GAIN_START;
    // Room noise around -58 dB, then speech around -42 dB (dbToLevel would show ~0.18).
    for (let i = 0; i < 30; i++) g = autoGain(g, -58 + (i % 3)).gain;
    const speech = autoGain(g, -42).level;
    expect(speech).toBeGreaterThan(0.6);
    expect(autoGain(g, -57).level).toBeLessThan(0.25);
  });

  it("keeps at least the minimum span, so steady noise stays low", () => {
    let g = GAIN_START;
    let level = 1;
    for (let i = 0; i < 400; i++) ({ gain: g, level } = autoGain(g, -50));
    expect(g.peak - g.floor).toBeGreaterThanOrEqual(18);
    expect(level).toBeLessThan(0.1);
  });
});

describe("voiceRejection", () => {
  it("rejects recordings under one second", () => {
    expect(voiceRejection(0, -10)).toBe("short");
  });
  it("rejects a recording whose loudest sample stays near the floor", () => {
    expect(voiceRejection(4, -58)).toBe("silent");
  });
  it("lets speech and recordings without meter data through", () => {
    expect(voiceRejection(3, -20)).toBeNull();
    expect(voiceRejection(3, undefined)).toBeNull();
  });
});
