import { acceptLanguage, ph, type ContentPhraseKey } from "../../i18n";
import { Readability } from "@mozilla/readability";
import type { parseHTML as ParseHTML } from "linkedom";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { ExtractionError } from "../../errors";
import { BROWSER_USER_AGENT, request, type FetchLike } from "../../http";
import { createSafeFetch } from "../../net/safe-fetch";
import { extractListingItems, isListing, listingMarkdown, type ListingDoc } from "./listing";

// Keyless fallback for web clips: fetch the page ourselves, keep OpenGraph metadata, extract the
// main content with Mozilla Readability (on linkedom, no browser DOM needed) and convert to Markdown.

export interface DirectReadOptions {
  timeoutMs?: number;
  /** Bytes of HTML read at most; the rest is cut off. Default 5 MB. */
  maxBytes?: number;
}

export interface DirectReadResult {
  title?: string;
  description?: string;
  markdown: string;
  canonicalUrl?: string;
  coverImageUrl?: string;
  publishedTime?: string;
  siteName?: string;
  language?: string;
  byline?: string;
  /** Facts from schema.org JSON-LD (IMDb, shops, recipes), when the page has any. */
  structured?: StructuredData;
  /**
   * "readability", "body" (Readability found nothing, cleaned body used) or "listing" (front,
   * category or index page: one bullet per card instead of Readability's guess).
   */
  method: "readability" | "body" | "listing";
  /** Cards on a listing page (method "listing" only). */
  listingItems?: number;
  truncated: boolean;
}

export interface StructuredData {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  datePublished?: string;
  /** Short label/value facts (genre, rating, director, ...), already flattened to text. */
  facts: Array<{ label: string; value: string }>;
}

const ID = "web-article";

const asText = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(asText).filter((x): x is string => !!x);
    return parts.length ? [...new Set(parts)].slice(0, 6).join(", ") : undefined;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asText(o.name ?? o.url ?? o["@id"]);
  }
  return undefined;
};

const FACT_LABELS: Record<string, ContentPhraseKey> = {
  genre: "genre",
  director: "director",
  creator: "createdBy",
  actor: "cast",
  author: "author",
  duration: "duration",
  contentRating: "contentRating",
  inLanguage: "language",
  brand: "brand",
  address: "address",
  telephone: "phone",
};

/** First useful schema.org object from `application/ld+json` blocks (walks @graph and arrays). */
export function parseJsonLd(blocks: readonly string[]): StructuredData | undefined {
  const nodes: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o["@graph"]) walk(o["@graph"]);
      if (o["@type"]) nodes.push(o);
    }
  };
  for (const raw of blocks) {
    try {
      walk(JSON.parse(raw));
    } catch {
      // Broken JSON-LD is common; skip the block.
    }
  }
  const skip = /^(WebSite|WebPage|BreadcrumbList|SearchAction|ImageObject|SiteNavigationElement)$/;
  const node = nodes.find(
    (n) => !skip.test(String(asText(n["@type"]) ?? "")) && (n.name || n.headline),
  );
  if (!node) return undefined;
  const facts: StructuredData["facts"] = [];
  for (const [key, label] of Object.entries(FACT_LABELS)) {
    const value = asText(node[key]);
    if (value) facts.push({ label: ph(label), value: value.slice(0, 300) });
  }
  const rating = node.aggregateRating as Record<string, unknown> | undefined;
  const rv = asText(rating?.ratingValue);
  if (rv)
    facts.push({
      label: ph("rating"),
      value: `${rv}${rating?.bestRating ? `/${asText(rating.bestRating)}` : ""}`,
    });
  return {
    type: asText(node["@type"]),
    name: asText(node.name ?? node.headline),
    description: asText(node.description),
    image: asText(node.image),
    datePublished: asText(node.datePublished ?? node.uploadDate),
    facts,
  };
}
export const DIRECT_MAX_BYTES = 5 * 1024 * 1024;

const nhm = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  maxConsecutiveNewlines: 2,
});

