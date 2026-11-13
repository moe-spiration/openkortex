import { describe, expect, it } from "vitest";
import { ON_ACCENT_DARK, accentFill, accentPair, contrastRatio, onAccentColor } from "./accent";

/** Every swatch of Settings > Erscheinungsbild (web ACCENT_SWATCHES). */
const SWATCHES: Record<string, string> = {
  Lila: "#8B5CF6",
  Grün: "#10B981",
  Orange: "#F97316",
  Indigo: "#6366F1",
  Blau: "#3B82F6",
  Teal: "#14B8A6",
  Rosa: "#F43F5E",
  Bernstein: "#F59E0B",
};
/** Free colours, including the extremes. */
const FREE = ["#FFFF00", "#00FFFF", "#FF00FF", "#808080", "#FFFFFF", "#000000", "#84CC16", "#06B6D4", "#EAB308", "#A3A3A3", "#EC4899", "#7C3AED", "#22C55E", "#D946EF", "#0EA5E9", "#9CA3AF", "#777777", "#8A8A8A"];

function hsl(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return ("#" + f(0) + f(8) + f(4)).toUpperCase();
}

describe("accent fill and the text on it (WCAG AA)", () => {
  // --accent-fill / --on-accent are the same tokens in dark and light (tokens.css derivations), so the theme only
  // labels the run; both are checked so a later theme-specific fill has to pass here too.
  describe.each(["dark", "light"] as const)("%s", () => {
    it.each(Object.entries(SWATCHES))("%s reaches 4.5:1", (_label, hex) => {
      const [fill, on] = accentFill(hex);
      expect(contrastRatio(fill, on)).toBeGreaterThanOrEqual(4.5);
      expect(onAccentColor(hex)).toBe(on);
    });

    it("free colours over the whole hue circle reach 4.5:1", () => {
      for (let h = 0; h < 360; h += 10)
        for (const [s, l] of [
          [100, 50],
          [80, 65],
          [70, 40],
          [90, 75],
          [40, 55],
        ] as const) {
          const hex = hsl(h, s, l);
          const [fill, on] = accentFill(hex);
          expect(contrastRatio(fill, on), `${hex} → ${fill}/${on}`).toBeGreaterThanOrEqual(4.5);
        }
      for (const hex of FREE) {
        const [fill, on] = accentFill(hex);
        expect(contrastRatio(fill, on), hex).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("keeps light accents bright and gives them dark text instead of darkening them", () => {
    for (const label of ["Grün", "Orange", "Bernstein", "Teal"]) expect(accentFill(SWATCHES[label]!)[1], label).toBe(ON_ACCENT_DARK);
    for (const label of ["Lila", "Indigo"]) expect(accentFill(SWATCHES[label]!)[1], label).toBe("#FFFFFF");
  });

  it("stays close to the accent (oklch 90 % + black)", () => {
    for (const hex of Object.values(SWATCHES)) expect(contrastRatio(accentFill(hex)[0], hex), hex).toBeLessThan(1.6);
  });

  it("falls back to indigo for invalid values and keeps the preset pairs", () => {
    expect(accentFill("nope")).toEqual(accentFill("#6366F1"));
    expect(accentPair("violet")).toEqual(["#8B5CF6", "#6D28D9"]);
    expect(accentPair("#10B981")[0]).toBe("#10B981");
    expect(accentPair(null)[0]).toBe("#6366F1");
  });

  it("is self-contained (the web inlines it into the pre-paint script)", () => {
    const fill = new Function(`return (${accentFill.toString()})`)() as typeof accentFill;
    expect(fill("#F97316")).toEqual(accentFill("#F97316"));
    const pair = new Function(`return (${accentPair.toString()})`)() as typeof accentPair;
    expect(pair("#123456")).toEqual(accentPair("#123456"));
  });
});
