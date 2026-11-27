import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrast, oklchToHex } from "../src/theme/color";
import { createTheme, RUHE_MOTION, RUHE_RADIUS, RUHE_SPACE, RUHE_TYPE } from "../src/theme/tokens";
import { LUCIDE } from "../src/ui/typeIcon";

/* Ruhe Android foundation (android-richtlinien.md, 2026-11-27): the numbers primitives read, the default accent, icons. */

describe("Ruhe foundation constants", () => {
  it("keeps the guideline's spacing, radii and type steps", () => {
    expect([RUHE_SPACE.page, RUHE_SPACE.surface, RUHE_SPACE.row, RUHE_SPACE.rowTall, RUHE_SPACE.barHeight, RUHE_SPACE.barBottom]).toEqual([20, 16, 52, 62, 58, 28]);
    expect(Object.values(RUHE_RADIUS)).toEqual([6, 8, 10, 12, 14, 16, 36]);
    expect(RUHE_TYPE.title).toEqual({ size: 30, lh: 36, weight: 700, ls: -0.03 });
    expect(RUHE_TYPE.tabLabel.size).toBe(10.5);
    // Only letter spacing on titles and the capture input.
    const spaced = Object.entries(RUHE_TYPE).filter(([, s]) => s.ls !== 0).map(([k]) => k);
    expect(spaced.sort()).toEqual(["input", "title", "titleCard", "titleDetail"]);
  });

  it("has the motion tokens of motion-demos.html", () => {
    expect([RUHE_MOTION.d1, RUHE_MOTION.d2, RUHE_MOTION.d3, RUHE_MOTION.d4]).toEqual([120, 180, 260, 420]);
    expect(RUHE_MOTION.eo).toEqual([0.16, 1, 0.3, 1]);
    expect(RUHE_MOTION.eio).toEqual([0.65, 0, 0.35, 1]);
    expect(RUHE_MOTION.spring).toEqual([0.34, 1.36, 0.64, 1]);
  });
});

describe("Ruhe-Indigo default accent (hue 276)", () => {
  it("shows the default key in the mockup's values per theme", () => {
    expect(createTheme("dark", "indigo", "ruhe").accent).toBe(oklchToHex([0.63, 0.155, 276]));
    expect(createTheme("light", "indigo", "ruhe").accent).toBe(oklchToHex([0.56, 0.165, 276]));
    expect(createTheme("dark", "indigo", "ruhe").accentInk).toBe(oklchToHex([0.79, 0.1, 276]));
  });

  it("leaves vivid and every other swatch alone", () => {
    expect(createTheme("dark", "indigo", "vivid").accent).toBe("#6366F1");
    expect(createTheme("dark", "violet", "ruhe").accent).toBe("#8B5CF6");
  });

  it("keeps white text on the accent fill readable", () => {
    for (const name of ["dark", "light"] as const) {
      const th = createTheme(name, "indigo", "ruhe");
      expect(contrast(th.onAccent, th.accentFill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("has a navigation text step", () => {
    expect(createTheme("dark").ts).not.toBe(createTheme("dark").t3);
    expect(createTheme("dark", "indigo", "vivid").ts).toBe(createTheme("dark", "indigo", "vivid").t3);
  });
});

describe("Ruhe type icons", () => {
  it("draws newspaper, chef hat, audio lines and globe instead of fallbacks", () => {
    expect([LUCIDE.newspaper, LUCIDE["chef-hat"], LUCIDE.podcast, LUCIDE.bookmark, LUCIDE["file-text"]]).toEqual(["newspaper", "chefHat", "audioLines", "globe", "fileText"]);
  });

  it("loads Geist 700 at runtime only (no config plugin, same native fingerprint)", () => {
    const layout = readFileSync(join(__dirname, "..", "app", "_layout.tsx"), "utf8");
    expect(layout).toMatch(/useFonts\(\{[^}]*Geist_700Bold/);
    const appJson = readFileSync(join(__dirname, "..", "app.json"), "utf8");
    expect(appJson).not.toMatch(/expo-font/);
  });
});
