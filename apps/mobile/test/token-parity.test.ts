import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { accentFill, contrastRatio } from "@kortex/ui/accent";
import { ACCENTS, TACTILE, accentLayer } from "../src/theme/tokens";

/*
 * Tactile Craft v2 platform parity (package F). One source of values, five consumers:
 *   design/reference/ds/kortex/tokens.json (version 2)  ← the contract for desktop, clipper and mobile
 *   packages/ui/src/styles/tokens.css                   ← web (and, via @kortex/ui/styles, desktop + clipper)
 *   apps/extension/src/styles/ext.css                   ← must import the shared tokens, not redefine them
 *   apps/desktop/src/*.css                              ← same
 *   apps/mobile/src/theme/tokens.ts                     ← React Native copy of the values
 * Accent presets: apps/web/src/lib/shell/accent.ts (ACCENTS, ACCENT_SWATCHES) ↔ mobile ACCENTS.
 * Only reads files, so it does not depend on later changes of the other packages beyond these names.
 */

// vitest runs in apps/mobile (like the clipper's contrast test).
const ROOT = resolve(process.cwd(), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

type Rgba = [number, number, number, number];

/** #RGB, #RRGGBB, rgb(r g b / a), rgba(r, g, b, a) → [r, g, b, a] (a rounded to 3 places). */
function rgba(input: string): Rgba {
  const s = input.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (!m) throw new Error(`not a plain colour: ${input}`);
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  return [parts[0]!, parts[1]!, parts[2]!, Math.round((parts[3] ?? 1) * 1000) / 1000];
}

/** Custom properties of the first CSS block whose selector list starts with `selector`. */
function cssBlock(css: string, selector: string): Record<string, string> {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!sel.startsWith(selector)) continue;
    const vars: Record<string, string> = {};
    for (const v of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]!] = v[2]!.trim();
    return vars;
  }
  throw new Error(`no block ${selector}`);
}

const JSON_TOKENS = JSON.parse(read("design/reference/ds/kortex/tokens.json")) as {
  version: number;
  color: { tokens: { name: string; value: { dark: string; light: string } }[] };
};
const jsonColor = (name: string, theme: "dark" | "light"): string => {
  const t = JSON_TOKENS.color.tokens.find((x) => x.name === name);
  if (!t) throw new Error(`tokens.json has no ${name}`);
  return t.value[theme];
};

const CSS = read("packages/ui/src/styles/tokens.css");
const CSS_THEME = {
  dark: cssBlock(CSS, ':root, [data-theme="dark"]'),
  light: cssBlock(CSS, '[data-theme="light"]'),
};

/** Core colours: json name → mobile key (TACTILE). */
const CORE = {
  "lum-0": "lum0",
  "lum-1": "lum1",
  "lum-2": "lum2",
  "lum-3": "lum3",
  "lum-4": "lum4",
  glass: "glass",
  "glass-strong": "glassStrong",
  t1: "t1",
  t2: "t2",
  t3: "t3",
  t4: "t4",
  hair: "hair",
  "hair-strong": "hairStrong",
  "spec-top": "specTop",
  "spec-bottom": "specBottom",
  "inset-top": "insetTop",
  ok: "ok",
  warn: "warn",
  crit: "crit",
  info: "info",
} as const;

