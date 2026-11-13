import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDefaultRegistry } from "../src/adapters";
import {
  createPodcastAdapter,
  parseSpotifyEpisodeUrl,
  showNameFromShareText,
  SPOTIFY_OEMBED_URL,
} from "../src/adapters/podcast.adapter";
import { mergeShortSegments, parseCues, parsePodcastJson } from "../src/audio/timed-text";
import type { AudioTranscriber } from "../src/audio/transcriber";
import {
  createDeepgramUrlTranscriber,
  DEEPGRAM_LISTEN_URL,
  downloadThenTranscribe,
  type UrlTranscriber,
} from "../src/audio/url-transcriber";
import {
  createPodcastIndexClient,
  PODCASTINDEX_API,
  type PodcastIndexClient,
} from "../src/podcast/podcast-index";
import { findEpisode, parseDuration, parseRssFeed, titleSimilarity } from "../src/podcast/rss";
import { createMemoryStorageGateway } from "../src/storage";
import { MediaBudgetError } from "../src/errors";
import { fakeFetch, json, mockModel, staticRouter, USER_ID } from "./helpers";
import {
  AUDIO_URL,
  FEED_URL,
  oembed,
  rssFeed,
  showNotes,
  SPOTIFY_URL,
  vtt,
  VTT_URL,
} from "./fixtures/podcast";

const text = (body: string, type = "text/plain") =>
  new Response(body, { status: 200, headers: { "content-type": type } });

const podcastIndex = (): PodcastIndexClient & { searchFeeds: ReturnType<typeof vi.fn> } => ({
  searchFeeds: vi.fn(async () => [
    { id: 1, title: "Falscher Podcast", url: "https://feeds.example.com/other.xml" },
    { id: 2, title: "Kortex Cast", url: FEED_URL },
  ]),
});

function network(options: { vtt?: boolean } = {}) {
  return fakeFetch([
    { match: (u) => u.startsWith(SPOTIFY_OEMBED_URL), respond: () => json(oembed) },
    {
      match: (u) => u === "https://feeds.example.com/other.xml",
      respond: () =>
        text("<rss><channel><title>Other</title></channel></rss>", "application/rss+xml"),
    },
    {
      match: (u) => u === FEED_URL,
      respond: () =>
        text(
          options.vtt === false ? rssFeed.replace(/<podcast:transcript[^>]*\/>/g, "") : rssFeed,
          "application/rss+xml",
        ),
    },
    { match: (u) => u === VTT_URL, respond: () => text(vtt, "text/vtt") },
  ]);
}

describe("podcast helpers", () => {
  it("parses Spotify episode URLs and share texts", () => {
    expect(parseSpotifyEpisodeUrl(SPOTIFY_URL)).toBe("4rOoJ6Egrf8K2IrywzwOMk");
    expect(
      parseSpotifyEpisodeUrl("https://open.spotify.com/intl-de/episode/4rOoJ6Egrf8K2IrywzwOMk"),
    ).toBe("4rOoJ6Egrf8K2IrywzwOMk");
    expect(parseSpotifyEpisodeUrl("https://open.spotify.com/show/abc1234567")).toBeUndefined();
    expect(
      showNameFromShareText("Listen to this episode from Kortex Cast on Spotify: https://…"),
    ).toBe("Kortex Cast");
    expect(showNameFromShareText("Hör dir diese Folge von Kortex Cast auf Spotify an")).toBe(
      "Kortex Cast",
    );
  });

  it("parses RSS with CDATA, itunes:duration and podcast:transcript (best format first)", () => {
    const feed = parseRssFeed(rssFeed);
    expect(feed).toMatchObject({
      title: "Kortex Cast",
      author: "Max & Sven",
      image: "https://cdn.example.com/show.jpg",
    });
    const ep = feed.episodes[1];
    expect(ep).toMatchObject({
      title: "#42 – Second Brains mit MCP",
      guid: "ep-42",
      durationSec: 3723,
      enclosureUrl: AUDIO_URL,
      description: "Wir sprechen über MCP und Second Brains.",
    });
    expect(ep?.transcripts.map((t) => t.type)).toEqual(["text/vtt", "text/html"]);
    expect(parseDuration("3723")).toBe(3723);
    expect(parseDuration("62:03")).toBe(3723);
  });

  it("matches episode titles fuzzily", () => {
    expect(titleSimilarity("#42 – Second Brains mit MCP", "42: Second Brains mit MCP")).toBe(1);
    expect(titleSimilarity("Second Brains mit MCP", "Etwas ganz anderes")).toBe(0);
    expect(findEpisode(parseRssFeed(rssFeed), "Second Brains mit MCP (Folge 42)")?.guid).toBe(
      "ep-42",
    );
    expect(findEpisode(parseRssFeed(rssFeed), "Kochen mit Thermomix")).toBeUndefined();
  });

  it("parses VTT, SRT and Podcasting 2.0 JSON transcripts", () => {
    expect(parseCues(vtt)).toEqual([
      { startSec: 0, endSec: 4.5, text: "Willkommen zu Folge 42.", speaker: "Max" },
      { startSec: 4.5, endSec: 9, text: "Heute geht es um MCP.", speaker: "Max" },
      {
        startSec: 750,
        endSec: 756,
        text: "Ein Second Brain ohne Agenten-Zugriff ist nur ein Archiv.",
        speaker: "Sven",
      },
    ]);
    expect(parseCues("1\n00:00:01,000 --> 00:00:02,500\nSven: Hallo\n")).toEqual([
      { startSec: 1, endSec: 2.5, text: "Hallo", speaker: "Sven" },
    ]);
    expect(
      parsePodcastJson('{"segments":[{"startTime":1.5,"endTime":2,"speaker":"Max","body":"Hi"}]}'),
    ).toEqual([{ startSec: 1.5, endSec: 2, text: "Hi", speaker: "Max" }]);
    expect(mergeShortSegments(parseCues(vtt)).map((s) => s.text)).toEqual([
      "Willkommen zu Folge 42. Heute geht es um MCP.",
      "Ein Second Brain ohne Agenten-Zugriff ist nur ein Archiv.",
    ]);
  });
});

