import { describe, expect, it } from "vitest";
import { swipeIntent } from "./mobile-nav";

describe("swipeIntent", () => {
  it("closes the open drawer on a swipe to the left", () => {
    expect(swipeIntent({ x: 220, y: 400 }, { x: 60, y: 410 }, true)).toBe("close");
  });

  it("opens the closed drawer on a swipe to the right from the left edge", () => {
    expect(swipeIntent({ x: 8, y: 300 }, { x: 140, y: 310 }, false)).toBe("open");
  });

  it("ignores a swipe to the right that starts away from the edge", () => {
    expect(swipeIntent({ x: 120, y: 300 }, { x: 300, y: 300 }, false)).toBeNull();
  });

  it("ignores short and mostly vertical moves", () => {
    expect(swipeIntent({ x: 200, y: 300 }, { x: 170, y: 300 }, true)).toBeNull();
    expect(swipeIntent({ x: 200, y: 100 }, { x: 120, y: 400 }, true)).toBeNull();
  });

  it("does nothing for a swipe in the drawer's current direction", () => {
    expect(swipeIntent({ x: 100, y: 300 }, { x: 260, y: 300 }, true)).toBeNull();
    expect(swipeIntent({ x: 10, y: 300 }, { x: -100, y: 300 }, false)).toBeNull();
  });
});
