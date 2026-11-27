import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Entry } from "../src/data/mock";
import { inMix, lensFilters, lensOf, mixesOf, weekOf } from "../src/lib/library";
import { contrast, oklchToHex } from "../src/theme/color";
import { createTheme, RUHE, RUHE_HUE } from "../src/theme/tokens";

const BASE: Entry = { id: "0", kind: "note", type: "Note", when: "", img: { uri: "x" }, title: "T", tag: "", tldr: "", points: [], day: 0, who: [], opened: 0, time: "", ts: 0, whenShort: "" };
const ENTRIES = [BASE];

/* Ruhe look on Android (2026-11-26): flat tokens behind the look switch, lenses, Smart Mixes and the week band. */

describe("Ruhe tokens", () => {
  it("is the default look, vivid stays selectable", () => {
    expect(createTheme("dark", "indigo")).toEqual(createTheme("dark", "indigo", "ruhe"));
    expect(createTheme("dark").look).toBe("ruhe");
    expect(createTheme("dark", "indigo", "vivid").look).toBe("vivid");
  });

  it("is flat: no specular top light or inset in any edge", () => {
    for (const name of ["dark", "light"] as const) {
      const th = createTheme(name, "indigo", "ruhe");
      expect(th.look).toBe("ruhe");
      for (const edge of [th.edgeSurface, th.edgeRaised, th.edgeInset, th.edgeFloat, th.shadowFloating]) expect(edge).not.toMatch(/inset/);
    }
  });

  it("keeps readable text on the canvas and a luminance ladder", () => {
    const dark = createTheme("dark", "indigo", "ruhe");
    expect(contrast(dark.t1, dark.lum1)).toBeGreaterThan(12);
    expect(contrast(dark.t3, dark.lum1)).toBeGreaterThan(4.5);
    const light = createTheme("light", "indigo", "ruhe");
    expect(contrast(light.t1, light.lum1)).toBeGreaterThan(12);
    expect(contrast(light.t3, light.lum1)).toBeGreaterThan(4.5);
    expect(dark.lum0 < dark.lum1 && dark.lum1 < dark.lum2 && dark.lum2 < dark.lum3).toBe(true);
  });

  it("keeps the user's accent", () => {
    expect(createTheme("dark", "#10B981", "ruhe").accent).toBe("#10B981");
  });
});

describe("Ruhe Bibliothek", () => {
  it("maps lenses onto scope and chip and back", () => {
    for (const l of ["types", "objects", "vault"] as const) {
      const f = lensFilters(l);
      expect(lensOf(f.scope, f.chip)).toBe(l);
    }
    expect(lensOf("favorites", "meeting")).toBe("types");
  });

  it("builds mixes from shared hashtags, biggest first", () => {
    const mk = (id: string, tag: string): Entry => ({ ...ENTRIES[0]!, id, tag });
    const mixes = mixesOf([mk("1", "#fitness/running"), mk("2", "#fitness/running"), mk("3", "#solo"), mk("4", "#ai"), mk("5", "#ai"), mk("6", "#ai")]);
    expect(mixes.map((m) => [m.label, m.count])).toEqual([
      ["ai", 3],
      ["running", 2],
    ]);
    expect(inMix(mk("7", "#fitness/running"), "#fitness")).toBe(true);
    expect(inMix(mk("8", "#fitnessx"), "#fitness")).toBe(false);
  });

  it("lays out the week Monday first with today marked", () => {
    const thu = new Date(2026, 10, 26);
    const week = weekOf([{ ...ENTRIES[0]!, day: 0, tag: "#ai" }, { ...ENTRIES[0]!, day: 3, tag: "#x" }], thu);
    expect(week.map((d) => d.date)).toEqual([23, 24, 25, 26, 27, 28, 29]);
    expect(week[3]!.today).toBe(true);
    expect(week[3]!.dots).toEqual(["#ai"]);
    expect(week[0]!.dots).toEqual(["#x"]);
    expect(week[4]!.ago).toBe(-1);
  });
});

describe("Ruhe parity with packages/ui/src/styles/ruhe.css", () => {
  const css = readFileSync(resolve(process.cwd(), "../../packages/ui/src/styles/ruhe.css"), "utf8");
  const dark = css.slice(css.indexOf("Tokens: dark"), css.indexOf("Tokens: light"));
  const light = css.slice(css.indexOf("Tokens: light"));
  const lch = (block: string, name: string) => {
    // Chroma is either a number or calc(<n> * var(--ruhe-c, 1)) (runtime contrast slider, default 1).
    const m = block.match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) (?:calc\\(([\\d.]+) \\* var\\(--ruhe-c, 1\\)\\)|([\\d.]+)) var\\(--ruhe-h\\)`));
    return m ? oklchToHex([Number(m[1]), Number(m[2] ?? m[3]), RUHE_HUE]) : null;
  };
  it("uses the web's ladder and text steps", () => {
    for (const [name, block] of [["dark", dark], ["light", light]] as const) {
      const r = RUHE[name];
      for (const [css, key] of [["lum-0", "lum0"], ["lum-1", "lum1"], ["lum-2", "lum2"], ["lum-3", "lum3"], ["lum-4", "lum4"], ["t1", "t1"], ["t2", "t2"], ["t3", "t3"], ["t4", "t4"]] as const) {
        const want = lch(block, css);
        expect(want).not.toBeNull();
        expect([name, key, r[key]]).toEqual([name, key, want]);
      }
    }
  });
});