describe("podcast adapter", () => {
  it("Spotify → oEmbed → PodcastIndex → RSS → publisher transcript → show notes with quotes", async () => {
    const fetch = network();
    const pi = podcastIndex();
    const transcriber: UrlTranscriber = { id: "deepgram", transcribeUrl: vi.fn() };
    const fast = mockModel(showNotes);
    const adapter = createPodcastAdapter({
      fetch,
      podcastIndex: pi,
      transcriber,
      models: staticRouter({ fast }),
    });
    const input = {
      userId: USER_ID,
      url: SPOTIFY_URL,
      rawText: "Listen to this episode from Kortex Cast on Spotify",
    };
    expect(adapter.canHandle(input)).toBe(true);
    const out = await adapter.extract(input);

    expect(fetch.calls[0]?.url).toBe(
      `${SPOTIFY_OEMBED_URL}?url=${encodeURIComponent(SPOTIFY_URL)}`,
    );
    expect(pi.searchFeeds).toHaveBeenCalledWith("Kortex Cast", 5);
    expect(transcriber.transcribeUrl).not.toHaveBeenCalled(); // the free publisher transcript was used

    expect(out).toMatchObject({
      type: "podcast",
      sourcePlatform: "spotify",
      titleHint: "#42 – Second Brains mit MCP",
      coverImageUrl: "https://i.scdn.co/image/ep42.jpg",
    });
    const md = out.contentMd;
    // Jump links into the episode's audio file (media fragment).
    const at = (sec: number) => `(${AUDIO_URL}#t=${sec})`;
    expect(md).toMatch(
      /^# #42 – Second Brains mit MCP\n\n> Podcast · Kortex Cast · 2026-10-21 · 1:02:03 · \[Auf Spotify öffnen\]/,
    );
    expect(md).toContain("## Executive Summary\n\nMax und Sven besprechen");
    expect(md).toContain(
      `## Kapitel\n\n- [0:00]${at(0)} Intro\n- [12:30]${at(750)} Agenten-Zugriff`,
    );
    expect(md).toContain(
      "## Kernpunkte\n\n- MCP standardisiert Tool-Zugriff.\n\n## Learnings\n\n- Agenten über MCP an das eigene Wissen anbinden.",
    );
    expect(md).toContain(
      `> „Ein Second Brain ohne Agenten-Zugriff ist nur ein Archiv.“ — Sven [12:30]${at(750)}`,
    );
    // With model notes the show-notes description is not repeated in the note.
    expect(md).not.toContain("## Beschreibung");
    expect(md).toContain(`> [0:00]${at(0)} Max: Willkommen zu Folge 42. Heute geht es um MCP.`);
    expect(out.structuralChunks?.map((c) => [c.heading, c.pageOrTimestamp])).toEqual([
      ["Executive Summary", undefined],
      ["Beschreibung", undefined],
      ["Intro", "00:00:00"],
      ["Agenten-Zugriff", "00:12:30"],
    ]);
    expect(out.metadata).toMatchObject({
      show: "Kortex Cast",
      audio_url: AUDIO_URL,
      feed_url: FEED_URL,
      transcript_source: "publisher",
      duration_sec: 3723,
      spotify_episode_id: "4rOoJ6Egrf8K2IrywzwOMk",
    });
    // The model saw the transcript with timestamps and speakers.
    expect(JSON.stringify(fast.doGenerateCalls[0]?.prompt)).toContain(
      "[12:30] Sven: Ein Second Brain",
    );
  });

  it("transcribes the RSS enclosure when the feed has no transcript", async () => {
    const transcriber: UrlTranscriber = {
      id: "deepgram",
      transcribeUrl: vi.fn(async () => [{ startSec: 3, text: "Hallo.", speaker: "Sprecher 1" }]),
    };
    const out = await createPodcastAdapter({
      fetch: network({ vtt: false }),
      podcastIndex: podcastIndex(),
      transcriber,
      language: "de",
    }).extract({
      userId: USER_ID,
      url: SPOTIFY_URL,
    });
    expect(transcriber.transcribeUrl).toHaveBeenCalledWith(AUDIO_URL, { language: "de" });
    expect(out.metadata.transcript_source).toBe("deepgram");
    expect(out.contentMd).toContain(`[0:03](${AUDIO_URL}#t=3) Sprecher 1: Hallo.`);
  });

  it("degrades to Spotify metadata when no feed is found, and never invents quotes", async () => {
    const fast = mockModel(showNotes);
    const out = await createPodcastAdapter({
      fetch: network(),
      podcastIndex: { searchFeeds: async () => [] },
      models: staticRouter({ fast }),
    }).extract({ userId: USER_ID, url: SPOTIFY_URL });
    expect(out.titleHint).toBe("#42 – Second Brains mit MCP");
    expect(out.contentMd).toContain(
      "> Kein Transkript: Die Audiodatei der Episode wurde nicht gefunden.",
    );
    expect(out.contentMd).not.toContain("## Zitate");
    expect(out.metadata).toMatchObject({
      transcript_source: "none",
      transcript_missing: "no_audio",
      quotes: [],
      warnings: expect.arrayContaining(["rss: episode not found in candidate feeds"]),
    });
  });

  it("without PodcastIndex keys it finds the feed via Apple's iTunes Search", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.startsWith(SPOTIFY_OEMBED_URL), respond: () => json(oembed) },
      {
        match: (u) => u.startsWith("https://itunes.apple.com/search"),
        respond: () =>
          json({
            results: [{ collectionId: 7, collectionName: "Kortex Cast", feedUrl: FEED_URL }],
          }),
      },
      { match: (u) => u === FEED_URL, respond: () => text(rssFeed, "application/rss+xml") },
      { match: (u) => u === VTT_URL, respond: () => text(vtt, "text/vtt") },
    ]);
    const out = await createPodcastAdapter({ fetch }).extract({
      userId: USER_ID,
      url: SPOTIFY_URL,
      rawText: "Listen to this episode from Kortex Cast on Spotify",
    });
    expect(
      fetch.calls.find((c) => c.url.startsWith("https://itunes.apple.com/search"))?.url,
    ).toContain("term=Kortex+Cast");
    expect(out.metadata).toMatchObject({
      feed_url: FEED_URL,
      audio_url: AUDIO_URL,
      transcript_source: "publisher",
    });
  });

  it("skips paid speech-to-text when the cost guard refuses, and says why", async () => {
    const transcriber: UrlTranscriber = { id: "edenai:assembly", transcribeUrl: vi.fn() };
    const guard = vi.fn(async () => {
      throw new MediaBudgetError(
        "Episode ist 62 Minuten lang, erlaubt sind 30 Minuten pro Eintrag.",
      );
    });
    const out = await createPodcastAdapter({
      fetch: network({ vtt: false }),
      podcastIndex: podcastIndex(),
      transcriber,
      beforeTranscribe: guard,
    }).extract({ userId: USER_ID, url: SPOTIFY_URL });
    expect(guard).toHaveBeenCalledWith({
      durationSec: 3723,
      audioUrl: AUDIO_URL,
      title: "#42 – Second Brains mit MCP",
    });
    expect(transcriber.transcribeUrl).not.toHaveBeenCalled();
    expect(out.contentMd).toContain(
      "> Kein Transkript: Episode ist 62 Minuten lang, erlaubt sind 30 Minuten pro Eintrag.",
    );
  });

  it("resolves Apple Podcasts episode URLs via iTunes Lookup", async () => {
    const transcriber: UrlTranscriber = {
      id: "edenai:assembly",
      transcribeUrl: vi.fn(async () => [{ startSec: 0, text: "Hallo." }]),
    };
    const fetch = fakeFetch([
      {
        match: (u) => u.startsWith("https://itunes.apple.com/lookup"),
        respond: () =>
          json({
            results: [
              {
                wrapperType: "track",
                kind: "podcast",
                collectionName: "Kortex Cast",
                artworkUrl600: "https://img/600.jpg",
              },
              {
                wrapperType: "podcastEpisode",
                trackId: 1000,
                trackName: "Folge 9",
                collectionName: "Kortex Cast",
                releaseDate: "2026-10-20T05:00:00Z",
                trackTimeMillis: 600_000,
                episodeUrl: "https://cdn.example.com/f9.mp3",
              },
            ],
          }),
      },
    ]);
    const adapter = createPodcastAdapter({ fetch, transcriber });
    const input = {
      userId: USER_ID,
      url: "https://podcasts.apple.com/de/podcast/kortex-cast/id123?i=1000",
    };
    expect(adapter.canHandle(input)).toBe(true);
    const out = await adapter.extract(input);
    expect(out).toMatchObject({
      sourcePlatform: "apple",
      titleHint: "Folge 9",
      coverImageUrl: "https://img/600.jpg",
    });
    expect(transcriber.transcribeUrl).toHaveBeenCalledWith("https://cdn.example.com/f9.mp3", {
      language: "de",
    });
    expect(out.metadata).toMatchObject({
      show: "Kortex Cast",
      duration_sec: 600,
      apple_episode_id: "1000",
    });
  });

  it("handles direct audio URLs", async () => {
    const transcriber: UrlTranscriber = {
      id: "groq-whisper",
      transcribeUrl: vi.fn(async () => [{ startSec: 0, text: "Intro." }]),
    };
    const adapter = createPodcastAdapter({ fetch: fakeFetch([]), transcriber });
    const input = { userId: USER_ID, url: "https://cdn.example.com/Folge_7-Recap.mp3" };
    expect(adapter.canHandle(input)).toBe(true);
    const out = await adapter.extract(input);
    expect(out).toMatchObject({ sourcePlatform: "audio", titleHint: "Folge 7 Recap" });
    expect(transcriber.transcribeUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/Folge_7-Recap.mp3",
      { language: "de" },
    );
  });

  it("is routed before the article adapter", () => {
    const registry = createDefaultRegistry({
      storage: createMemoryStorageGateway(),
      models: staticRouter({}),
    });
    expect(registry.resolve({ userId: USER_ID, url: SPOTIFY_URL })?.id).toBe("podcast");
    expect(
      registry.resolve({ userId: USER_ID, url: "https://open.spotify.com/track/abc1234567" })?.id,
    ).toBe("web-article");
  });
});

