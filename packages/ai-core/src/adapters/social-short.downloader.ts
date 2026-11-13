import { acceptLanguage, contentLanguages } from "../i18n";
import { parseCues } from "../audio/timed-text";
import type { TranscriptSegment } from "../audio/transcriber";
import { AdapterDeclinedError, errorMessage } from "../errors";
import { type FetchLike } from "../http";
import { imageSize } from "../media/cover";
import { createSafeFetch, readBodyLimited, readTextLimited } from "../net/safe-fetch";
import type {
  SocialKeyframe,
  SocialMediaBundle,
  SocialMediaDownloader,
  SocialPlatform,
} from "./social-short.adapter";

/*
 * Server-side download of public Reels and TikToks, no login and no third-party service:
 * - TikTok: the video page carries its data (__UNIVERSAL_DATA_FOR_REHYDRATION__): caption,
 *   author, length, cover, the mp4 (needs the page's cookies) and often WebVTT subtitles, which
 *   make paid speech-to-text unnecessary. Fallback: oEmbed (caption, author, thumbnail).
 * - Instagram: the embed page, fetched as a link preview, carries the post as JSON
 *   (contextJSON → shortcode_media): caption, author, length, image(s) and the mp4.
 * Verified from the prod host (2026-10-25). Keyframes are the stills the platforms publish
 * (cover, carousel/slideshow images); real frame extraction would need ffmpeg in the image.
 * When nothing can be read the adapter declines, so ingest falls back to clipping the page.
 *
 * Every request goes through the public-only guard (net/safe-fetch). Media, subtitle and image
 * URLs taken from the page data must be https on the platforms' own hosts (MEDIA_HOSTS); the
 * TikTok cookies are only sent to TikTok hosts. Bodies are read with streamed size caps.
 */

const ID = "social-short";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/** Instagram answers link previews (not browsers) with the post data. */
const PREVIEW_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
export const TIKTOK_OEMBED_URL = "https://www.tiktok.com/oembed";

export interface PublicSocialDownloaderOptions {
  fetch?: FetchLike;
  /** Largest video downloaded for speech-to-text (default 60 MB). */
  maxVideoBytes?: number;
  /** Longer clips get no audio download (default 10 min; keeps STT cost small). */
  maxAudioSec?: number;
  /** Preferred subtitle languages, first match wins (default de, en). */
  languages?: string[];
  timeoutMs?: number;
}

/**
 * Hosts the platforms serve media, subtitles and images from (suffix match). Seen on real
 * traffic (2026-10-25): *.tiktok.com, *.tiktokcdn-eu.com, *.cdninstagram.com; the rest are the
 * same CDN families in other regions.
 */
const MEDIA_HOSTS =
  /(^|\.)(tiktok\.com|tiktokv\.(com|eu|us)|tiktokcdn(-[a-z]{2})?\.com|ttwstatic\.com|ibyteimg\.com|ibytedtos\.com|byteoversea\.com|muscdn\.com|instagram\.com|cdninstagram\.com|fbcdn\.net)$/i;
/** The TikTok session cookies go to these hosts only. */
const TIKTOK_COOKIE_HOSTS = /(^|\.)(tiktok\.com|tiktokv\.(com|eu|us)|tiktokcdn(-[a-z]{2})?\.com)$/i;

/** https on a platform media host. */
export function isPlatformMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && MEDIA_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

const PAGE_MAX_BYTES = 5 * 1024 * 1024;
const TEXT_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

interface Ctx {
  fetch: FetchLike;
  maxVideoBytes: number;
  maxAudioSec: number;
  languages: () => string[];
  timeoutMs: number;
}

const decline = (reason: string): never => {
  throw new AdapterDeclinedError(ID, reason);
};

async function get(c: Ctx, url: string, headers: Record<string, string>): Promise<Response> {
  return c.fetch(url, { headers, signal: AbortSignal.timeout(c.timeoutMs) });
}