/** Reads at most `maxBytes` of the body (servers may lie about or omit content-length). */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return { bytes: all.slice(0, maxBytes), truncated: all.byteLength > maxBytes };
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      parts.push(value.slice(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    parts.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  return { bytes, truncated };
}

/** Charset from the header, else from `<meta charset>` in the first bytes; UTF-8 by default. */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  let label = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (!label) {
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    label = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

type Doc = ReturnType<typeof ParseHTML>["document"];

/**
 * linkedom is loaded on first use, not at import time: @kortex/ai-core is imported by every web
 * server-action module (e.g. for slugify), and bundling linkedom's CSS object model
 * (@acemir/cssom, circular modules) into those chunks crashed them in the production build
 * ("Cannot read properties of undefined (reading 'prototype')"). The web app also lists linkedom
 * in serverExternalPackages so Node loads it natively.
 */
let linkedom: Promise<typeof import("linkedom")> | null = null;
const loadParseHTML = async (): Promise<typeof ParseHTML> =>
  (await (linkedom ??= import("linkedom"))).parseHTML;

const meta = (doc: Doc, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const el = doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`);
    const v = el?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return undefined;
};

const absolute = (value: string | null | undefined, base: string): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
};

/** Makes links/images absolute and promotes lazy-loading sources, so the Markdown works outside the page. */
function absolutize(doc: Doc, base: string) {
  for (const img of doc.querySelectorAll("img")) {
    const src =
      img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src") ?? img.getAttribute("src");
    const abs = absolute(src, base);
    if (abs && !abs.startsWith("data:")) img.setAttribute("src", abs);
    else img.remove();
  }
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#") || href.startsWith("javascript:")) a.removeAttribute("href");
    else {
      const abs = absolute(href, base);
      if (abs) a.setAttribute("href", abs);
    }
  }
}

const NOISE =
  "script, style, noscript, template, svg, iframe, form, nav, header, footer, aside, [role=navigation], [aria-hidden=true]";

const cleanMarkdown = (md: string): string =>
  md
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Fetches `url` and returns its main content as Markdown plus OpenGraph metadata. */
export async function readDirect(
  fetchFn: FetchLike,
  url: string,
  options: DirectReadOptions = {},
): Promise<DirectReadResult> {
  // The page URL is user-controlled: public hosts only, every redirect re-checked.
  const res = await request(createSafeFetch({ fetch: fetchFn }), ID, url, {
    timeoutMs: options.timeoutMs ?? 20_000,
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "Accept-Language": acceptLanguage(),
    },
  });
  const type = res.headers.get("content-type");
  if (type && !/html|xml/i.test(type))
    throw new ExtractionError(ID, `direct: not an HTML page (${type.split(";")[0]})`);
  const { bytes, truncated } = await readCapped(res, options.maxBytes ?? DIRECT_MAX_BYTES);
  return readHtml(decodeHtml(bytes, type), res.url || url, { truncated });
}

/**
 * Turns an already fetched HTML page into Markdown plus OpenGraph and JSON-LD metadata. No network,
 * so adapters that fetched the page themselves (recipe, movie) reuse it.
 */
export async function readHtml(
  source: string,
  finalUrl: string,
  { truncated = false }: { truncated?: boolean } = {},
): Promise<DirectReadResult> {
  const parseHTML = await loadParseHTML();
  const { document } = parseHTML(source);

  // Metadata first: Readability mutates the document.
  const structured = parseJsonLd(
    [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (s) => s.textContent ?? "",
    ),
  );
  const ogTitle = meta(document, "og:title", "twitter:title");
  const docTitle = document.querySelector("title")?.textContent?.trim();
  const result: Omit<DirectReadResult, "markdown" | "method"> = {
    title: ogTitle ?? structured?.name ?? docTitle,
    description:
      meta(document, "og:description", "description", "twitter:description") ??
      structured?.description,
    canonicalUrl: absolute(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
        meta(document, "og:url"),
      finalUrl,
    ),
    coverImageUrl: absolute(
      meta(document, "og:image", "og:image:url", "twitter:image") ?? structured?.image,
      finalUrl,
    ),
    publishedTime:
      meta(document, "article:published_time", "og:article:published_time", "date") ??
      structured?.datePublished,
    siteName: meta(document, "og:site_name", "application-name"),
    language: document.documentElement?.getAttribute("lang") ?? undefined,
    structured,
    truncated,
  };
  absolutize(document, finalUrl);

  let html: string | undefined;
  let method: DirectReadResult["method"] = "readability";
  try {
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
      {
        charThreshold: 250,
      },
    ).parse();
    if (article?.content && (article.textContent ?? "").trim().length > 0) {
      html = article.content;
      result.title ??= article.title ?? undefined;
      result.byline = article.byline ?? undefined;
      result.siteName ??= article.siteName ?? undefined;
      result.description ??= article.excerpt ?? undefined;
    }
  } catch {
    html = undefined;
  }
  if (!html) {
    // Readability gave up (very short or app-like page): clean the main region ourselves.
    method = "body";
    const { document: fresh } = parseHTML(source);
    absolutize(fresh, finalUrl);
    const root = fresh.querySelector("article, main, [role=main]") ?? fresh.body;
    for (const el of root?.querySelectorAll(NOISE) ?? []) el.remove();
    html = root?.innerHTML ?? "";
  }

  let markdown = cleanMarkdown(nhm.translate(html ?? ""));
  const title = result.title?.trim();

  // Listing pages: the cards are the content, not the intro or the glued link soup Readability kept.
  const { document: cards } = parseHTML(source);
  absolutize(cards, finalUrl);
  const items = extractListingItems(cards as unknown as ListingDoc, finalUrl);
  if (isListing(items, markdown)) {
    const description = result.description?.trim();
    return {
      ...result,
      title,
      markdown: listingMarkdown(items, { title, description }),
      method: "listing",
      listingItems: items.length,
    };
  }

  if (title && !/^#\s/.test(markdown)) markdown = `# ${title}\n\n${markdown}`;
  return { ...result, title, markdown, method };
}
