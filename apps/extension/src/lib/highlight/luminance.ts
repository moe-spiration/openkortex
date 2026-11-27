// The selection bar on other pages follows the page, not the Kortex theme: it reads the background behind the
// selection (first opaque background up the tree), falls back to <body>/<html>, then to prefers-color-scheme.

/** Parses `rgb(…)` / `rgba(…)` / `color(srgb …)` as computed by the browser; null when it is not sRGB. */
export function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value.trim());
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i.exec(value.trim());
  if (srgb) return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
  return null;
}

/** WCAG relative luminance of an sRGB colour (0 black … 1 white). */
export function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** True when the page behind `from` is dark. */
export function pageIsDark(from?: Element | null, win: Window = window): boolean {
  const doc = win.document;
  const chain: Element[] = [];
  for (let el: Element | null = from ?? null; el; el = el.parentElement) chain.push(el);
  if (doc.body) chain.push(doc.body);
  chain.push(doc.documentElement);
  for (const el of chain) {
    const c = parseCssColor(win.getComputedStyle(el).backgroundColor);
    if (c && c.a > 0.5) return relativeLuminance(c) < 0.25;
  }
  // No background anywhere: the canvas is white, unless the page opts into a dark colour scheme.
  try {
    const scheme = win.getComputedStyle(doc.documentElement).colorScheme ?? "";
    return /dark/.test(scheme) && (!/light/.test(scheme) || win.matchMedia("(prefers-color-scheme: dark)").matches);
  } catch {
    return false;
  }
}