describe("podcast HTTP clients", () => {
  it("signs PodcastIndex requests with sha1(key + secret + date)", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u.startsWith(PODCASTINDEX_API),
        respond: () =>
          json({
            status: "true",
            feeds: [
              { id: 2, title: "Kortex Cast", url: FEED_URL, artwork: "a.jpg" },
              { id: 3, title: "kein feed" },
            ],
          }),
      },
    ]);
    const client = createPodcastIndexClient({
      apiKey: "KEY",
      apiSecret: "SECRET",
      fetch,
      now: () => new Date("2026-10-23T08:00:00Z"),
    });
    expect(await client.searchFeeds("Kortex Cast")).toEqual([
      { id: 2, title: "Kortex Cast", url: FEED_URL, author: undefined, image: "a.jpg" },
    ]);
    const call = fetch.calls[0];
    expect(call?.url).toBe(`${PODCASTINDEX_API}/search/byterm?q=Kortex+Cast&max=5`);
    const date = String(Date.parse("2026-10-23T08:00:00Z") / 1000);
    expect(call?.headers).toMatchObject({
      "x-auth-key": "KEY",
      "x-auth-date": date,
      authorization: createHash("sha1").update(`KEYSECRET${date}`).digest("hex"),
    });
  });

  it("asks Deepgram to fetch the URL itself and maps diarized utterances", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u.startsWith(DEEPGRAM_LISTEN_URL),
        respond: () =>
          json({
            results: { utterances: [{ start: 1, end: 2, transcript: " Hallo ", speaker: 0 }] },
          }),
      },
    ]);
    const segs = await createDeepgramUrlTranscriber({ apiKey: "dg", fetch }).transcribeUrl(
      AUDIO_URL,
    );
    expect(segs).toEqual([{ startSec: 1, endSec: 2, text: "Hallo", speaker: "Sprecher 1" }]);
    const call = fetch.calls[0];
    // No model id in code: Deepgram's account default unless DEEPGRAM_MODEL is set.
    expect(call?.url).not.toContain("model=");
    expect(call?.url).toContain("diarize=true");
    expect(call?.url).toContain("language=de");
    expect(call?.headers.authorization).toBe("Token dg");
    expect(call?.body).toEqual({ url: AUDIO_URL });
  });

  it("downloads for byte-based transcribers and enforces the size limit", async () => {
    const whisper: AudioTranscriber = {
      id: "groq-whisper",
      transcribe: vi.fn(async () => [{ startSec: 0, text: "ok" }]),
    };
    const small = fakeFetch([
      {
        match: () => true,
        respond: () =>
          new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
      },
    ]);
    expect(
      await downloadThenTranscribe(whisper, { fetch: small }).transcribeUrl(AUDIO_URL, {
        language: "de",
      }),
    ).toEqual([{ startSec: 0, text: "ok" }]);
    expect(whisper.transcribe).toHaveBeenCalledWith(
      { data: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg", fileName: "ep42.mp3" },
      { language: "de" },
    );

    const big = fakeFetch([
      {
        match: () => true,
        respond: () =>
          new Response(new Uint8Array(10), {
            headers: { "content-length": String(30 * 1024 * 1024) },
          }),
      },
    ]);
    await expect(
      downloadThenTranscribe(whisper, { fetch: big }).transcribeUrl(AUDIO_URL),
    ).rejects.toThrow(/limit is 26 MB/);
  });
});