/** Media/subtitle/image URL from page data: platform host or nothing. */
function mediaUrl(url: string, what: string, warnings: string[]): string | null {
  if (isPlatformMediaUrl(url)) return url;
  warnings.push(`${what}: not a platform media URL, skipped`);
  return null;
}

/** Binary download with a size cap (Content-Length first, then the body). */
async function download(
  c: Ctx,
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const r = await get(c, url, headers);
  if (!r.ok && r.status !== 206) {
    await r.body?.cancel().catch(() => {});
    return null;
  }
  const data = await readBodyLimited(r, maxBytes);
  if (!data?.length) return null;
  return { data, mimeType: (r.headers.get("content-type") ?? "").split(";")[0]?.trim() || "" };
}

async function stills(
  c: Ctx,
  urls: (string | undefined | null)[],
  headers: Record<string, string>,
  warnings: string[],
): Promise<SocialKeyframe[]> {
  const frames: SocialKeyframe[] = [];
  for (const raw of [...new Set(urls.filter((x): x is string => !!x))].slice(0, 4)) {
    const u = mediaUrl(raw, "image", warnings);
    if (!u) continue;
    try {
      const img = await download(c, u, headers, IMAGE_MAX_BYTES);
      // Type from the bytes, not the header: raster images only (an SVG stored as cover could run script).
      const size = img ? imageSize(img.data) : null;
      if (img && size) frames.push({ timeSec: 0, image: img.data, mimeType: size.type });
    } catch (err) {
      warnings.push(`image: ${errorMessage(err)}`);
    }
  }
  return frames;
}

const cookieHeader = (r: Response): string =>
  (typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [])
    .map((c) => c.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");

// --- TikTok ---------------------------------------------------------------------------------

interface TikTokItem {
  id?: string;
  desc?: string;
  createTime?: string | number;
  author?: { uniqueId?: string };
  video?: {
    duration?: number;
    playAddr?: string;
    downloadAddr?: string;
    cover?: string;
    originCover?: string;
    bitrateInfo?: Array<{ DataSize?: number | string; PlayAddr?: { UrlList?: string[] } }>;
    subtitleInfos?: Array<{ Url?: string; LanguageCodeName?: string; Format?: string }>;
  };
  imagePost?: { images?: Array<{ imageURL?: { urlList?: string[] } }> };
}

/** itemStruct of a TikTok video page, or undefined. */
export function parseTikTokPage(html: string): TikTokItem | undefined {
  const m = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) return undefined;
  try {
    const data = JSON.parse(m[1]) as {
      __DEFAULT_SCOPE__?: Record<string, { itemInfo?: { itemStruct?: TikTokItem } }>;
    };
    return data.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  } catch {
    return undefined;
  }
}

/** Subtitle track in the preferred language (German, then English, then the first). */
export function pickSubtitle(
  infos: NonNullable<TikTokItem["video"]>["subtitleInfos"],
  languages: readonly string[],
) {
  const list = (infos ?? []).filter((s) => s.Url && (!s.Format || /vtt/i.test(s.Format)));
  for (const lang of languages) {
    const hit = list.find((s) => (s.LanguageCodeName ?? "").toLowerCase().startsWith(lang));
    if (hit) return hit;
  }
  return list[0];
}

