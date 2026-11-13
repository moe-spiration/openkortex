import { describe, expect, it } from "vitest";
import {
  DRAWER_WIDTH_KEY,
  DW_MAX,
  DW_MIN,
  DW_START,
  clampWidth,
  drawerCssWidth,
  readDrawerWidth,
  toggleHalf,
  widthForKey,
  widthFromPointer,
  writeDrawerWidth,
} from "./drawer-width";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("drawer width (decision 6: 44 % start, 28 to 72 %, toggle 50 %)", () => {
  it("clamps to 28..72 and rounds; junk falls back to the start width", () => {
    expect(clampWidth(10)).toBe(DW_MIN);
    expect(clampWidth(99)).toBe(DW_MAX);
    expect(clampWidth(41.6)).toBe(42);
    expect(clampWidth("38")).toBe(38);
    expect(clampWidth(NaN)).toBe(DW_START);
    expect(clampWidth(undefined)).toBe(DW_START);
  });

  it("derives the width from the pointer over the canvas", () => {
    const rect = { left: 0, right: 1000 };
    expect(widthFromPointer(600, rect)).toBe(40);
    expect(widthFromPointer(100, rect)).toBe(DW_MAX);
    expect(widthFromPointer(950, rect)).toBe(DW_MIN);
    expect(widthFromPointer(5, { left: 10, right: 10 })).toBe(DW_START);
  });

  it("handles the separator keys", () => {
    expect(widthForKey("ArrowLeft", 44)).toBe(46);
    expect(widthForKey("ArrowLeft", 72)).toBe(72);
    expect(widthForKey("ArrowRight", 29)).toBe(28);
    expect(widthForKey("Home", 33)).toBe(DW_START);
    expect(widthForKey("End", 33)).toBe(DW_MAX);
    expect(widthForKey("a", 33)).toBeNull();
  });

  it("toggles between standard and half width", () => {
    expect(toggleHalf(44)).toBe(50);
    expect(toggleHalf(37)).toBe(50);
    expect(toggleHalf(50)).toBe(44);
    expect(toggleHalf(68)).toBe(50);
  });

  it("gives --drawer-w only while the drawer sits beside the view", () => {
    expect(drawerCssWidth("half", 47)).toBe("47%");
    expect(drawerCssWidth("full", 47)).toBe("0%");
    expect(drawerCssWidth("none", 47)).toBe("0%");
  });

  it("persists the clamped width in its own key", () => {
    const s = mem();
    expect(readDrawerWidth(s)).toBe(DW_START);
    writeDrawerWidth(77, s);
    expect(JSON.parse(s.m.get(DRAWER_WIDTH_KEY)!)).toEqual({ width: 72 });
    expect(readDrawerWidth(s)).toBe(72);
    s.m.set(DRAWER_WIDTH_KEY, "{oops");
    expect(readDrawerWidth(s)).toBe(DW_START);
    expect(readDrawerWidth(null)).toBe(DW_START);
  });
});
