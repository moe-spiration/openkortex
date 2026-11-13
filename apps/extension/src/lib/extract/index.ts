// Pluggable page extraction: the generic metadata reader plus one extractor per site that needs more
// (YouTube captions, Amazon photos, podcast artwork). Add a site by adding an `Extractor` to
// `EXTRACTORS`; the matching one contributes first, the generic reader fills the rest.
import { extractPageMeta, type PageMeta } from "../page-meta";
import { absHttp, dedupe } from "./dom";
import { amazon } from "./amazon";
import { genericExtract } from "./generic";
import { applePodcasts, spotify } from "./podcasts";
import type { Extractor, ExtractContext } from "./types";
import { youtube } from "./youtube";

export type { ExtractContext, Extractor } from "./types";

export const EXTRACTORS: readonly Extractor[] = [youtube, amazon, spotify, applePodcasts];

/** Name of the page-world function the unlisted script (entrypoints/extract.ts) installs. */
export const EXTRACT_GLOBAL = "__kortexExtract";

const MAX_CANDIDATES = 6;

/** One extractor's failure or a hanging fetch must never cost the clip. */
async function guarded<T>(work: () => Promise<T> | T, ms = 30_000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractPage(ctx: ExtractContext, extractors: readonly Extractor[] = EXTRACTORS): Promise<PageMeta> {
  const base = extractPageMeta(ctx.doc, ctx.url);
  const generic = (await guarded(() => genericExtract(ctx))) ?? {};
  const site = extractors.find((e) => e.matches(new URL(ctx.url)));
  const specific = site ? ((await guarded(() => site.extract(ctx))) ?? {}) : {};

  const ranked = dedupe(
    [...(specific.images ?? []), ...(generic.images ?? []), ...(base.image_url ? [base.image_url] : [])]
      .map((v) => absHttp(v, ctx.url))
      .filter((v): v is string => !!v),
  );
  // Logos are often SVG, which the server cannot turn into a preview: raster covers first, order kept otherwise.
  const isSvg = (u: string) => /\.svg(?:$|[?#])/i.test(u);
  const images = [...ranked.filter((u) => !isSvg(u)), ...ranked.filter(isSvg)].slice(0, MAX_CANDIDATES);

  const media = specific.media ?? generic.media;
  return {
    ...base,
    title: specific.title?.trim() || base.title,
    description: specific.description ?? base.description,
    site_name: specific.site_name ?? base.site_name,
    image_url: images[0] ?? null,
    image_candidates: images,
    ...(media ? { media } : {}),
    ...(specific.transcript ? { transcript: specific.transcript } : {}),
    ...(specific.notes?.length ? { capture_notes: specific.notes } : {}),
  };
}

/** What runs inside the page (entrypoints/extract.ts): the real document and a same-origin fetch. */
export const extractCurrentPage = (): Promise<PageMeta> =>
  extractPage({
    doc: document,
    url: location.href,
    fetchText: async (url) => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
  });
