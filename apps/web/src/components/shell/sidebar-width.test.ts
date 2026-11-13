// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clampWidth, readWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, widthForKey, writeWidth } from "./sidebar-width";

beforeEach(() => window.localStorage.clear());

describe("sidebar width (feedback round 2 #5)", () => {
  it("clamps to 200-360 px and rounds", () => {
    expect(clampWidth(120)).toBe(SIDEBAR_MIN);
    expect(clampWidth(999)).toBe(SIDEBAR_MAX);
    expect(clampWidth(287.6)).toBe(288);
    expect(clampWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
  });

  it("stores per device; the default removes the entry; garbage reads as default", () => {
    expect(readWidth()).toBe(SIDEBAR_DEFAULT);
    writeWidth(320);
    expect(readWidth()).toBe(320);
    writeWidth(SIDEBAR_DEFAULT);
    expect(window.localStorage.length).toBe(0);
    window.localStorage.setItem("kortex.sidebar.width.v1", "abc");
    expect(readWidth()).toBe(SIDEBAR_DEFAULT);
    window.localStorage.setItem("kortex.sidebar.width.v1", "9000");
    expect(readWidth()).toBe(SIDEBAR_MAX);
  });

  it("keyboard: arrows 10 px (Shift 40 px), Home/End limits, Enter default, other keys nothing", () => {
    expect(widthForKey(260, "ArrowRight", false)).toBe(270);
    expect(widthForKey(260, "ArrowLeft", true)).toBe(220);
    expect(widthForKey(205, "ArrowLeft", true)).toBe(SIDEBAR_MIN);
    expect(widthForKey(355, "ArrowRight", false)).toBe(SIDEBAR_MAX);
    expect(widthForKey(300, "Home", false)).toBe(SIDEBAR_MIN);
    expect(widthForKey(300, "End", false)).toBe(SIDEBAR_MAX);
    expect(widthForKey(300, "Enter", false)).toBe(SIDEBAR_DEFAULT);
    expect(widthForKey(300, "a", false)).toBeNull();
  });
});
