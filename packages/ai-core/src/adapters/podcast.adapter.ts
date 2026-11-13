import { getLocale, ph, t } from "../i18n";
import { mergeShortSegments, parseTimedText } from "../audio/timed-text";
import type { TranscriptSegment } from "../audio/transcriber";
import type { UrlTranscriber } from "../audio/url-transcriber";
import { ExtractionError, MediaBudgetError, errorMessage } from "../errors";
import {
  BROWSER_USER_AGENT,
  defaultFetch,
  requestJson,
  requestText,
  type FetchLike,
} from "../http";
import { createSafeFetch } from "../net/safe-fetch";
import {
  clientSegments,
  clockStamp,
  generateMediaNotes,
  renderMediaNote,
  timedLines,
  type MediaNotes,
} from "../media/notes";
import {
  createITunesPodcastSearch,
  lookupAppleEpisode,
  parseApplePodcastUrl,
} from "../podcast/itunes";
import type { PodcastIndexClient } from "../podcast/podcast-index";
import { findEpisodeNear, parseRssFeed, type RssEpisode } from "../podcast/rss";
import type { ModelRouter } from "../router/model-router";
import { stripTags } from "../util/markup";
import {
  isHttpUrl,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
} from "./base-adapter";

// Podcasts (Spotify, Apple, direct audio): metadata → RSS episode (enclosure + optional publisher
// transcript) → transcript (client > publisher > speech-to-text behind a cost guard) → notes.
// No API key needed: Spotify oEmbed + embed page, Apple's iTunes Search/Lookup; PodcastIndex is
// used when configured.

const ID = "podcast";
export const SPOTIFY_OEMBED_URL = "https://open.spotify.com/oembed";
export const SPOTIFY_EMBED_URL = "https://open.spotify.com/embed/episode";

export interface TranscribeEstimate {
  /** Episode length when known (feed, Apple, Spotify), else null. */
  durationSec: number | null;
  audioUrl: string;
  title: string;
}

export interface PodcastAdapterOptions {
  fetch?: FetchLike;
  /** Finds the show's RSS feed. Default: Apple's iTunes Search (no key). */
  podcastIndex?: PodcastIndexClient;
  /** Speech-to-text by URL (Eden AI async, Deepgram, or Groq after a download). */
  transcriber?: UrlTranscriber;
  /** Writes the show notes (routed `summarize`). */
  models?: ModelRouter;
  language?: string;
  /** Runs before paid speech-to-text; throw MediaBudgetError to skip it (length cap, budget). */
  beforeTranscribe?: (estimate: TranscribeEstimate) => Promise<void>;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav)$/i;

export function parseSpotifyEpisodeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname !== "open.spotify.com") return undefined;
    return u.pathname.match(/^\/(?:intl-[a-z-]+\/)?episode\/([A-Za-z0-9]{10,})/)?.[1];
  } catch {
    return undefined;
  }
}

const isAudioUrl = (url: string | undefined) =>
  isHttpUrl(url) && AUDIO_EXT.test(new URL(url).pathname);

/** Show name from Spotify share text ("Listen to this episode from X on Spotify"). */
export function showNameFromShareText(text: string | undefined): string | undefined {
  const m = text?.match(/(?:episode from|Folge von|Episode von)\s+(.+?)\s+(?:on|auf)\s+Spotify/i);
  return m?.[1]?.trim();
}

export interface SpotifyEmbedInfo {
  title?: string;
  show?: string;
  durationSec?: number;
  publishedAt?: string;
  imageUrl?: string;
}

/** Spotify's embed page carries the episode as __NEXT_DATA__ (show name, length, date, cover). */
export function parseSpotifyEmbed(html: string): SpotifyEmbedInfo {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) return {};
  try {
    const e = (
      JSON.parse(m[1]) as {
        props?: { pageProps?: { state?: { data?: { entity?: Record<string, unknown> } } } };
      }
    ).props?.pageProps?.state?.data?.entity;
    if (!e) return {};
    const covers = (e.relatedEntityCoverArt ??
      (e.visualIdentity as { image?: unknown } | undefined)?.image ??
      []) as Array<{ url?: string; maxWidth?: number }>;
    const cover = [...covers].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))[0]?.url;
    const duration = typeof e.duration === "number" ? Math.round(e.duration / 1000) : undefined;
    return {
      title:
        typeof e.title === "string" ? e.title : typeof e.name === "string" ? e.name : undefined,
      show: typeof e.subtitle === "string" ? e.subtitle : undefined,
      durationSec: duration,
      publishedAt: (e.releaseDate as { isoString?: string } | undefined)?.isoString,
      imageUrl: cover,
    };
  } catch {
    return {};
  }
}

