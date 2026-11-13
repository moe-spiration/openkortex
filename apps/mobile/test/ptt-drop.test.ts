import { describe, expect, it } from "vitest";
import { PTT_DISCARD, PTT_NO_RECTS, PTT_NONE, PTT_SAVE, pttDropTarget } from "../src/capture/pttDrop";

// Voice card buttons on a 412px wide phone: two halves with an 8px gap.
const RECTS = [28, 700, 174, 44, 210, 700, 174, 44];

describe("push-to-talk drop target (hit test)", () => {
  it("hits the discard button", () => {
    expect(pttDropTarget(100, 720, RECTS)).toBe(PTT_DISCARD);
    expect(pttDropTarget(28, 700, RECTS)).toBe(PTT_DISCARD);
  });

  it("hits the save button", () => {
    expect(pttDropTarget(300, 720, RECTS)).toBe(PTT_SAVE);
    expect(pttDropTarget(384, 744, RECTS)).toBe(PTT_SAVE);
  });

  it("misses above, below and beside the buttons", () => {
    expect(pttDropTarget(100, 600, RECTS)).toBe(PTT_NONE);
    expect(pttDropTarget(300, 800, RECTS)).toBe(PTT_NONE);
    expect(pttDropTarget(5, 720, RECTS)).toBe(PTT_NONE);
    expect(pttDropTarget(206, 820, RECTS)).toBe(PTT_NONE);
  });

  it("counts the slop around a button", () => {
    expect(pttDropTarget(100, 692, RECTS)).toBe(PTT_DISCARD);
    expect(pttDropTarget(100, 689, RECTS)).toBe(PTT_NONE);
    expect(pttDropTarget(100, 692, RECTS, 0)).toBe(PTT_NONE);
  });

  it("splits the gap between the buttons by the nearer centre", () => {
    expect(pttDropTarget(204, 720, RECTS)).toBe(PTT_DISCARD);
    expect(pttDropTarget(208, 720, RECTS)).toBe(PTT_SAVE);
  });

  it("never hits before the buttons are measured", () => {
    expect(pttDropTarget(100, 720, PTT_NO_RECTS)).toBe(PTT_NONE);
    expect(pttDropTarget(0, 0, PTT_NO_RECTS)).toBe(PTT_NONE);
    expect(pttDropTarget(100, 720, [])).toBe(PTT_NONE);
  });

  it("ignores non-finite points", () => {
    expect(pttDropTarget(Number.NaN, 720, RECTS)).toBe(PTT_NONE);
    expect(pttDropTarget(100, Number.POSITIVE_INFINITY, RECTS)).toBe(PTT_NONE);
  });
});
