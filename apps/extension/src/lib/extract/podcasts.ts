import { hasType, isoDate, isoDurationSec, jsonLd, meta, text } from "./dom";
import type { Extracted, Extractor, ExtractContext } from "./types";

/* Spotify (episode/show/track) and Apple Podcasts: artwork, show name, duration and date from the
   page metadata. The audio itself is never read here. */

const secondsOf = (v: string | null): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

export const spotify: Extractor = {
  id: "spotify",
  matches: (url) => url.hostname === "open.spotify.com" && /^\/(?:intl-[a-z-]+\/)?(episode|show|track)\//.test(url.pathname),
  extract({ doc, url }: ExtractContext): Extracted {
    const kindOf = /\/(episode|show|track)\//.exec(new URL(url).pathname)?.[1];
    const description = meta(doc, "og:description", "description") ?? "";
    // "The Joe Rogan Experience · Episode" (current pages) or "Listen to this episode from X on Spotify."
    const show = (
      /^(.+?)\s+·\s+(?:Episode|Folge|Podcast|Show|Sendung)\b/i.exec(description)?.[1] ??
      /\b(?:from|von|de|du|di)\s+(.+?)\s+(?:on|auf|sur|su|en)\s+Spotify/i.exec(description)?.[1]
    )?.trim();
    const duration = secondsOf(meta(doc, "music:duration"));
    const published = isoDate(meta(doc, "music:release_date"));
    const channel = show ?? (kindOf === "show" ? text(doc.querySelector("h1")) : "");
    return {
      site_name: "Spotify",
      images: [meta(doc, "og:image") ?? ""].filter(Boolean),
      media: {
        kind: kindOf === "track" ? "audio" : "podcast",
        provider: "spotify",
        ...(duration ? { duration_sec: duration } : {}),
        ...(channel ? { channel } : {}),
        ...(published ? { published_at: published } : {}),
      },
    };
  },
};

export const applePodcasts: Extractor = {
  id: "apple-podcasts",
  matches: (url) => url.hostname === "podcasts.apple.com",
  extract({ doc }: ExtractContext): Extracted {
    const node = jsonLd(doc).find((n) => hasType(n, "PodcastEpisode", "PodcastSeries", "AudioObject"));
    const series = node?.partOfSeries as { name?: string } | undefined;
    const author = node?.author as { name?: string } | string | undefined;
    const channel = series?.name ?? (typeof author === "string" ? author : author?.name) ?? undefined;
    const duration = isoDurationSec(node?.timeRequired ?? node?.duration);
    const published = isoDate(node?.datePublished);
    const images = [meta(doc, "og:image"), typeof node?.image === "string" ? node.image : null].filter((v): v is string => !!v);
    return {
      site_name: "Apple Podcasts",
      images,
      ...(node && typeof node.name === "string" ? { title: node.name } : {}),
      media: {
        kind: "podcast",
        provider: "apple",
        ...(duration ? { duration_sec: duration } : {}),
        ...(channel ? { channel } : {}),
        ...(published ? { published_at: published } : {}),
      },
    };
  },
};
