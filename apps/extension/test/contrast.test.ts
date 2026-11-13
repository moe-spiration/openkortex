import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// V2-11I / board 11: text in the extension must keep >= 4.5:1 (icons/graphics >= 3:1) in both
// themes. The values come straight from the shared tokens, so a token change that breaks the
// extension fails here instead of in somebody's browser.
//
// Tactile Craft v2: tokens.css now names its colours through each other (--text-muted: var(--t3),
// --accent-fill: color-mix(in oklch, var(--accent) 90%, black), ...). The resolver below follows
// var() chains (with fallbacks) and evaluates color-mix in srgb and oklch, so the test checks the
// colours the browser actually paints.

const TOKENS = readFileSync(resolve(process.cwd(), "../../packages/ui/src/styles/tokens.css"), "utf8");
const ACCENT_TS = readFileSync(resolve(process.cwd(), "../../apps/web/src/lib/shell/accent.ts"), "utf8");

/** Variables declared in blocks whose selector list contains `selector`, later blocks winning. */
function themeVars(selector: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of TOKENS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
    if (!sel.split(",").some((s) => s.trim() === selector)) continue;
    for (const v of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]!] = v[2]!.trim();
  }
  return vars;
}

// Cascade per theme: `:root` (dark default + derivations), then `[data-theme]` (derivations for every theme),
// then the theme's own block.
const ROOT = themeVars(":root");
const ANY = themeVars("[data-theme]");
const THEMES = {
  dark: { ...ROOT, ...ANY, ...themeVars('[data-theme="dark"]') },
  light: { ...ROOT, ...ANY, ...themeVars('[data-theme="light"]') },
};

type RGB = [number, number, number];

const toLin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
function toOklch([r, g, b]: RGB): [number, number, number] {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  return [L, C, C < 1e-4 ? NaN : (Math.atan2(B, A) * 180) / Math.PI];
}
function fromOklch([L, C, H]: [number, number, number]): RGB {
  const h = Number.isNaN(H) ? 0 : (H * Math.PI) / 180;
  const [A, B] = [C * Math.cos(h), C * Math.sin(h)];
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => Math.round(fromLin(Math.min(1, Math.max(0, v))))) as RGB;
}

/** Resolves a token value to an opaque colour (`vars` = the theme's variables, `accent` = --kx-accent). */
function color(value: string, vars: Record<string, string>, accent: string | null, depth = 0): RGB {
  if (depth > 20) throw new Error(`var() cycle at ${value}`);
  const v = value.trim();
  const named: Record<string, RGB> = { white: [255, 255, 255], black: [0, 0, 0] };
  if (named[v]) return named[v];
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const ref = /^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (ref) {
    if (ref[1] === "--kx-accent" && accent) return color(accent, vars, accent, depth + 1);
    if (ref[1] === "--kx-on-accent" && accent) return color(onAccent(accent), vars, accent, depth + 1);
    const next = vars[ref[1]!] ?? ref[2];
    if (!next) throw new Error(`unresolved ${ref[1]}`);
    return color(next, vars, accent, depth + 1);
  }
  const mixed = /^color-mix\(in (srgb|oklch),\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(v);
  if (mixed) {
    const [, space, a, pct, b] = mixed;
    const t = Number(pct) / 100;
    const ca = color(a!, vars, accent, depth + 1);
    const cb = color(b!, vars, accent, depth + 1);
    if (space === "srgb") return ca.map((c, i) => Math.round(c * t + cb[i]! * (1 - t))) as RGB;
    const [x, y] = [toOklch(ca), toOklch(cb)];
    const hx = Number.isNaN(x[2]) ? y[2] : x[2];
    const hy = Number.isNaN(y[2]) ? x[2] : y[2];
    return fromOklch([x[0] * t + y[0] * (1 - t), x[1] * t + y[1] * (1 - t), hx * t + hy * (1 - t)]);
  }
  throw new Error(`not an opaque colour: ${value}`);
}

const lum = ([r, g, b]: RGB) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** Same rule as onAccentColor() in apps/web/src/lib/shell/accent.ts (threshold 0.42). */
const onAccent = (hex: string) => (lum(color(hex, {}, null)) > 0.42 ? "#111114" : "#FFFFFF");
/** `color-mix(in srgb, a p%, b)` */
const mix = (a: RGB, p: number, b: RGB): RGB => a.map((c, i) => Math.round(c * p + b[i]! * (1 - p))) as RGB;

/** Surfaces text sits on in the extension: popup (lum-1), fields, chips, hover rows, the options page frame. */
const SURFACES = ["--lum-0", "--lum-1", "--lum-2", "--lum-3", "--bg-hover"] as const;

describe.each(["dark", "light"] as const)("%s theme contrast", (theme) => {
  const t = THEMES[theme];
  const get = (name: string, accent: string | null = null) => {
    if (!t[name]) throw new Error(`${theme}: ${name} missing in tokens.css`);
    return color(t[name]!, t, accent);
  };

  it("keeps the Tactile Craft light text 3 at #66666E", () => {
    if (theme === "light") expect(t["--t3"]).toBe("#66666E");
    expect(t["--text-muted"]).toBe("var(--t3)");
  });

  it.each(["--text-primary", "--text-secondary", "--text-muted"])("%s is readable (4.5:1) on every surface", (text) => {
    for (const bg of SURFACES) {
      const r = ratio(get(text), get(bg));
      expect(r, `${text} on ${bg}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("error text and the primary button label (default accent) are readable", () => {
    for (const bg of SURFACES) {
      expect(ratio(get("--status-urgent-text"), get(bg)), `urgent text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    const r = ratio(get("--on-accent-ai"), get("--accent-ai-solid"));
    expect(r, `on-accent on accent-fill: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });

  it("every accent swatch of the web keeps its label visible on the accent fill (3:1, graphics/large text)", () => {
    const swatches = [...ACCENT_TS.matchAll(/hex:\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]!);
    expect(swatches.length).toBeGreaterThanOrEqual(8);
    for (const hex of new Set(swatches)) {
      const r = ratio(get("--on-accent", hex), get("--accent-fill", hex));
      expect(r, `${hex}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("status icons (the only colour in the status chip and the toast) keep 3:1", () => {
    // mirrors `.kx-statechip--*` / `.kx-toast--*` in ext.css: 60 % status colour, 40 % text colour
    for (const status of ["--status-synced", "--status-processing", "--status-urgent"]) {
      const icon = mix(get(status), 0.6, get("--text-primary"));
      for (const bg of ["--lum-1", "--lum-2", "--lum-3"]) {
        const r = ratio(icon, get(bg));
        expect(r, `${status} icon on ${bg}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
