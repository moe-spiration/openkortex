/*
 * Accent maths shared by web and desktop (Tactile Craft v2). Pure TypeScript, no DOM, no imports.
 *
 * One user accent (--kx-accent) drives every accent colour in CSS (packages/ui/src/styles/tokens.css). Filled
 * controls (send orb, primary buttons, active chips) sit on --accent-fill with --on-accent as text. Both are
 * computed HERE and written as --kx-accent-fill / --kx-on-accent, so the text reaches WCAG AA (4.5:1) for every
 * swatch and every free colour, in dark and light (the fill is the same in both themes):
 *   1. fill = color-mix(in oklch, accent 90%, black)   (the token formula, kept as the CSS fallback)
 *   2. white text if it reaches 4.5:1 on that fill, else the dark ink #111114 if it does (light accents keep
 *      their colour: green, orange, teal, amber), else the fill is darkened in OKLab lightness until white
 *      reaches 4.5:1 (only mid-tones where neither text colour fits).
 *
 * accentPair and accentFill are SELF-CONTAINED (no references outside their bodies): the web inlines them into
 * its pre-paint script with Function.prototype.toString. Mobile keeps a React Native copy
 * (apps/mobile/src/theme/color.ts), pinned to this module by apps/mobile/test/token-parity.test.ts.
 */

/** Dark text on light accent fills. */
export const ON_ACCENT_DARK = "#111114";
/** Light text on dark accent fills. */
export const ON_ACCENT_LIGHT = "#FFFFFF";

/**
 * [accent, solid] for a preset id or a custom #rrggbb. `solid` is the legacy darker shade (white text about
 * 4.6:1); new code uses accentFill. Self-contained (inlined into the web pre-paint script).
 */
export function accentPair(a: string | null | undefined): [string, string] {
  const presets: Record<string, [string, string]> = {
    indigo: ["#6366F1", "#4F46E5"],
    teal: ["#14B8A6", "#0F766E"],
    violet: ["#8B5CF6", "#6D28D9"],
    blue: ["#3B82F6", "#1D4ED8"],
    rose: ["#F43F5E", "#BE123C"],
    amber: ["#F59E0B", "#B45309"],
  };
  const pre = a ? presets[a] : undefined;
  if (pre) return pre;
  const hex = /^#[0-9a-f]{6}$/i.test(a || "") ? (a as string) : "#6366F1";
  const rgb = [1, 3, 5].map((i) => parseInt(hex.substring(i, i + 2), 16));
  const lum = (c: number[]) => {
    const v = c.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  };
  let c = rgb.slice();
  let k = 0;
  while (1.05 / (lum(c) + 0.05) < 4.6 && k < 20) {
    c = c.map((x) => Math.round(x * 0.9));
    k++;
  }
  return [hex, "#" + c.map((x) => ("0" + x.toString(16)).slice(-2)).join("")];
}

/**
 * [fill, onAccent] for a raw accent #rrggbb (see the header for the rule). An invalid value gives the default
 * indigo's pair. Self-contained (inlined into the web pre-paint script).
 */
export function accentFill(hex: string): [string, string] {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#6366F1";
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const rgb = [1, 3, 5].map((i) => lin(parseInt(h.substring(i, i + 2), 16)));
  const r = rgb[0]!;
  const g = rgb[1]!;
  const b = rgb[2]!;
  // sRGB → OKLab
  const l1 = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m1 = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s1 = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L0 = 0.2104542553 * l1 + 0.793617785 * m1 - 0.0040720468 * s1;
  const A0 = 1.9779984951 * l1 - 2.428592205 * m1 + 0.4505937099 * s1;
  const B0 = 0.0259040371 * l1 + 0.7827717662 * m1 - 0.808675766 * s1;
  // color-mix(in oklch, accent 90%, black): black has no hue, so lightness and chroma scale by 0.9, hue stays.
  const A = A0 * 0.9;
  const B = B0 * 0.9;
  const toHex = (L: number) => {
    const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
    const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
    const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
    const out = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => {
      const c = Math.min(1, Math.max(0, v));
      const e = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(e * 255);
    });
    return "#" + out.map((x) => ("0" + x.toString(16)).slice(-2)).join("").toUpperCase();
  };
  const lum = (x: string) => {
    const v = [1, 3, 5].map((i) => lin(parseInt(x.substring(i, i + 2), 16)));
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  };
  const DARK = "#111114";
  const onWhite = (x: string) => 1.05 / (lum(x) + 0.05);
  const onDark = (x: string) => (lum(x) + 0.05) / (lum(DARK) + 0.05);
  let L = L0 * 0.9;
  let fill = toHex(L);
  if (onWhite(fill) >= 4.5) return [fill, "#FFFFFF"];
  if (onDark(fill) >= 4.5) return [fill, DARK];
  for (let k = 0; k < 120 && onWhite(fill) < 4.5; k++) {
    L -= 0.005;
    fill = toHex(L);
  }
  return [fill, "#FFFFFF"];
}

/** Text colour on the accent fill of a raw accent (`--on-accent`). */
export function onAccentColor(hex: string): string {
  return accentFill(hex)[1];
}

/** WCAG relative luminance of #rrggbb. */
export function relativeLuminance(hex: string): number {
  const v = [1, 3, 5].map((i) => {
    const s = parseInt(hex.substring(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}

/** WCAG contrast ratio of two opaque #rrggbb colours (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
