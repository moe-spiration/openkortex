import { t } from "../../i18n";
import { absHttp, text } from "./dom";
import type { Extracted, Extractor, ExtractContext } from "./types";

/* Amazon product pages ship no og:image. The photo lives on #landingImage (data-old-hires, or the
   largest entry of data-a-dynamic-image), the price in .a-offscreen. */

const AMAZON_HOST = /(^|\.)amazon\.(com|de|co\.uk|fr|it|es|nl|pl|se|com\.tr|com\.be|ca|com\.mx|com\.br|co\.jp|in|com\.au|sg|ae|sa|eg)$/;

/** Largest URL of `{"https://…_SX679_.jpg": [679, 679], …}`. */
export function largestDynamicImage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const entries = Object.entries(JSON.parse(raw) as Record<string, [number, number]>);
    entries.sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1]);
    return entries[0]?.[0] ?? null;
  } catch {
    return null;
  }
}

export function amazonImages(doc: Document, base: string): string[] {
  const img = doc.querySelector<HTMLImageElement>("#landingImage, #imgBlkFront, #ebooksImgBlkFront, #main-image");
  const candidates = [
    img?.getAttribute("data-old-hires"),
    largestDynamicImage(img?.getAttribute("data-a-dynamic-image")),
    img?.getAttribute("src"),
    doc.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content,
  ];
  return [...new Set(candidates.map((c) => absHttp(c, base)).filter((v): v is string => !!v))];
}

export function amazonPrice(doc: Document): string | null {
  const el = doc.querySelector(
    "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #apex_desktop .a-price .a-offscreen, .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice",
  );
  return text(el) || null;
}

export const amazon: Extractor = {
  id: "amazon",
  matches: (url) => AMAZON_HOST.test(url.hostname) && /\/(dp|gp\/product|gp\/aw\/d)\//i.test(url.pathname),
  extract({ doc, url }: ExtractContext): Extracted {
    const title = text(doc.querySelector("#productTitle, #ebooksProductTitle"));
    const price = amazonPrice(doc);
    const bullets = [...doc.querySelectorAll("#feature-bullets li span.a-list-item")].map(text).filter(Boolean).slice(0, 3);
    const description = [price ? t("Price: {price}", { price }) : null, bullets.join(" ")].filter(Boolean).join(". ").slice(0, 600);
    return {
      images: amazonImages(doc, url),
      site_name: "Amazon",
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    };
  },
};
