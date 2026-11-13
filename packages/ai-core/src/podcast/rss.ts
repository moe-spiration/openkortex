import { matchKey } from "../enrichment/auto-organizer";
import { decodeEntities, findElements, stripTags } from "../util/markup";

export interface RssEpisode {
  title: string;
  guid?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  durationSec?: number;
  enclosureUrl?: string;
  enclosureType?: string;
  /** `<podcast:transcript>` (Podcasting 2.0), best format first. */
  transcripts: Array<{ url: string; type: string }>;
  image?: string;
}

export interface RssFeed {
  title: string;
  author?: string;
  image?: string;
  episodes: RssEpisode[];
}

const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const text = (xml: string, tag: string) => {
  const el = findElements(xml, tag)[0];
  const v = el ? decodeEntities(stripTags(cdata(el.inner))) : "";
  return v || undefined;
};

/** "1:02:03", "62:03" or "3723" → seconds. */
export function parseDuration(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const parts = v.trim().split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0) || undefined;
}

const TRANSCRIPT_RANK = (type: string) =>
  /json/.test(type) ? 0 : /vtt/.test(type) ? 1 : /srt|subrip/.test(type) ? 2 : 3;

export function parseRssFeed(xml: string): RssFeed {
  const channelXml = xml.split(/<item\b/i)[0] ?? "";
  const episodes = findElements(xml, "item").map(({ inner }) => {
    const enclosure = findElements(inner, "enclosure")[0]?.attrs;
    const transcripts = findElements(inner, "transcript")
      .map((t) => ({ url: t.attrs.url ?? "", type: t.attrs.type ?? "" }))
      .filter((t) => t.url)
      .sort((a, b) => TRANSCRIPT_RANK(a.type) - TRANSCRIPT_RANK(b.type));
    return {
      title: text(inner, "title") ?? "",
      guid: text(inner, "guid"),
      link: text(inner, "link"),
      pubDate: text(inner, "pubDate"),
      description: text(inner, "description") ?? text(inner, "summary"),
      durationSec: parseDuration(text(inner, "duration")),
      enclosureUrl: enclosure?.url,
      enclosureType: enclosure?.type,
      transcripts,
      image: findElements(inner, "image")[0]?.attrs.href,
    };
  });
  return {
    title: text(channelXml, "title") ?? "",
    author: text(channelXml, "author"),
    image: findElements(channelXml, "image").find((i) => i.attrs.href)?.attrs.href,
    episodes,
  };
}

/** Token overlap of two titles (0..1), umlaut- and punctuation-insensitive. */
export function titleSimilarity(a: string, b: string): number {
  if (matchKey(a) && matchKey(a) === matchKey(b)) return 1;
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1)
        .map(matchKey),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

/** Best-matching episode by title, if similar enough. */
export function findEpisode(feed: RssFeed, title: string, threshold = 0.6): RssEpisode | undefined {
  let best: { ep: RssEpisode; score: number } | undefined;
  for (const ep of feed.episodes) {
    const score = titleSimilarity(ep.title, title);
    if (score >= threshold && (!best || score > best.score)) best = { ep, score };
  }
  return best?.ep;
}

/**
 * Like findEpisode, but when several episodes share a title (daily news shows) the one published
 * closest to `publishedAt` wins.
 */
export function findEpisodeNear(
  feed: RssFeed,
  title: string,
  publishedAt?: string,
  threshold = 0.6,
): RssEpisode | undefined {
  const target = publishedAt ? Date.parse(publishedAt) : NaN;
  const scored = feed.episodes
    .map((ep) => ({ ep, score: titleSimilarity(ep.title, title) }))
    .filter((x) => x.score >= threshold);
  if (!scored.length) return undefined;
  const top = Math.max(...scored.map((x) => x.score));
  const best = scored.filter((x) => x.score >= top - 0.05);
  if (best.length === 1 || Number.isNaN(target)) return best[0]!.ep;
  const dist = (ep: RssEpisode) => {
    const t = ep.pubDate ? Date.parse(ep.pubDate) : NaN;
    return Number.isNaN(t) ? Infinity : Math.abs(t - target);
  };
  return best.sort((a, b) => dist(a.ep) - dist(b.ep))[0]!.ep;
}
