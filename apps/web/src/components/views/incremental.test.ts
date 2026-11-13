import { describe, expect, it } from "vitest";
import { INCREMENT, nextShown } from "./incremental";

describe("nextShown (lazy batches of long lists)", () => {
  it("grows by one batch and stops at the end of the list", () => {
    expect(nextShown(INCREMENT, 1500)).toBe(2 * INCREMENT);
    expect(nextShown(1480, 1500)).toBe(1500);
    expect(nextShown(1500, 1500)).toBe(1500);
  });

  it("reaches a row that must be in the DOM (scroll to day, J/K)", () => {
    expect(nextShown(60, 1500, 60, 700)).toBe(701);
    expect(nextShown(60, 500, 60, 900)).toBe(500);
  });

  it("never drops below the first batch", () => {
    expect(nextShown(0, 1000, 40)).toBe(40);
  });
});
