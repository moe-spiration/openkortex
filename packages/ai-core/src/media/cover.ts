import { acceptLanguage } from "../i18n";
import { storagePath } from "@kortex/db";
import { parseYouTubeVideoId } from "../adapters/youtube.adapter";
import { errorMessage } from "../errors";
import { BROWSER_USER_AGENT, defaultFetch, type FetchLike } from "../http";
import { createSafeFetch, readBodyLimited, readTextLimited } from "../net/safe-fetch";
import type { StorageGateway } from "../storage";

/*
 * Covers that do not break: candidates from the client, the adapter and the provider (YouTube
 * thumbnails, Spotify/Vimeo oEmbed), then the page itself (JSON-LD image, og:image,
 * twitter:image, Amazon hi-res images). The first candidate that is a real image (≥ 100 px, not
 * a tracking pixel) is downloaded and stored in kortex-media; remote URLs rot or block hotlinks.
 */

export const COVER_MAX_BYTES = 6 * 1024 * 1024;
const MIN_SIDE = 100;

export interface CoverImage {
  data: Uint8Array;
  mimeType: string;
  ext: string;
  width: number;
  height: number;
  sourceUrl: string;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Width and height from the file header (JPEG, PNG, GIF, WebP); null when unknown. */
export function imageSize(b: Uint8Array): { width: number; height: number; type: string } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { width: v.getUint32(16), height: v.getUint32(20), type: "image/png" };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
    return { width: v.getUint16(6, true), height: v.getUint16(8, true), type: "image/gif" };
  if (
    b.length > 30 &&
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP"
  ) {
    const kind = String.fromCharCode(...b.subarray(12, 16));
    if (kind === "VP8 ")
      return {
        width: v.getUint16(26, true) & 0x3fff,
        height: v.getUint16(28, true) & 0x3fff,
        type: "image/webp",
      };
    if (kind === "VP8L") {
      const bits = v.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        type: "image/webp",
      };
    }
    if (kind === "VP8X")
      return {
        width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
        height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
        type: "image/webp",
      };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = v.getUint16(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: v.getUint16(i + 5), width: v.getUint16(i + 7), type: "image/jpeg" };
      i += 2 + len;
    }
  }
  return null;
}

/** Downloads a candidate; null unless it is a real image of at least 100×100 px. */
export async function fetchCover(
  url: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<CoverImage | null> {
  let res: Response;
  try {
    // Candidates come from pages and clients: public hosts only, every redirect re-checked.
    res = await createSafeFetch({ fetch: fetchFn })(url, {
      headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "image/avif,image/webp,image/*;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type && !type.startsWith("image/")) return null;
  const data = await readBodyLimited(res, COVER_MAX_BYTES).catch(() => null);
  if (!data || data.length < 800) return null;
  const size = imageSize(data);
  if (!size || size.width < MIN_SIDE || size.height < MIN_SIDE) return null;
  const mimeType = size.type;
  return {
    data,
    mimeType,
    ext: EXT[mimeType] ?? "jpg",
    width: size.width,
    height: size.height,
    sourceUrl: url,
  };
}

const attr = (tag: string, name: string) =>
  new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, "/")
    .replace(/\\u002F/g, "/");

/** Cover candidates declared by an HTML page, best first. */
export function pageCoverCandidates(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const abs = (u: string | undefined) => {
    if (!u) return;
    try {
      out.push(new URL(decode(u.trim()), pageUrl).toString());
    } catch {
      /* ignore */
    }
  };
  // Amazon product images: data-old-hires, the dynamic-image map (largest), "hiRes" in scripts.
  abs(/data-old-hires\s*=\s*["']([^"']+)["']/i.exec(html)?.[1]);
  const dyn = /data-a-dynamic-image\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  if (dyn) {
    try {
      const map = JSON.parse(decode(dyn)) as Record<string, [number, number]>;
      const best = Object.entries(map).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0];
      abs(best?.[0]);
    } catch {
      /* ignore */
    }
  }
  abs(/"hiRes"\s*:\s*"([^"]+)"/.exec(html)?.[1]);
  // JSON-LD image (string, object or array)
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: unknown): void => {
        if (!v) return;
        if (Array.isArray(v)) return v.forEach(walk);
        if (typeof v !== "object") return;
        const o = v as Record<string, unknown>;
        const img = o.image ?? o.thumbnailUrl;
        if (typeof img === "string") abs(img);
        else if (Array.isArray(img))
          img.forEach((x) => (typeof x === "string" ? abs(x) : abs((x as { url?: string })?.url)));
        else if (img && typeof img === "object") abs((img as { url?: string }).url);
        if (o["@graph"]) walk(o["@graph"]);
      };
      walk(JSON.parse(m[1]!));
    } catch {
      /* broken JSON-LD */
    }
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    if (
      [
        "og:image",
        "og:image:secure_url",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
      ].includes(key)
    )
      abs(attr(m[0], "content"));
  }
  for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/gi))
    abs(attr(m[0], "href"));
  return [...new Set(out)];
}

