import type { MediaInfo, Transcript } from "./api";

export interface PageMeta {
  url: string;
  title: string;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  /** Hostname without `www.` */
  domain: string;
  /** Rough reading time in minutes from the visible text (null for tiny pages). */
  reading_minutes: number | null;
  /** keywords + article:tag, for tag suggestions */
  keywords: string[];
  /** Cover candidates, best first (`image_url` is the first one unless the user picks another). http(s) only. */
  image_candidates?: string[];
  /** Captions found on the page (YouTube). */
  transcript?: Transcript;
  media?: MediaInfo;
  /** Short German notes about what could not be read ("Keine Untertitel gefunden"). */
  capture_notes?: string[];
}

/**
 * Reads OpenGraph/Twitter/standard metadata. SELF-CONTAINED on purpose: it is passed to
 * `chrome.scripting.executeScript({ func })`, which serialises the function body, so it must not
 * reference anything outside itself.
 */
export function extractPageMeta(doc: Document = document, href: string = location.href): PageMeta {
  const meta = (...names: string[]) => {
    for (const n of names) {
      const el = doc.querySelector<HTMLMetaElement>(`meta[property="${n}"], meta[name="${n}"]`);
      const v = el?.content?.trim();
      if (v) return v;
    }
    return null;
  };
  const abs = (v: string | null) => {
    if (!v) return null;
    try {
      return new URL(v, href).href;
    } catch {
      return null;
    }
  };
  const url = new URL(href);
  const canonical = abs(doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href") ?? null);
  const text = doc.body?.innerText ?? doc.body?.textContent ?? "";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const keywords = [
    ...(meta("keywords")?.split(",") ?? []),
    ...[...doc.querySelectorAll<HTMLMetaElement>('meta[property="article:tag"]')].map((m) => m.content),
  ]
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 12);
  return {
    url: canonical && new URL(canonical).host === url.host ? canonical : url.href,
    title: meta("og:title", "twitter:title") ?? (doc.title.trim() || url.hostname),
    description: meta("og:description", "twitter:description", "description"),
    // http(s) only: the server rejects data:/blob: URLs, which some sites put in og:image
    image_url: (() => {
      const u = abs(meta("og:image", "og:image:url", "twitter:image", "twitter:image:src"));
      return u && /^https?:/i.test(u) ? u : null;
    })(),
    site_name: meta("og:site_name", "application-name"),
    domain: url.hostname.replace(/^www\./, ""),
    reading_minutes: words >= 200 ? Math.max(1, Math.round(words / 220)) : null,
    keywords,
  };
}
