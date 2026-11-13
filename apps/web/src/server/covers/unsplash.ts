import { t } from "@/i18n";
/*
 * W4 (feedback round 3): cover search over Unsplash. The browser never sees the key: GET /api/covers/unsplash?q=
 * proxies the search with UNSPLASH_ACCESS_KEY (optional; without it the route answers `enabled: false` and the
 * cover dialog only offers the upload). Unsplash API guidelines: images are hotlinked (urls.regular), the photographer
 * is credited, and choosing a photo triggers its download endpoint (POST /api/covers/unsplash/download).
 */

export const UNSPLASH_API = "https://api.unsplash.com";
export const UNSPLASH_PER_PAGE = 24;
const UTM = "utm_source=kortex&utm_medium=referral";

export interface UnsplashPhoto {
  id: string;
  /** Small preview for the grid (about 400 px wide). */
  thumb: string;
  /** Cover URL saved on the item (about 1600 px wide). */
  url: string;
  alt: string;
  /** Average colour, shown while the preview loads. */
  color: string | null;
  author: { name: string; link: string };
  /** download_location of the photo; pinged when it is chosen. */
  download: string;
}

export interface UnsplashSearch {
  enabled: boolean;
  results: UnsplashPhoto[];
  total: number;
}

export const unsplashKey = (env: Record<string, string | undefined> = process.env): string | null => {
  const v = env.UNSPLASH_ACCESS_KEY?.trim().replace(/^["']|["']$/g, "");
  return v && !/^<.*>$/.test(v) ? v : null;
};

/** Search query from the request: trimmed, at most 100 characters. */
export function cleanQuery(q: string | null): string {
  return (q ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
}

export function searchUrl(query: string, page = 1): string {
  const p = new URLSearchParams({ query, page: String(Math.max(1, Math.min(50, page))), per_page: String(UNSPLASH_PER_PAGE), orientation: "landscape", content_filter: "high" });
  return `${UNSPLASH_API}/search/photos?${p}`;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const withUtm = (link: string) => (link ? `${link}${link.includes("?") ? "&" : "?"}${UTM}` : "https://unsplash.com/?" + UTM);

/** Raw Unsplash search JSON to our photo list; entries without image URLs are dropped. */
export function mapSearch(json: unknown): { results: UnsplashPhoto[]; total: number } {
  const o = (json ?? {}) as { results?: unknown; total?: unknown };
  const list = Array.isArray(o.results) ? o.results : [];
  const results: UnsplashPhoto[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const urls = (r.urls ?? {}) as Record<string, unknown>;
    const user = (r.user ?? {}) as Record<string, unknown>;
    const links = (r.links ?? {}) as Record<string, unknown>;
    const userLinks = (user.links ?? {}) as Record<string, unknown>;
    const raw = str(urls.raw);
    const thumb = str(urls.small) || str(urls.thumb);
    const url = raw ? `${raw}${raw.includes("?") ? "&" : "?"}w=1600&q=80&fm=jpg&fit=crop` : str(urls.regular);
    if (!thumb || !url || !str(r.id)) continue;
    results.push({
      id: str(r.id),
      thumb,
      url,
      alt: str(r.alt_description) || str(r.description) || t("Photo"),
      color: str(r.color) || null,
      author: { name: str(user.name) || t("Unknown"), link: withUtm(str(userLinks.html)) },
      download: str(links.download_location),
    });
  }
  return { results, total: typeof o.total === "number" ? o.total : results.length };
}

/** Only Unsplash's own download endpoints may be pinged through the proxy. */
export function isDownloadLocation(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "api.unsplash.com" && /^\/photos\/[\w-]+\/download$/.test(url.pathname);
  } catch {
    return false;
  }
}

export async function searchUnsplash(key: string, query: string, page = 1, fetcher: typeof fetch = fetch): Promise<UnsplashSearch> {
  const res = await fetcher(searchUrl(query, page), {
    headers: { authorization: `Client-ID ${key}`, "accept-version": "v1" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(t("Unsplash responded with {status}", { status: res.status }));
  return { enabled: true, ...mapSearch(await res.json()) };
}

export async function pingDownload(key: string, location: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!isDownloadLocation(location)) throw new Error(t("Invalid download address"));
  const res = await fetcher(location, { headers: { authorization: `Client-ID ${key}`, "accept-version": "v1" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(t("Unsplash responded with {status}", { status: res.status }));
}