async function tiktok(c: Ctx, url: string): Promise<SocialMediaBundle> {
  const warnings: string[] = [];
  const page = await get(c, url, {
    "User-Agent": BROWSER_UA,
    "Accept-Language": acceptLanguage(),
  });
  const html = page.ok ? await readTextLimited(page, PAGE_MAX_BYTES) : "";
  const item = parseTikTokPage(html);
  const cookies = cookieHeader(page);
  const mediaHeaders = {
    "User-Agent": BROWSER_UA,
    Referer: "https://www.tiktok.com/",
    ...(cookies ? { Cookie: cookies } : {}),
  };

  if (!item?.id) {
    // Page blocked or changed: oEmbed still gives caption, author and thumbnail.
    const oe = await get(c, `${TIKTOK_OEMBED_URL}?url=${encodeURIComponent(url)}`, {
      "User-Agent": BROWSER_UA,
    });
    const o = oe.ok
      ? ((await readTextLimited(oe, TEXT_MAX_BYTES)
          .then(JSON.parse)
          .catch(() => ({}))) as {
          title?: string;
          author_unique_id?: string;
          thumbnail_url?: string;
        })
      : {};
    if (!o.title && !o.thumbnail_url)
      decline(`tiktok: no video data (page ${page.status}, oEmbed ${oe.status})`);
    return {
      platform: "tiktok",
      url: page.url || url,
      caption: o.title,
      author: o.author_unique_id,
      thumbnailUrl: o.thumbnail_url,
      keyframes: await stills(c, [o.thumbnail_url], { "User-Agent": BROWSER_UA }, warnings),
      warnings: [...warnings, "tiktok: page data unavailable, oEmbed only"],
    };
  }

  const v = item.video ?? {};
  const author = item.author?.uniqueId;
  const canonical = author ? `https://www.tiktok.com/@${author}/video/${item.id}` : page.url || url;
  const duration = v.duration ? Number(v.duration) : undefined;

  let transcript: TranscriptSegment[] | undefined;
  const sub = pickSubtitle(v.subtitleInfos, c.languages());
  const subUrl = sub?.Url ? mediaUrl(sub.Url, "subtitles", warnings) : null;
  if (subUrl) {
    try {
      const r = await get(c, subUrl, mediaHeaders);
      if (r.ok) transcript = parseCues(await readTextLimited(r, TEXT_MAX_BYTES));
    } catch (err) {
      warnings.push(`subtitles: ${errorMessage(err)}`);
    }
  }

  let audio: SocialMediaBundle["audio"];
  if (!transcript?.length && !item.imagePost) {
    if (duration && duration > c.maxAudioSec) {
      warnings.push(
        `audio: clip longer than ${Math.round(c.maxAudioSec / 60)} min, not transcribed`,
      );
    } else {
      const smallest = [...(v.bitrateInfo ?? [])]
        .filter((b) => b.PlayAddr?.UrlList?.[0])
        .sort((a, b) => Number(a.DataSize ?? Infinity) - Number(b.DataSize ?? Infinity))[0];
      const raw = smallest?.PlayAddr?.UrlList?.[0] ?? v.playAddr ?? v.downloadAddr;
      const src = raw ? mediaUrl(raw, "audio", warnings) : null;
      if (src) {
        try {
          const file = await download(c, src, mediaHeaders, c.maxVideoBytes);
          if (file)
            audio = { data: file.data, mimeType: "video/mp4", fileName: `tiktok-${item.id}.mp4` };
          else warnings.push("audio: video not downloadable or too large");
        } catch (err) {
          warnings.push(`audio: ${errorMessage(err)}`);
        }
      }
    }
  }

  const slides = (item.imagePost?.images ?? []).map((i) => i.imageURL?.urlList?.[0]);
  const keyframes = await stills(
    c,
    slides.length ? slides : [v.originCover ?? v.cover],
    mediaHeaders,
    warnings,
  );
  return {
    platform: "tiktok",
    url: canonical,
    caption: item.desc,
    author,
    postedAt: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString() : undefined,
    durationSec: duration,
    thumbnailUrl: v.originCover ?? v.cover,
    audio,
    keyframes,
    ...(transcript?.length ? { transcript, transcriptSource: "tiktok-subtitles" } : {}),
    warnings,
  };
}

// --- Instagram ------------------------------------------------------------------------------

interface InstagramMedia {
  __typename?: string;
  shortcode?: string;
  is_video?: boolean;
  video_url?: string;
  video_duration?: number;
  display_url?: string;
  taken_at_timestamp?: number;
  owner?: { username?: string };
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
  edge_sidecar_to_children?: {
    edges?: Array<{ node?: { display_url?: string; is_video?: boolean } }>;
  };
}

export const instagramShortcode = (url: string): string | undefined =>
  /instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)/.exec(url)?.[1];