/** Amazon ASIN from a product URL (/dp/, /gp/product/). */
export const amazonAsin = (url: string): string | undefined => {
  try {
    const u = new URL(url);
    if (!/(^|\.)amazon\.[a-z.]+$/.test(u.hostname)) return undefined;
    return /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/.exec(u.pathname)?.[1];
  } catch {
    return undefined;
  }
};

/** Provider-specific candidates that need no page fetch. */
export async function providerCoverCandidates(url: string, fetchFn: FetchLike): Promise<string[]> {
  const yt = parseYouTubeVideoId(url);
  if (yt)
    return [
      `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${yt}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    ];
  const oembed = /^https:\/\/(open\.spotify\.com|vimeo\.com)\//.test(url)
    ? url.includes("spotify")
      ? `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
    : null;
  if (oembed) {
    try {
      const r = await fetchFn(oembed, { signal: AbortSignal.timeout(10_000) });
      const j = r.ok ? ((await r.json()) as { thumbnail_url?: string }) : {};
      if (j.thumbnail_url) return [j.thumbnail_url];
    } catch {
      /* fall through */
    }
  }
  return [];
}

async function fetchPage(url: string, fetchFn: FetchLike): Promise<string | null> {
  try {
    const r = await createSafeFetch({ fetch: fetchFn })(url, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/html",
        "Accept-Language": acceptLanguage(),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return null;
    return await readTextLimited(r, 3_000_000);
  } catch {
    return null;
  }
}

export interface ResolveCoverInput {
  /** Source page of the item. */
  url?: string;
  /** In priority order: client image, adapter cover, adapter's extra candidates. */
  candidates: (string | null | undefined)[];
  fetch?: FetchLike;
}

/** The first working cover among the candidates, the provider's and the page's own. */
/**
 * Site-wide share images that say nothing about the item (Amazon's "previewdoh" logo on bot
 * pages, logos, placeholders). Skipped so the product image or the next candidate wins.
 */
export const isGenericImage = (url: string): boolean =>
  /\/share-icons\/|\/previewdoh\/|\/(?:site-)?logos?[-_./]|favicon|placeholder|\/default[-_](?:og|share|image)/i.test(
    url,
  );

export async function resolveCover(
  o: ResolveCoverInput,
): Promise<{ cover: CoverImage | null; tried: number }> {
  const fetchFn = o.fetch ?? defaultFetch;
  const seen = new Set<string>();
  let tried = 0;
  const attempt = async (list: (string | null | undefined)[]) => {
    for (const c of list) {
      if (!c || seen.has(c) || !/^https?:\/\//.test(c) || isGenericImage(c)) continue;
      seen.add(c);
      tried++;
      const img = await fetchCover(c, fetchFn);
      if (img) return img;
    }
    return null;
  };
  let cover = await attempt(o.candidates);
  if (!cover && o.url) cover = await attempt(await providerCoverCandidates(o.url, fetchFn));
  if (!cover && o.url && !parseYouTubeVideoId(o.url)) {
    const html = await fetchPage(o.url, fetchFn);
    if (html) cover = await attempt(pageCoverCandidates(html, o.url));
  }
  if (!cover && o.url) {
    const asin = amazonAsin(o.url);
    if (asin)
      cover = await attempt([
        `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`,
      ]);
  }
  return { cover, tried };
}

/** Stores the cover in kortex-media (`<user>/covers/<item>.<ext>`); returns the gateway's URL. */
export async function storeCover(
  storage: StorageGateway,
  userId: string,
  itemId: string,
  cover: CoverImage,
) {
  const path = storagePath(userId, "covers", `${itemId}.${cover.ext}`);
  const r = await storage.upload({
    bucket: "kortex-media",
    path,
    data: cover.data,
    contentType: cover.mimeType,
  });
  return { path: r.path, url: r.url ?? null };
}

export const coverError = (err: unknown) => `cover: ${errorMessage(err)}`;
