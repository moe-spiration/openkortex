/*
 * OKLCH <-> sRGB hex for the Ruhe theme settings (Akzent as a hue slider). The accent stays a hex in the shell prefs
 * (synced to user_settings, read by mobile and the clipper); the slider writes oklch(L C h) as hex and reads the hue
 * of the stored hex back. Formulas: Björn Ottosson, "A perceptual color space for image processing" (OKLab).
 */

/** Lightness and chroma of the Ruhe accent (mockup dark accent oklch(0.63 0.155 h)). */
export const RUHE_ACCENT_L = 0.63;
export const RUHE_ACCENT_C = 0.155;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: [number, number, number]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** oklch(L C h) as "#RRGGBB"; chroma is reduced until the colour fits into sRGB (keeps the hue). */
export function oklchToHex(L: number, C: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  let c = C;
  let rgb = oklabToLinearRgb(L, c * Math.cos(rad), c * Math.sin(rad));
  for (let i = 0; i < 40 && !inGamut(rgb); i++) {
    c *= 0.95;
    rgb = oklabToLinearRgb(L, c * Math.cos(rad), c * Math.sin(rad));
  }
  return (
    "#" +
    rgb
      .map((v) => Math.round(clamp01(toGamma(clamp01(v))) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/** OKLCH hue (0-359) of a "#RRGGBB" colour, or null for an invalid value or a grey. */
export function hexHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  if (Math.hypot(a, bb) < 0.01) return null;
  return Math.round(((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360) % 360;
}
