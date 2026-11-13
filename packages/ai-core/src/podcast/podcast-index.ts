import { createHash } from "node:crypto";
import { defaultFetch, requestJson, type FetchLike } from "../http";

// PodcastIndex.org: free, open podcast directory. Used to find a show's RSS feed.
// Auth: X-Auth-Key, X-Auth-Date (unix seconds), Authorization = sha1(key + secret + date).

export const PODCASTINDEX_API = "https://api.podcastindex.org/api/1.0";

export interface PodcastFeed {
  id: number;
  title: string;
  /** RSS feed URL. */
  url: string;
  author?: string;
  image?: string;
}

export interface PodcastIndexClient {
  searchFeeds(term: string, max?: number): Promise<PodcastFeed[]>;
}

interface SearchResponse {
  status?: string | boolean;
  feeds?: Array<{
    id: number;
    title?: string;
    url?: string;
    author?: string;
    image?: string;
    artwork?: string;
  }>;
}

export function podcastIndexHeaders(
  apiKey: string,
  apiSecret: string,
  now: Date,
): Record<string, string> {
  const date = String(Math.floor(now.getTime() / 1000));
  return {
    "User-Agent": "Kortex/0.1",
    "X-Auth-Key": apiKey,
    "X-Auth-Date": date,
    Authorization: createHash("sha1")
      .update(apiKey + apiSecret + date)
      .digest("hex"),
  };
}

export function createPodcastIndexClient(options: {
  apiKey: string;
  apiSecret: string;
  fetch?: FetchLike;
  now?: () => Date;
}): PodcastIndexClient {
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    async searchFeeds(term, max = 5) {
      const q = new URLSearchParams({ q: term, max: String(max) });
      const res = await requestJson<SearchResponse>(
        fetchFn,
        "podcastindex",
        `${PODCASTINDEX_API}/search/byterm?${q}`,
        {
          headers: podcastIndexHeaders(
            options.apiKey,
            options.apiSecret,
            options.now?.() ?? new Date(),
          ),
        },
      );
      return (res.feeds ?? [])
        .filter((f) => f.url)
        .map((f) => ({
          id: f.id,
          title: f.title ?? "",
          url: f.url as string,
          author: f.author,
          image: f.image || f.artwork,
        }));
    },
  };
}