/** shortcode_media from an Instagram embed page (contextJSON, a JSON string inside JS). */
export function parseInstagramEmbed(html: string): InstagramMedia | undefined {
  const m = /"contextJSON":"((?:[^"\\]|\\.)*)"/.exec(html);
  if (!m?.[1]) return undefined;
  try {
    const ctx = JSON.parse(JSON.parse(`"${m[1]}"`) as string) as {
      gql_data?: { shortcode_media?: InstagramMedia };
    };
    return ctx.gql_data?.shortcode_media;
  } catch {
    return undefined;
  }
}

async function instagram(c: Ctx, url: string): Promise<SocialMediaBundle> {
  const code = instagramShortcode(url) ?? decline("instagram: no post id in URL");
  const r = await get(c, `https://www.instagram.com/p/${code}/embed/captioned/`, {
    "User-Agent": PREVIEW_UA,
  });
  const media = r.ok ? parseInstagramEmbed(await readTextLimited(r, PAGE_MAX_BYTES)) : undefined;
  if (!media)
    decline(`instagram: post data unavailable (embed ${r.status}; private or login wall)`);
  const m = media as InstagramMedia;
  const warnings: string[] = [];
  const headers = { "User-Agent": BROWSER_UA };
  const duration = m.video_duration ? Math.round(m.video_duration) : undefined;

  let audio: SocialMediaBundle["audio"];
  const videoUrl = m.video_url ? mediaUrl(m.video_url, "audio", warnings) : null;
  if (videoUrl) {
    if (duration && duration > c.maxAudioSec) {
      warnings.push(
        `audio: clip longer than ${Math.round(c.maxAudioSec / 60)} min, not transcribed`,
      );
    } else {
      try {
        const file = await download(c, videoUrl, headers, c.maxVideoBytes);
        if (file)
          audio = { data: file.data, mimeType: "video/mp4", fileName: `instagram-${code}.mp4` };
        else warnings.push("audio: video not downloadable or too large");
      } catch (err) {
        warnings.push(`audio: ${errorMessage(err)}`);
      }
    }
  }
  const children = (m.edge_sidecar_to_children?.edges ?? []).map((e) => e.node?.display_url);
  return {
    platform: "instagram",
    url: `https://www.instagram.com/${m.__typename === "GraphVideo" ? "reel" : "p"}/${code}/`,
    caption: m.edge_media_to_caption?.edges?.[0]?.node?.text,
    author: m.owner?.username,
    postedAt: m.taken_at_timestamp
      ? new Date(m.taken_at_timestamp * 1000).toISOString()
      : undefined,
    durationSec: duration,
    thumbnailUrl: m.display_url,
    audio,
    keyframes: await stills(c, children.length ? children : [m.display_url], headers, warnings),
    warnings,
  };
}

export function createPublicSocialDownloader(
  o: PublicSocialDownloaderOptions = {},
): SocialMediaDownloader {
  const c: Ctx = {
    // Public hosts only, redirects re-checked; the TikTok cookies stay on TikTok hosts.
    fetch: createSafeFetch({
      fetch: o.fetch,
      headersFor: (u, h) => {
        if (!TIKTOK_COOKIE_HOSTS.test(u.hostname)) h.delete("cookie");
        return h;
      },
    }),
    maxVideoBytes: o.maxVideoBytes ?? 60 * 1024 * 1024,
    maxAudioSec: o.maxAudioSec ?? 600,
    languages: () => o.languages ?? contentLanguages(),
    timeoutMs: o.timeoutMs ?? 30_000,
  };
  return {
    async fetch(url: string, platform: SocialPlatform) {
      try {
        return platform === "tiktok" ? await tiktok(c, url) : await instagram(c, url);
      } catch (err) {
        if (err instanceof AdapterDeclinedError) throw err;
        // Network errors and the like: let the page clipper try instead of failing the item.
        throw new AdapterDeclinedError(ID, `${platform}: ${errorMessage(err)}`);
      }
    },
  };
}