describe("createIngestionPipeline env wiring", () => {
  it("uses DEEPGRAM_API_KEY for podcast transcription, and every OpenRouter call stays deny", async () => {
    const { createIngestionPipeline } = await import("../src/pipeline/ingest");
    const completion = (content: string) =>
      json({
        id: "gen",
        object: "chat.completion",
        created: 1,
        model: "fx/text",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const organizer = {
      title: "Folge 7",
      summary: "Recap.",
      cluster_name: null,
      suggested_folder_path: null,
      tags: [],
      entities: [],
      action_items: [],
    };
    let chatCalls = 0;
    const fetch = fakeFetch([
      {
        match: (u) => u.startsWith(DEEPGRAM_LISTEN_URL),
        respond: () =>
          json({
            results: {
              utterances: [{ start: 0, end: 2, transcript: "Willkommen zum Recap.", speaker: 0 }],
            },
          }),
      },
      {
        match: (u) => u === "https://openrouter.ai/api/v1/chat/completions",
        respond: () => completion(JSON.stringify(chatCalls++ === 0 ? showNotes : organizer)),
      },
      {
        match: (u) => u === "https://openrouter.ai/api/v1/embeddings",
        respond: (_u, init) =>
          json({
            object: "list",
            model: "fx/emb",
            data: (JSON.parse(String(init?.body)) as { input: string[] }).input.map((_, index) => ({
              object: "embedding",
              index,
              embedding: new Array(1536).fill(0.1),
            })),
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
      },
    ]);
    const pipeline = createIngestionPipeline({
      storage: createMemoryStorageGateway(),
      env: { OPENROUTER_API_KEY: "sk-or-test", DEEPGRAM_API_KEY: "dg-test" },
      routing: {
        summarize: { provider: "openrouter", model_id: "fx/text" },
        auto_organize: { provider: "openrouter", model_id: "fx/text" },
        embeddings: { provider: "openrouter", model_id: "fx/emb", dimensions: 1536 },
      },
      fetch,
    });
    const res = await pipeline.ingest(
      { userId: USER_ID, url: "https://cdn.example.com/folge7.mp3" },
      { existingTags: [], existingClusters: [], existingObjects: [] },
    );
    expect(res.adapterId).toBe("podcast");
    expect(res.item.type).toBe("podcast");
    expect(res.item.content_md).toContain(
      "[0:00](https://cdn.example.com/folge7.mp3#t=0) Sprecher 1: Willkommen zum Recap.",
    );
    const dg = fetch.calls.find((c) => c.url.startsWith(DEEPGRAM_LISTEN_URL));
    expect(dg?.headers.authorization).toBe("Token dg-test");
    const openrouter = fetch.calls.filter((c) => c.url.startsWith("https://openrouter.ai/"));
    expect(openrouter.length).toBeGreaterThanOrEqual(3);
    for (const c of openrouter)
      expect((c.body as { provider: { data_collection: string } }).provider.data_collection).toBe(
        "deny",
      );
  });
});
