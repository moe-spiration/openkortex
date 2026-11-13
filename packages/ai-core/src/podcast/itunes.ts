import { defaultFetch, requestJson, type FetchLike } from "../http";
import type { PodcastFeed, PodcastIndexClient } from "./podcast-index";

/*
 * Apple's public iTunes Search/Lookup API: no key, works from servers. Finds a show's RSS feed
 * (fallback when PodcastIndex is not configured) and resolves Apple Podcasts episode URLs.
 */

export const ITUNES_API = "https://itunes.apple.com";

interface SearchResult {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
}

export function createITunesPodcastSearch(fetchFn: FetchLike = defaultFetch): PodcastIndexClient {
  return {
    async searchFeeds(term, max = 5) {
      const url = `${ITUNES_API}/search?${new URLSearchParams({ term, media: "podcast", entity: "podcast", limit: String(max) })}`;
      const r = await requestJson<{ results?: SearchResult[] }>(fetchFn, "itunes", url);
      return (r.results ?? [])
        .filter((x) => x.feedUrl)
        .map((x): PodcastFeed => ({
          id: x.collectionId ?? 0,
          title: x.collectionName ?? "",
          url: x.feedUrl!,
          author: x.artistName,
          image: x.artworkUrl600,
        }));
    },
  };
}

/** `podcasts.apple.com/<cc>/podcast/<slug>/id<show>?i=<episode>` */
export function parseApplePodcastUrl(
  url: string | undefined,
): { showId: string; episodeId?: string } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname !== "podcasts.apple.com") return undefined;
    const show = /\/id(\d+)/.exec(u.pathname)?.[1];
    if (!show) return undefined;
    const ep = u.searchParams.get("i") ?? undefined;
    return { showId: show, ...(ep ? { episodeId: ep } : {}) };
  } catch {
    return undefined;
  }
}

export interface AppleEpisode {
  show: string;
  title: string;
  description?: string;
  publishedAt?: string;
  durationSec?: number;
  audioUrl?: string;
  imageUrl?: string;
  feedUrl?: string;
}

/** Episode (or the show's latest one without `?i=`) via iTunes Lookup. */
export async function lookupAppleEpisode(
  ids: { showId: string; episodeId?: string },
  fetchFn: FetchLike = defaultFetch,
): Promise<AppleEpisode | undefined> {
  const url = `${ITUNES_API}/lookup?${new URLSearchParams({ id: ids.showId, entity: "podcastEpisode", limit: "300" })}`;
  const r = await requestJson<{
    results?: Array<{
      wrapperType?: string;
      kind?: string;
      trackId?: number;
      trackName?: string;
      collectionName?: string;
      description?: string;
      releaseDate?: string;
      trackTimeMillis?: number;
      episodeUrl?: string;
      artworkUrl600?: string;
      feedUrl?: string;
    }>;
  }>(fetchFn, "itunes", url);
  const results = r.results ?? [];
  const show = results.find((x) => x.wrapperType === "track" && x.kind === "podcast");
  const episodes = results.filter((x) => x.wrapperType === "podcastEpisode");
  const ep = ids.episodeId
    ? episodes.find((x) => String(x.trackId) === ids.episodeId)
    : episodes[0];
  if (!ep) return undefined;
  return {
    show: ep.collectionName ?? show?.collectionName ?? "",
    title: ep.trackName ?? "Episode",
    description: ep.description,
    publishedAt: ep.releaseDate,
    durationSec: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : undefined,
    audioUrl: ep.episodeUrl,
    imageUrl: ep.artworkUrl600 ?? show?.artworkUrl600,
    feedUrl: show?.feedUrl ?? ep.feedUrl,
  };
}
