// Small DOM readers shared by the extractors. Pure functions over a Document, so fixtures in jsdom
// exercise exactly what runs in the page.

export const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

export function meta(doc: Document, ...names: string[]): string | null {
  for (const n of names) {
    for (const el of doc.querySelectorAll<HTMLMetaElement>("meta[property], meta[name]")) {
      if ((el.getAttribute("property") === n || el.getAttribute("name") === n) && el.content?.trim()) return el.content.trim();
    }
  }
  return null;
}

/** Absolute http(s) URL or null. `data:`, `blob:`, `javascript:` and garbage never get through. */
export function absHttp(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim(), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** All JSON-LD nodes of the page, `@graph` and arrays flattened; unparsable blocks are skipped. */
export function jsonLd(doc: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === "object") {
      out.push(v as Record<string, unknown>);
      visit((v as Record<string, unknown>)["@graph"]);
    }
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.textContent ?? ""));
    } catch {
      /* broken JSON-LD is common */
    }
  }
  return out;
}

export const hasType = (node: Record<string, unknown>, ...types: string[]): boolean => {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === "string" && types.includes(x));
};

/** `image` / `thumbnailUrl` of a JSON-LD node: string, ImageObject, or an array of those. */
export function imagesOfNode(node: Record<string, unknown>, ...keys: string[]): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") visit((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl);
  };
  for (const k of keys) visit(node[k]);
  return out;
}

/** ISO 8601 duration (`PT1H12M30S`, `P0DT45M`) to seconds; null when it is not one. */
export function isoDurationSec(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!m || !value.trim().match(/\d/)) return null;
  const [, d, h, min, s] = m;
  return Math.round(Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0));
}

/** Date-like string to ISO (date only when no time is present); null when unparsable. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const dedupe = <T,>(list: readonly T[]): T[] => [...new Set(list)];