interface Resolved {
  provider: "spotify" | "apple" | "audio";
  show?: string;
  episodeTitle: string;
  description?: string;
  publishedAt?: string;
  durationSec?: number;
  audioUrl?: string;
  imageUrl?: string;
  feedUrl?: string;
  episode?: RssEpisode;
}

export function createPodcastAdapter(options: PodcastAdapterOptions = {}): IngestionAdapter {
  const fetchFn = options.fetch ?? defaultFetch;
  // Spoken-language hint for the transcriber: the user's language unless the caller sets one.
  const languageHint = () => options.language ?? getLocale();
  const feedSearch = options.podcastIndex ?? createITunesPodcastSearch(fetchFn);
  // Feed and transcript URLs come from third-party feeds: public hosts only.
  const safeFetch = createSafeFetch({ fetch: fetchFn });

  /** RSS episode for a show + title (+ date for shows that reuse titles). */
  async function fromFeeds(r: Resolved, warnings: string[]): Promise<Resolved> {
    const term = r.show ?? r.episodeTitle;
    try {
      const feeds = r.feedUrl
        ? [{ url: r.feedUrl, title: r.show ?? "" }]
        : await feedSearch.searchFeeds(term, 5);
      for (const feed of feeds.slice(0, 3)) {
        let xml: string;
        try {
          xml = await requestText(safeFetch, ID, feed.url, {
            headers: { "User-Agent": BROWSER_USER_AGENT },
          });
        } catch (err) {
          warnings.push(`rss ${feed.title}: ${errorMessage(err)}`);
          continue;
        }
        const rss = parseRssFeed(xml);
        const ep = findEpisodeNear(rss, r.episodeTitle, r.publishedAt);
        if (ep)
          return {
            ...r,
            show: r.show ?? (rss.title || feed.title),
            description: r.description ?? ep.description,
            publishedAt:
              r.publishedAt ?? (ep.pubDate ? new Date(ep.pubDate).toISOString() : undefined),
            durationSec: r.durationSec ?? ep.durationSec,
            audioUrl: r.audioUrl ?? ep.enclosureUrl,
            imageUrl: r.imageUrl ?? ep.image ?? rss.image,
            feedUrl: feed.url,
            episode: ep,
          };
      }
      warnings.push("rss: episode not found in candidate feeds");
    } catch (err) {
      warnings.push(`feed search: ${errorMessage(err)}`);
    }
    return r;
  }

  async function resolveSpotify(
    url: string,
    id: string,
    shareText: string | undefined,
    warnings: string[],
  ): Promise<Resolved> {
    const oembed = await requestJson<{ title?: string; thumbnail_url?: string }>(
      fetchFn,
      ID,
      `${SPOTIFY_OEMBED_URL}?url=${encodeURIComponent(url)}`,
    );
    let embed: SpotifyEmbedInfo = {};
    try {
      embed = parseSpotifyEmbed(
        await requestText(fetchFn, ID, `${SPOTIFY_EMBED_URL}/${id}`, {
          headers: { "User-Agent": BROWSER_USER_AGENT },
        }),
      );
    } catch (err) {
      warnings.push(`spotify embed: ${errorMessage(err)}`);
    }
    const episodeTitle = (oembed.title ?? embed.title)?.trim();
    if (!episodeTitle) throw new ExtractionError(ID, "Spotify returned no episode title");
    return fromFeeds(
      {
        provider: "spotify",
        episodeTitle,
        show: showNameFromShareText(shareText) ?? embed.show,
        durationSec: embed.durationSec,
        publishedAt: embed.publishedAt,
        imageUrl: embed.imageUrl ?? oembed.thumbnail_url,
      },
      warnings,
    );
  }

  async function resolveApple(
    ids: { showId: string; episodeId?: string },
    warnings: string[],
  ): Promise<Resolved> {
    const ep = await lookupAppleEpisode(ids, fetchFn);
    if (!ep) throw new ExtractionError(ID, "Apple Podcasts: episode not found");
    const r: Resolved = { provider: "apple", ...ep, episodeTitle: ep.title };
    // The feed may add a publisher transcript; the enclosure from Apple stays.
    return ep.feedUrl ? fromFeeds(r, warnings) : r;
  }

  async function loadTranscript(
    input: RawIngestInput,
    r: Resolved,
    warnings: string[],
  ): Promise<{ segments: TranscriptSegment[]; source: string; skipped?: string }> {
    const fromClient = clientSegments(input.transcript);
    if (fromClient.length)
      return { segments: fromClient, source: `client:${input.transcript!.source}` };
    for (const t of r.episode?.transcripts ?? []) {
      try {
        const segments = parseTimedText(await requestText(safeFetch, ID, t.url), t.type);
        if (segments.length > 0)
          return { segments: mergeShortSegments(segments), source: "publisher" };
      } catch (err) {
        warnings.push(`publisher transcript: ${errorMessage(err)}`);
      }
    }
    if (!r.audioUrl) return { segments: [], source: "none", skipped: "no_audio" };
    if (!options.transcriber) {
      warnings.push("no transcriber configured");
      return { segments: [], source: "none", skipped: "no_transcriber" };
    }
    try {
      await options.beforeTranscribe?.({
        durationSec: r.durationSec ?? input.media?.duration_sec ?? null,
        audioUrl: r.audioUrl,
        title: r.episodeTitle,
      });
    } catch (err) {
      if (err instanceof MediaBudgetError)
        return { segments: [], source: "none", skipped: err.message };
      throw err;
    }
    try {
      const segments = await options.transcriber.transcribeUrl(r.audioUrl, { language: languageHint() });
      return { segments: mergeShortSegments(segments), source: options.transcriber.id };
    } catch (err) {
      warnings.push(`transcription: ${errorMessage(err)}`);
      return { segments: [], source: "none", skipped: "transcription_failed" };
    }
  }

  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      !input.fileBuffer &&
      (parseSpotifyEpisodeUrl(input.url) !== undefined ||
        parseApplePodcastUrl(input.url) !== undefined ||
        isAudioUrl(input.url)),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const url = input.url as string;
      const warnings: string[] = [];
      const spotifyId = parseSpotifyEpisodeUrl(url);
      const apple = parseApplePodcastUrl(url);
      const resolved: Resolved = spotifyId
        ? await resolveSpotify(url, spotifyId, input.rawText, warnings)
        : apple
          ? await resolveApple(apple, warnings)
          : {
              provider: "audio",
              episodeTitle: decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "Episode")
                .replace(AUDIO_EXT, "")
                .replace(/[_-]+/g, " "),
              audioUrl: url,
            };

      const { segments, source, skipped } = await loadTranscript(input, resolved, warnings);
      const description = resolved.description ? stripTags(resolved.description) : undefined;
      const lines = timedLines(segments);
      const notes: MediaNotes | null = options.models
        ? await generateMediaNotes(
            options.models,
            {
              kind: "podcast",
              title: resolved.episodeTitle,
              channel: resolved.show,
              description,
              lines,
            },
            warnings,
          )
        : null;

      const duration = resolved.durationSec ?? input.media?.duration_sec ?? segments.at(-1)?.endSec;
      const link =
        resolved.provider === "spotify"
          ? `[${ph("openOnSpotify")}](${url})`
          : resolved.provider === "apple"
            ? `[${ph("openInApplePodcasts")}](${url})`
            : `[Audio](${url})`;
      const notice = segments.length
        ? undefined
        : skipped && !["no_audio", "no_transcriber", "transcription_failed"].includes(skipped)
          ? t("No transcript: {reason}", { reason: skipped })
          : skipped === "no_audio"
            ? t("No transcript: The episode's audio file was not found.")
            : undefined;
      const audio = resolved.audioUrl;
      const rendered = renderMediaNote({
        title: resolved.episodeTitle,
        facts: [
          "Podcast",
          resolved.show ?? null,
          resolved.publishedAt ? resolved.publishedAt.slice(0, 10) : null,
          duration ? clockStamp(duration) : null,
          link,
        ].filter((x): x is string => !!x),
        // Media fragments let the browser jump inside the episode's audio file.
        jump: (sec) => (audio ? `${audio}#t=${Math.floor(sec)}` : null),
        notes,
        description,
        segments,
        notice,
      });

      return {
        type: "podcast",
        sourcePlatform: resolved.provider,
        titleHint: resolved.episodeTitle,
        contentMd: rendered.contentMd,
        coverImageUrl: resolved.imageUrl,
        sourceUrl: url,
        structuralChunks: rendered.chunks,
        metadata: {
          spotify_episode_id: spotifyId ?? null,
          apple_episode_id: apple?.episodeId ?? null,
          show: resolved.show ?? null,
          published_at: resolved.publishedAt ?? null,
          duration_sec: duration ? Math.round(duration) : null,
          audio_url: resolved.audioUrl ?? null,
          feed_url: resolved.feedUrl ?? null,
          transcript_source: source,
          transcript_missing: segments.length ? null : (skipped ?? "none"),
          chapters: rendered.chapters,
          key_takeaways: notes?.key_takeaways ?? [],
          learnings: notes?.learnings ?? [],
          quotes: notes?.quotes ?? [],
          resources: notes?.resources ?? [],
          warnings: warnings.length ? warnings : undefined,
        },
      };
    },
  };
}
