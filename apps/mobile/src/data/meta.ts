/** Metadata object of a row (anything else counts as empty). */
export const metaOf = (m: unknown): Record<string, unknown> => (m && typeof m === "object" && !Array.isArray(m) ? { ...(m as Record<string, unknown>) } : {});

/** Shallow merge for the Eigenschaften panel: a `null` value removes the key. */
export function mergeMeta(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out = metaOf(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** One property as text: lists joined, numbers plain, objects as `key: value` pairs. */
export function metaValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x ? ((x as { title?: string; url?: string }).title ?? (x as { url?: string }).url ?? "") : String(x))).filter(Boolean).join(", ");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  return String(v);
}

/** Link behind a typed field, if it has one (IMDb id, URLs). */
export function metaLink(key: string, v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  if (key === "imdb_id" && /^tt\d+$/.test(v.trim())) return `https://www.imdb.com/title/${v.trim()}/`;
  if (/^https?:\/\//.test(v.trim())) return v.trim();
  return null;
}
