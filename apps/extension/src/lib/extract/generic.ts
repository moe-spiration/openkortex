import { absHttp, dedupe, hasType, imagesOfNode, isoDate, isoDurationSec, jsonLd, meta } from "./dom";
import type { Extracted, ExtractContext } from "./types";

/** Smallest side that makes an in-page image a reasonable cover. */
const MIN_COVER = 300;

interface Sized {
  url: string;
  area: number;
}

/** Largest visible content images (>= 300 px on both sides), skipping icons, avatars and ads. */
export function largeContentImages(doc: Document, base: string, limit = 3): string[] {
  const found: Sized[] = [];
  for (const img of doc.querySelectorAll<HTMLImageElement>("img")) {
    if (img.closest("header, nav, footer, aside, [role=banner], [role=navigation]")) continue;
    if (/avatar|logo|icon|sprite|pixel|tracking|badge/i.test(`${img.className} ${img.id} ${img.alt}`)) continue;
    const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || "";
    const url = absHttp(src, base);
    if (!url) continue;
    const w = img.naturalWidth || img.width || Number(img.getAttribute("width")) || img.getBoundingClientRect().width;
    const h = img.naturalHeight || img.height || Number(img.getAttribute("height")) || img.getBoundingClientRect().height;
    if (w >= MIN_COVER && h >= MIN_COVER) found.push({ url, area: w * h });
  }
  return found.sort((a, b) => b.area - a.area).slice(0, limit).map((f) => f.url);
}

/**
 * Cover and media hints that work on any page: JSON-LD (Article/Product/VideoObject), og:/twitter:
 * images, `image_src`, then the largest content image. Candidates keep that order, best first.
 */
export function genericExtract({ doc, url }: ExtractContext): Extracted {
  const ld = jsonLd(doc);
  const ldImages = ld
    .filter((n) => hasType(n, "Article", "NewsArticle", "BlogPosting", "Product", "VideoObject", "Recipe"))
    .flatMap((n) => imagesOfNode(n, "image", "thumbnailUrl"));
  const social = [
    meta(doc, "og:image", "og:image:url", "og:image:secure_url"),
    meta(doc, "twitter:image", "twitter:image:src"),
    doc.querySelector<HTMLLinkElement>('link[rel="image_src"]')?.getAttribute("href") ?? null,
  ];
  const images = dedupe(
    [...ldImages, ...social, ...largeContentImages(doc, url)].map((v) => absHttp(v, url)).filter((v): v is string => !!v),
  );

  const out: Extracted = { images };
  const video = ld.find((n) => hasType(n, "VideoObject"));
  if (video) {
    const author = video.author ?? video.creator;
    const channel = typeof author === "string" ? author : (author as { name?: string } | undefined)?.name;
    out.media = {
      kind: "video",
      provider: "other",
      ...(isoDurationSec(video.duration) ? { duration_sec: isoDurationSec(video.duration)! } : {}),
      ...(channel ? { channel } : {}),
      ...(isoDate(video.uploadDate) ? { published_at: isoDate(video.uploadDate)! } : {}),
    };
  }
  return out;
}
