/* Colour maths for the theme: CSS `color-mix(in srgb, ...)` has no React Native equivalent, so mixes are computed here. */

export type RGBA = [number, number, number, number];

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

/** Parses #RGB, #RRGGBB, rgb() and rgba(). */
export function parseColor(input: string): RGBA {
  const s = input.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (!m) throw new Error(`Unsupported colour: ${input}`);
  const p = m[1]!.split(",").map((x) => parseFloat(x));
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
}

export function toCss([r, g, b, a]: RGBA): string {
  const rr = Math.round(r);
  const gg = Math.round(g);
  const bb = Math.round(b);
  if (a >= 1) return "#" + [rr, gg, bb].map((x) => clamp(x).toString(16).padStart(2, "0")).join("").toUpperCase();
  return `rgba(${rr}, ${gg}, ${bb}, ${Math.round(a * 1000) / 1000})`;
}

/** The colour at the given opacity (`color-mix(in srgb, c p%, transparent)`). */
export function alpha(color: string, a: number): string {
  const [r, g, b, ca] = parseColor(color);
  return toCss([r, g, b, ca * a]);
}

/** `color-mix(in srgb, a pct%, b)` for opaque colours. */
export function mix(a: string, pct: number, b: string): string {
  const x = parseColor(a);
  const y = parseColor(b);
  const t = pct / 100;
  return toCss([x[0] * t + y[0] * (1 - t), x[1] * t + y[1] * (1 - t), x[2] * t + y[2] * (1 - t), 1]);
}

/** Relative luminance (WCAG). */
function luminance([r, g, b]: RGBA): number {
  const v = [r, g, b].map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}

/** WCAG contrast ratio of two opaque colours (1 … 21). */
export function contrast(a: string, b: string): number {
  const x = luminance(parseColor(a));
  const y = luminance(parseColor(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Darkens until white text reaches 4.6:1 (prototype `accentPair`, used for custom accent colours). */
export function solidFor(hex: string): string {
  let c = parseColor(hex);
  for (let k = 0; k < 20 && 1.05 / (luminance(c) + 0.05) < 4.6; k++) c = [c[0] * 0.9, c[1] * 0.9, c[2] * 0.9, 1];
  return toCss(c);
}

/* ---------- OKLCH (Tactile Craft v2): the web derives the accent layer with `color-mix(in oklch, ...)` ---------- */

type Lch = [number, number, number];

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const fromLinear = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/** sRGB (0..255) → OKLCH [L 0..1, C, H degrees]. */
export function rgbToOklch([r, g, b]: RGBA): Lch {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? NaN : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

/** OKLCH → linear sRGB (may be out of gamut). */
function oklchToLinear([L, C, H]: Lch): [number, number, number] {
  const h = Number.isNaN(H) ? 0 : (H * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB hex; out-of-gamut colours lose chroma until they fit (CSS Color 4 gamut mapping, simplified). */
export function oklchToHex([L, C, H]: Lch): string {
  const fits = (c: number) => oklchToLinear([L, c, H]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let c = C;
  if (!fits(c)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const [r, g, b] = oklchToLinear([L, c, H]).map((v) => fromLinear(Math.min(1, Math.max(0, v))));
  return toCss([r!, g!, b!, 1]);
}

/**
 * `color-mix(in oklch, a pct%, b)` for opaque colours. Like CSS, an achromatic side (white, black, grey) has no hue
 * and takes the hue of the other side, so mixing with white or black keeps the accent's hue.
 */
export function mixOklch(a: string, pct: number, b: string): string {
  const x = rgbToOklch(parseColor(a));
  const y = rgbToOklch(parseColor(b));
  const t = pct / 100;
  const hx = Number.isNaN(x[2]) ? y[2] : x[2];
  const hy = Number.isNaN(y[2]) ? x[2] : y[2];
  let h = NaN;
  if (!Number.isNaN(hx) && !Number.isNaN(hy)) {
    let d = hy - hx;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    h = (hx + d * (1 - t) + 360) % 360;
  }
  return oklchToHex([x[0] * t + y[0] * (1 - t), x[1] * t + y[1] * (1 - t), h]);
}

/**
 * [fill, text] of the accent layer (web/desktop: @kortex/ui/accent accentFill, same rule; pinned by
 * test/token-parity.test.ts): fill = color-mix(in oklch, accent 90%, black); white text if it reaches 4.5:1 on the
 * fill, else the dark ink #111114 if it does, else the fill gets darker in OKLab lightness until white reaches 4.5:1.
 */
export function accentFillFor(hex: string): [string, string] {
  const DARK = "#111114";
  const base = rgbToOklch(parseColor(/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#6366F1"));
  const at = (L: number) => {
    const [r, g, b] = oklchToLinear([L, base[1] * 0.9, base[2]]).map((v) => fromLinear(Math.min(1, Math.max(0, v))));
    return toCss([r!, g!, b!, 1]);
  };
  let L = base[0] * 0.9;
  let fill = at(L);
  if (contrast("#FFFFFF", fill) >= 4.5) return [fill, "#FFFFFF"];
  if (contrast(DARK, fill) >= 4.5) return [fill, DARK];
  for (let k = 0; k < 120 && contrast("#FFFFFF", fill) < 4.5; k++) {
    L -= 0.005;
    fill = at(L);
  }
  return [fill, "#FFFFFF"];
}

/** Text colour on the accent fill (`--on-accent`, WCAG AA against the actual fill). */
export function onAccentFor(hex: string): string {
  return accentFillFor(hex)[1];
}