describe("Tactile Craft v2 token parity", () => {
  it("tokens.json is version 2", () => {
    expect(JSON_TOKENS.version).toBe(2);
  });

  describe.each(["dark", "light"] as const)("%s", (theme) => {
    it.each(Object.entries(CORE))("--%s: tokens.json = web tokens.css = mobile", (name, key) => {
      const json = rgba(jsonColor(name, theme));
      expect(rgba(CSS_THEME[theme][`--${name}`] ?? "missing"), `tokens.css --${name}`).toEqual(json);
      expect(rgba(TACTILE[theme][key]), `mobile ${key}`).toEqual(json);
    });

    it("light text 3 is #66666E (AA on --lum-0)", () => {
      if (theme === "light") expect(jsonColor("t3", "light")).toBe("#66666E");
    });
  });

  it("mobile drop shadow matches --drop in tokens.css", () => {
    // Colours compared as numbers; RN needs the explicit spread radius (`0 1px 2px 0 c`), CSS leaves it out.
    const norm = (v: string) =>
      v
        .replace(/rgba?\([^)]+\)/g, (c) => `[${rgba(c).join(",")}]`)
        .replace(/(\dpx) 0 \[/g, "$1 [")
        .replace(/\s+/g, " ")
        .trim();
    for (const theme of ["dark", "light"] as const) {
      expect(norm(TACTILE[theme].drop)).toBe(norm(CSS_THEME[theme]["--drop"]!));
    }
  });

  it.each([
    ["clipper", "apps/extension/src/styles/ext.css"],
    ["desktop", "apps/desktop/src/styles.css"],
    ["desktop windows", "apps/desktop/src/tactile.css"],
  ])("%s takes the tokens from @kortex/ui and does not redefine them", (_name, file) => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    if (file.endsWith("styles.css") || file.endsWith("ext.css")) expect(css).toMatch(/@import\s+"@kortex\/ui\/styles";/);
    const redefined = [...css.matchAll(/(--(?:lum-\d|glass(?:-strong)?|t[1-4]|hair(?:-strong)?|spec-(?:top|bottom)|inset-top|accent(?:-ink|-soft|-line|-fill)?|on-accent|ok|warn|crit|info|drop))\s*:/g)].map(
      (m) => m[1],
    );
    expect(redefined).toEqual([]);
  });

  it("accent presets: web swatches = mobile swatches (order, label, colour)", () => {
    const src = read("apps/web/src/lib/shell/accent.ts");
    const block = /ACCENT_SWATCHES[^=]*=\s*\[([\s\S]*?)\];/.exec(src)![1]!;
    const web = [...block.matchAll(/value:\s*"([^"]+)",\s*(?:label:\s*|get label\(\)\s*\{\s*return t\()"([^"]+)"[^,]*,\s*hex:\s*"([^"]+)"/g)].map((m) => [m[1], m[2], m[3]]);
    expect(web.length).toBeGreaterThanOrEqual(3);
    expect(ACCENTS.map((a) => [a.key, a.label, a.accent])).toEqual(web);
  });

  it("accent presets: the preset ids keep their colour on web and mobile", () => {
    const src = read("apps/web/src/lib/shell/accent.ts");
    const block = /export const ACCENTS[^=]*=\s*\[([\s\S]*?)\];/.exec(src)![1]!;
    for (const m of block.matchAll(/id:\s*"([^"]+)",[^}]*hex:\s*"([^"]+)"/g)) {
      expect(ACCENTS.find((a) => a.key === m[1])?.accent, m[1]).toBe(m[2]);
    }
  });

  it("the accent derivations of tokens.json are the ones tokens.css uses", () => {
    expect(jsonColor("accent-ink", "dark")).toBe("color-mix(in oklch, accent 66%, white)");
    expect(CSS_THEME.dark["--accent-ink"]).toBe("color-mix(in oklch, var(--accent) 66%, white)");
    expect(jsonColor("accent-ink", "light")).toBe("color-mix(in oklch, accent 76%, black)");
    expect(CSS_THEME.light["--accent-ink"]).toBe("color-mix(in oklch, var(--accent) 76%, black)");
    expect(jsonColor("accent-fill", "dark")).toContain("color-mix(in oklch, accent 90%, black)");
    expect(CSS).toContain("--accent-fill: var(--kx-accent-fill, color-mix(in oklch, var(--accent) 90%, black));");
  });

  it("accent fill and text on it: mobile copy = @kortex/ui/accent (web, desktop), 4.5:1 for every swatch", () => {
    const free = ["#FFFF00", "#00FFFF", "#808080", "#84CC16", "#EC4899", "#0EA5E9", "#777777"];
    for (const hex of [...ACCENTS.map((a) => a.accent), ...free]) {
      const [fill, on] = accentFill(hex);
      for (const theme of ["dark", "light"] as const) {
        const m = accentLayer(theme, hex);
        expect(m.onAccent, `${theme} ${hex}`).toBe(on);
        expect(rgba(m.accentFill).slice(0, 3).map((v, i) => Math.abs(v - rgba(fill)[i]!)).every((d) => d <= 1), `${theme} ${hex} ${m.accentFill} vs ${fill}`).toBe(true);
        expect(contrastRatio(fill, on)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
