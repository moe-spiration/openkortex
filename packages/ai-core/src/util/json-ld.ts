import { ph } from "../i18n";
import { decodeEntities, stripTags } from "./markup";

// schema.org JSON-LD helpers shared by the recipe and movie adapters.

export type JsonLd = Record<string, unknown>;

export const isObj = (v: unknown): v is JsonLd =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const hasType = (node: JsonLd, type: string): boolean => {
  const t = node["@type"];
  return t === type || (Array.isArray(t) && t.includes(type));
};

/** All parsed `application/ld+json` blocks of a page (broken blocks are skipped). */
export function parseJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const blocks = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of blocks) {
    const raw = (m[1] ?? "").replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim();
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* not JSON */
    }
  }
  return out;
}

/** Breadth-first walk over JSON-LD nodes (arrays, @graph, mainEntity). */
function* walkJsonLd(blocks: readonly unknown[]): Generator<JsonLd> {
  const queue: unknown[] = [...blocks];
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) queue.push(...node);
    else if (isObj(node)) {
      yield node;
      if (node["@graph"]) queue.push(node["@graph"]);
      if (node.mainEntity) queue.push(node.mainEntity);
    }
  }
}

/**
 * Replaces `{ "@id": … }` references (chefkoch puts image and author into @graph) with the node of
 * that id, one level deep. Unknown references stay as they are.
 */
function withRefs(node: JsonLd, blocks: readonly unknown[]): JsonLd {
  const byId = new Map<string, JsonLd>();
  for (const n of walkJsonLd(blocks))
    if (typeof n["@id"] === "string" && Object.keys(n).length > 1) byId.set(n["@id"], n);
  const resolve = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(resolve);
    if (isObj(v) && typeof v["@id"] === "string" && Object.keys(v).length === 1)
      return byId.get(v["@id"]) ?? v;
    return v;
  };
  const out: JsonLd = {};
  for (const [k, v] of Object.entries(node)) out[k] = resolve(v);
  return out;
}

/** First schema.org node of one of `types` in all JSON-LD blocks, with @id references resolved. */
export function findJsonLdNode(html: string, types: readonly string[]): JsonLd | undefined {
  const blocks = parseJsonLdBlocks(html);
  for (const node of walkJsonLd(blocks))
    if (types.some((t) => hasType(node, t))) return withRefs(node, blocks);
  return undefined;
}

/** Plain text of a JSON-LD value (string, number or `{ name | text | @value }`). */
export const ldText = (v: unknown): string | undefined => {
  if (typeof v === "string") return decodeEntities(stripTags(v)).trim() || undefined;
  if (typeof v === "number") return String(v);
  if (isObj(v)) return ldText(v.name ?? v.text ?? v["@value"]);
  return undefined;
};

export const ldTextList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v])
    .map(ldText)
    .filter((s): s is string => !!s);

const isHttp = (v: string) => /^https?:\/\//i.test(v);

/** URL of a JSON-LD image (string, list or ImageObject with url/contentUrl). */
export const ldImageUrl = (v: unknown): string | undefined => {
  if (typeof v === "string") return isHttp(v) ? v : undefined;
  if (Array.isArray(v)) return ldImageUrl(v[0]);
  if (isObj(v)) return ldImageUrl(v.url ?? v.contentUrl);
  return undefined;
};

/** ISO 8601 duration (PT1H30M, P0DT0H45M) to minutes. */
export function isoDurationToMinutes(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return undefined;
  const minutes =
    Number(m[1] ?? 0) * 1440 +
    Number(m[2] ?? 0) * 60 +
    Number(m[3] ?? 0) +
    Math.round(Number(m[4] ?? 0) / 60);
  return minutes > 0 ? minutes : undefined;
}

/** 45 → "45 Min.", 100 → "1 Std. 40 Min.", 120 → "2 Std." (English: "45 min", "1 h 40 min", "2 h"). */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const [hours, mins] = [ph("hoursAbbr"), ph("minutesAbbr")];
  if (h === 0) return `${m} ${mins}`;
  return m === 0 ? `${h} ${hours}` : `${h} ${hours} ${m} ${mins}`;
}
