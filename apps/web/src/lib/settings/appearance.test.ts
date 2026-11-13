// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  appearanceAttributes,
  applyAppearance,
  effectiveBackdrop,
  loadAppearance,
  parseAppearance,
  resolveDensity,
  saveAppearance,
} from "./appearance";

beforeEach(() => window.localStorage.clear());

describe("appearance prefs (Tactile Craft v2)", () => {
  it("defaults: accent glow, kompakt, full transparency", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ backdrop: "glow", density: "kompakt", densityByScope: {}, reduceTransparency: false, fontScale: 1 });
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("round-trips through localStorage", () => {
    const p = { backdrop: "pack" as const, density: "dicht" as const, densityByScope: { life: "komfort" as const }, reduceTransparency: true, fontScale: 0.9 as const };
    saveAppearance(p);
    expect(JSON.parse(window.localStorage.getItem(APPEARANCE_KEY)!)).toEqual(p);
    expect(loadAppearance()).toEqual(p);
  });

  it("sanitises garbage and unknown values", () => {
    window.localStorage.setItem(APPEARANCE_KEY, "{not json");
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ backdrop: "video", density: "riesig", reduceTransparency: "yes", densityByScope: { a: "dicht", b: "x", "": "komfort" } })).toEqual({
      backdrop: "glow",
      density: "kompakt",
      densityByScope: { a: "dicht" },
      reduceTransparency: false,
      fontScale: 1,
    });
    expect(parseAppearance({ fontScale: 3 }).fontScale).toBe(1);
    expect(parseAppearance({ fontScale: 0.85 }).fontScale).toBe(0.85);
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("backdrop choice", () => {
  it("pack shows only with full transparency", () => {
    expect(effectiveBackdrop({ backdrop: "pack", reduceTransparency: false })).toBe("pack");
    expect(effectiveBackdrop({ backdrop: "pack", reduceTransparency: true })).toBe("glow");
    expect(effectiveBackdrop({ backdrop: "glow", reduceTransparency: false })).toBe("glow");
  });

  it("writes the <html> attributes", () => {
    const el = document.createElement("html");
    applyAppearance({ ...DEFAULT_APPEARANCE, backdrop: "pack", density: "komfort" }, el);
    expect({ ...el.dataset }).toEqual({ backdrop: "pack", density: "komfort", glass: "on" });
    expect(el.style.getPropertyValue("--kx-fs")).toBe("1");
    applyAppearance({ ...DEFAULT_APPEARANCE, fontScale: 0.9 }, el);
    expect(el.style.getPropertyValue("--kx-fs")).toBe("0.9");
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, backdrop: "pack", reduceTransparency: true })).toEqual({ backdrop: "glow", density: "kompakt", glass: "solid" });
  });
});

describe("density resolution", () => {
  it("open drawer > the view's choice > the view's default > Standard-Dichte", () => {
    expect(resolveDensity({ global: "kompakt" })).toBe("kompakt");
    expect(resolveDensity({ global: "dicht", fallback: "komfort" })).toBe("komfort");
    expect(resolveDensity({ global: "kompakt", fallback: "komfort", scoped: "kompakt" })).toBe("kompakt");
    expect(resolveDensity({ global: "komfort", scoped: "komfort", drawerOpen: true })).toBe("dicht");
  });
});
