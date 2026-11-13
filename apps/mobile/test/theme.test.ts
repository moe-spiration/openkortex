import { describe, expect, it } from "vitest";
import { alpha, contrast, mix, mixOklch, onAccentFor, parseColor, rgbToOklch, solidFor, toCss } from "../src/theme/color";
import { greetingFor, initialOf } from "../src/lib/greeting";
import { t } from "../src/i18n";
import { ACCENTS, accentHex, accentPair, createTheme, isAccentValue, parseHex, RADIUS, TYPE } from "../src/theme/tokens";

describe("colour maths", () => {
  it("parses hex and rgba", () => {
    expect(parseColor("#6366F1")).toEqual([99, 102, 241, 1]);
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("rgba(24, 24, 32, 0.74)")).toEqual([24, 24, 32, 0.74]);
  });

  it("mixes like color-mix(in srgb)", () => {
    expect(mix("#6366F1", 52, "#FFFFFF")).toBe("#AEAFF8");
    expect(mix("#000000", 50, "#FFFFFF")).toBe("#808080");
  });

  it("applies opacity", () => {
    expect(alpha("#6366F1", 0.14)).toBe("rgba(99, 102, 241, 0.14)");
    expect(toCss([1, 2, 3, 1])).toBe("#010203");
  });

  it("darkens custom accents until white text has 4.6:1", () => {
    const [r, g, b] = parseColor(solidFor("#F59E0B"));
    expect(r + g + b).toBeLessThan(245 + 158 + 11);
    expect(solidFor("#1D4ED8")).toBe("#1D4ED8");
  });
});

describe("oklch (color-mix in oklch like the web accent layer)", () => {
  it("round-trips sRGB through OKLCH", () => {
    const [l, c] = rgbToOklch(parseColor("#FFFFFF"));
    expect(l).toBeCloseTo(1, 4);
    expect(c).toBeLessThan(1e-3);
    expect(mixOklch("#6366F1", 100, "#000000")).toBe("#6366F1");
    expect(mixOklch("#10B981", 0, "#FFFFFF")).toBe("#FFFFFF");
  });

  it("keeps the hue when mixing with white or black and moves lightness the right way", () => {
    const ink = rgbToOklch(parseColor(mixOklch("#8B5CF6", 66, "#FFFFFF")));
    const raw = rgbToOklch(parseColor("#8B5CF6"));
    expect(ink[2]).toBeCloseTo(raw[2], 0);
    expect(ink[0]).toBeGreaterThan(raw[0]);
    const fill = rgbToOklch(parseColor(mixOklch("#8B5CF6", 90, "#000000")));
    expect(fill[0]).toBeCloseTo(raw[0] * 0.9, 2);
  });

  it("picks the text on the accent fill at 4.5:1 or more (like @kortex/ui/accent)", () => {
    expect(onAccentFor("#8B5CF6")).toBe("#FFFFFF");
    expect(onAccentFor("#10B981")).toBe("#111114");
    expect(onAccentFor("#FDE047")).toBe("#111114");
  });
});

describe("theme", () => {
  it("ports the Tactile Craft v2 steps and maps the legacy names onto them", () => {
    const dark = createTheme("dark");
    expect([dark.lum0, dark.lum1, dark.lum2, dark.lum3, dark.lum4]).toEqual(["#0B0B0E", "#121216", "#18181D", "#1F1F25", "#27272E"]);
    expect(dark.bgMainWindow).toBe(dark.lum1);
    expect(dark.bgSurfaceFlat).toBe(dark.lum2);
    expect(dark.accentAi).toBe("#6366F1");
    expect(dark.tags.ai.fg).toBe(dark.accentInk);
    const light = createTheme("light");
    expect([light.lum0, light.lum1, light.lum2, light.lum3, light.lum4]).toEqual(["#E7E5DF", "#F8F7F3", "#FEFDFB", "#F1F0EB", "#E8E6E0"]);
    expect(light.textMuted).toBe("#66666E");
    expect(light.accentAi).toBe(light.accentInk);
    expect(light.accentCheckin).toBe("#0F766E");
  });

  it("builds the edge recipes: light upper edge floats, dark upper edge is recessed", () => {
    const d = createTheme("dark");
    expect(d.edgeSurface).toBe("inset 0 1px 0 0 rgba(255, 255, 255, 0.085), 0 0 0 1px rgba(255, 255, 255, 0.06)");
    expect(d.edgeInset.startsWith("inset 0 1px 0 0 rgba(0, 0, 0, 0.55)")).toBe(true);
    expect(d.edgeFloat).toContain("0 24px 48px -20px");
    expect(d.shadowFloating).toBe(d.edgeFloat);
  });

  it("derives the accent layer from any swatch or free hex colour", () => {
    expect(accentPair("teal")).toEqual({ accent: "#14B8A6", solid: "#0F766E" });
    expect(createTheme("dark", "rose").accentAi).toBe("#F43F5E");
    const g = createTheme("dark", "#10B981");
    expect(g.accent).toBe("#10B981");
    expect(g.accentSoft).toBe("rgba(16, 185, 129, 0.15)");
    expect(g.accentLine).toBe("rgba(16, 185, 129, 0.42)");
    expect(createTheme("light", "#F97316").accentSoft).toBe("rgba(249, 115, 22, 0.1)");
    expect(createTheme("dark", "#123456").accentKey).toBe("#123456");
  });

  it("knows the web swatches (Lila, Grün, Orange first) and accepts free hex values", () => {
    expect(ACCENTS.slice(0, 3).map((a) => [t(a.label), a.accent])).toEqual([
      ["Lila", "#8B5CF6"],
      ["Grün", "#10B981"],
      ["Orange", "#F97316"],
    ]);
    expect(isAccentValue("violet")).toBe(true);
    expect(isAccentValue("#F97316")).toBe(true);
    expect(isAccentValue("#abc")).toBe(false);
    expect(isAccentValue("plum")).toBe(false);
    expect(accentHex("#10b981")).toBe("#10B981");
    expect(accentHex("nope")).toBe("#6366F1");
    expect(parseHex("abc")).toBe("#AABBCC");
    expect(parseHex("#8b5cf6")).toBe("#8B5CF6");
    expect(parseHex("xyz")).toBeNull();
  });

  it("keeps readable text on every accent fill", () => {
    for (const { key } of ACCENTS) {
      for (const name of ["dark", "light"] as const) {
        const t = createTheme(name, key);
        expect(contrast(t.onAccent, t.accentFill), `${name} ${key}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("board 11 (V2-11F/G/I)", () => {
  it("keeps light meta text at 4.5:1 or more on every light surface", () => {
    const l = createTheme("light");
    for (const bg of [l.bgMainWindow, l.bgSurfaceFlat, l.bgSurfaceMuted, l.bgAppShell, l.bgHover])
      for (const fg of [l.textMuted, l.textSecondary]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    const d = createTheme("dark");
    for (const bg of [d.bgMainWindow, d.bgSurfaceFlat, d.bgSurfaceMuted, d.bgAppShell]) expect(contrast(d.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("has three radii and the 32/300 greeting step", () => {
    expect([RADIUS.control, RADIUS.row, RADIUS.card]).toEqual([8, 12, 16]);
    expect(TYPE.greeting).toMatchObject({ size: 32, weight: 300 });
  });

  it("greets with the first name and falls back without one", () => {
    expect(greetingFor("Max Miller")).toBe("Hi Max");
    expect(greetingFor("  ")).toBe("Hallo");
    expect(greetingFor(null)).toBe("Hallo");
    expect(initialOf("max")).toBe("M");
    expect(initialOf(undefined)).toBe("?");
  });
});
