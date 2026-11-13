import { describe, expect, it } from "vitest";
import { ACCENT_SWATCHES, accentFill, accentHex, accentPair, contrastRatio, onAccentColor, parseHex } from "./accent";

describe("--on-accent against the actual fill (Tactile Craft v2, WCAG AA)", () => {
  it("white on saturated and dark accents, dark ink on light ones", () => {
    for (const hex of ["#8B5CF6", "#6366F1", "#1D4ED8", "#000000"]) expect(onAccentColor(hex), hex).toBe("#FFFFFF");
    for (const hex of ["#FDE047", "#A3E635", "#67E8F9", "#FFFFFF", "#10B981", "#F97316"]) expect(onAccentColor(hex), hex).toBe("#111114");
  });
  it("every swatch reaches 4.5:1 on its fill", () => {
    for (const s of ACCENT_SWATCHES) {
      const [fill, on] = accentFill(accentHex(s.value));
      expect(contrastRatio(fill, on), s.label).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("falls back to the default accent for anything that is not #rrggbb", () => {
    expect(onAccentColor("violet")).toBe(onAccentColor("#6366F1"));
  });
});

describe("accent swatches and hex input", () => {
  it("presets keep their ids, Grün and Orange are stored as hex", () => {
    expect(ACCENT_SWATCHES.map((s) => s.value).slice(0, 3)).toEqual(["violet", "#10B981", "#F97316"]);
    for (const s of ACCENT_SWATCHES) expect(accentHex(s.value).toUpperCase(), s.label).toBe(s.hex);
    expect(accentPair("#10B981")[0]).toBe("#10B981");
  });
  it("parses typed hex values", () => {
    expect(parseHex("8b5cf6")).toBe("#8B5CF6");
    expect(parseHex(" #abc ")).toBe("#AABBCC");
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("lila")).toBeNull();
  });
});
