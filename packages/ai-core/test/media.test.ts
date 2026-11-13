import { describe, expect, it } from "vitest";
import { createClientMediaAdapter } from "../src/adapters/client-media.adapter";
import { parseSpotifyEmbed } from "../src/adapters/podcast.adapter";
import {
  amazonAsin,
  fetchCover,
  imageSize,
  isGenericImage,
  pageCoverCandidates,
  resolveCover,
  storeCover,
} from "../src/media/cover";
import { clientSegments, groupLines, sampleLines } from "../src/media/notes";
import { parseApplePodcastUrl } from "../src/podcast/itunes";
import { findEpisodeNear } from "../src/podcast/rss";
import { createMemoryStorageGateway } from "../src/storage";
import { fakeFetch, mockModel, staticRouter, USER_ID } from "./helpers";

/** A minimal PNG header of the given size (enough for imageSize; padded past the 800-byte floor). */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(1200);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}
const img = (bytes: Uint8Array, type = "image/png") =>
  new Response(bytes, { status: 200, headers: { "content-type": type } });

describe("covers", () => {
  it("reads image sizes from PNG, JPEG and WebP headers", () => {
    expect(imageSize(png(1280, 720))).toEqual({ width: 1280, height: 720, type: "image/png" });
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 480, type: "image/jpeg" });
    const webp = new Uint8Array(40);
    webp.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8X")]);
    webp.set([0x7f, 0x02, 0x00, 0x67, 0x01, 0x00], 24); // 640 × 360
    expect(imageSize(webp)).toEqual({ width: 640, height: 360, type: "image/webp" });
  });

  it("rejects tracking pixels, non-images and errors", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.endsWith("/pixel.png"), respond: () => img(png(1, 1)) },
      {
        match: (u) => u.endsWith("/page.html"),
        respond: () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      },
      { match: (u) => u.endsWith("/404.jpg"), respond: () => new Response("", { status: 404 }) },
      { match: (u) => u.endsWith("/ok.png"), respond: () => img(png(800, 600)) },
    ]);
    expect(await fetchCover("https://x.test/pixel.png", fetch)).toBeNull();
    expect(await fetchCover("https://x.test/page.html", fetch)).toBeNull();
    expect(await fetchCover("https://x.test/404.jpg", fetch)).toBeNull();
    expect(await fetchCover("https://x.test/ok.png", fetch)).toMatchObject({
      width: 800,
      height: 600,
      ext: "png",
    });
  });

  it("finds page candidates: Amazon hi-res, JSON-LD, og:image, twitter:image", () => {
    const html = `<html><head>
      <meta property="og:image" content="/og.jpg"><meta name="twitter:image" content="https://cdn.test/tw.jpg">
      <script type="application/ld+json">{"@graph":[{"@type":"Product","image":["https://cdn.test/ld.jpg"]}]}</script>
      </head><body><img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/81hires.jpg"
      data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/small.jpg&quot;:[200,200],&quot;https://m.media-amazon.com/images/I/big.jpg&quot;:[1500,1500]}"></body></html>`;
    expect(pageCoverCandidates(html, "https://shop.test/p/1")).toEqual([
      "https://m.media-amazon.com/images/I/81hires.jpg",
      "https://m.media-amazon.com/images/I/big.jpg",
      "https://cdn.test/ld.jpg",
      "https://shop.test/og.jpg",
      "https://cdn.test/tw.jpg",
    ]);
    expect(amazonAsin("https://www.amazon.de/Some-Book/dp/3446264825/ref=sr_1_1")).toBe(
      "3446264825",
    );
    expect(amazonAsin("https://example.com/dp/3446264825")).toBeUndefined();
  });

  it("YouTube: maxres missing → next thumbnail; stored in kortex-media", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u.includes("maxresdefault"),
        respond: () => new Response("", { status: 404 }),
      },
      { match: (u) => u.includes("sddefault"), respond: () => img(png(640, 480)) },
    ]);
    const { cover } = await resolveCover({
      url: "https://www.youtube.com/watch?v=abcDEF12345",
      candidates: [],
      fetch,
    });
    expect(cover?.sourceUrl).toBe("https://i.ytimg.com/vi/abcDEF12345/sddefault.jpg");
    const storage = createMemoryStorageGateway();
    const stored = await storeCover(storage, USER_ID, "item-1", cover!);
    expect(stored.path).toBe(`${USER_ID}/covers/item-1.png`);
  });

  it("Amazon bot page: skips the generic share logo and uses the ASIN image", async () => {
    const logo = "https://m.media-amazon.com/images/G/01/share-icons/previewdoh/amazon.png";
    const fetch = fakeFetch([
      {
        match: (u) => u.startsWith("https://www.amazon.de/"),
        respond: () =>
          new Response(`<meta property="og:image" content="${logo}">`, {
            headers: { "content-type": "text/html" },
          }),
      },
      { match: (u) => u.includes("/images/P/1847941834.01"), respond: () => img(png(500, 760)) },
    ]);
    const { cover } = await resolveCover({
      url: "https://www.amazon.de/dp/1847941834",
      candidates: [logo],
      fetch,
    });
    expect(cover?.sourceUrl).toBe(
      "https://images-na.ssl-images-amazon.com/images/P/1847941834.01.LZZZZZZZ.jpg",
    );
    expect(fetch.calls.some((c) => c.url === logo)).toBe(false);
    expect(isGenericImage("https://i.ytimg.com/vi/abc/hqdefault.jpg")).toBe(false);
  });

  it("falls back from a broken client image to the page's own image", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === "https://cdn.test/broken.jpg",
        respond: () => new Response("", { status: 403 }),
      },
      {
        match: (u) => u === "https://shop.test/p/1",
        respond: () =>
          new Response('<meta property="og:image" content="https://cdn.test/og.png">', {
            headers: { "content-type": "text/html" },
          }),
      },
      { match: (u) => u === "https://cdn.test/og.png", respond: () => img(png(1200, 630)) },
    ]);
    const { cover, tried } = await resolveCover({
      url: "https://shop.test/p/1",
      candidates: ["https://cdn.test/broken.jpg"],
      fetch,
    });
    expect(cover?.sourceUrl).toBe("https://cdn.test/og.png");
    expect(tried).toBe(2);
  });
});

describe("podcast resolution helpers", () => {
  it("reads show, length, date and cover from Spotify's embed page", () => {
    const data = {
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                title: "tagesschau in 100 Sekunden",
                subtitle: "tagesschau in 100 Sekunden: Das aktuelle News-Update (Audio)",
                duration: 119800,
                releaseDate: { isoString: "2026-10-24T09:35:00Z" },
                relatedEntityCoverArt: [
                  { url: "https://i/300", maxWidth: 300 },
                  { url: "https://i/640", maxWidth: 640 },
                ],
              },
            },
          },
        },
      },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    expect(parseSpotifyEmbed(html)).toEqual({
      title: "tagesschau in 100 Sekunden",
      show: "tagesschau in 100 Sekunden: Das aktuelle News-Update (Audio)",
      durationSec: 120,
      publishedAt: "2026-10-24T09:35:00Z",
      imageUrl: "https://i/640",
    });
    expect(parseSpotifyEmbed("<html>")).toEqual({});
  });

  it("picks the episode published closest to the Spotify date when titles repeat (daily shows)", () => {
    const feed = {
      title: "News",
      episodes: [
        {
          title: "News in 100 Sekunden",
          pubDate: "Fri, 24 Oct 2026 11:35:00 GMT",
          transcripts: [],
        },
        {
          title: "News in 100 Sekunden",
          pubDate: "Fri, 24 Oct 2026 09:35:00 GMT",
          transcripts: [],
        },
        {
          title: "News in 100 Sekunden",
          pubDate: "Thu, 23 Oct 2026 18:00:00 GMT",
          transcripts: [],
        },
      ],
    };
    expect(findEpisodeNear(feed, "News in 100 Sekunden", "2026-10-24T09:35:00Z")?.pubDate).toBe(
      "Fri, 24 Oct 2026 09:35:00 GMT",
    );
    expect(findEpisodeNear(feed, "Etwas ganz anderes")).toBeUndefined();
  });

  it("parses Apple Podcasts URLs", () => {
    expect(
      parseApplePodcastUrl("https://podcasts.apple.com/de/podcast/kortex/id1234567?i=1000654321"),
    ).toEqual({ showId: "1234567", episodeId: "1000654321" });
    expect(parseApplePodcastUrl("https://podcasts.apple.com/de/podcast/kortex/id1234567")).toEqual({
      showId: "1234567",
    });
    expect(parseApplePodcastUrl("https://example.com/id1")).toBeUndefined();
  });
});

describe("media notes helpers", () => {
  it("client transcripts become segments; lines group ~30 s and split on speakers", () => {
    expect(clientSegments({ text: "Nur Text", source: "user" })).toEqual([
      { startSec: 0, text: "Nur Text" },
    ]);
    const segs = clientSegments({
      text: "",
      source: "page",
      segments: [
        { start: 0, text: "A" },
        { start: 10, text: "B" },
        { start: 40, text: "C" },
      ],
    });
    expect(groupLines(segs)).toEqual([
      { start: 0, text: "A B" },
      { start: 40, text: "C" },
    ]);
    expect(
      groupLines([
        { startSec: 0, text: "Hi", speaker: "Max" },
        { startSec: 2, text: "Hallo", speaker: "Sven" },
      ]),
    ).toEqual([
      { start: 0, text: "Max: Hi" },
      { start: 2, text: "Sven: Hallo" },
    ]);
  });

  it("long transcripts are condensed evenly for the model (no part of the episode is missing)", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `[${i}] Teil ${i}: ${"wort ".repeat(40)}`);
    const { text, cut } = sampleLines(lines, 20_000);
    expect(cut).toBe(true);
    expect(text.length).toBeLessThanOrEqual(20_000);
    const stamps = [...text.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
    expect(stamps[0]).toBe(0);
    expect(stamps.at(-1)).toBeGreaterThan(985); // the end of the episode is in it
    // Evenly spread: no gap between two kept positions is larger than a few lines.
    const gaps = stamps.slice(1).map((s, i) => s - stamps[i]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(15);
    // Cuts happen at word boundaries and are marked.
    expect(text).toMatch(/wort \[…\]$/m);
    expect(text).not.toMatch(/wor \[…\]|wo \[…\]/);
    // Short transcripts go in verbatim.
    expect(sampleLines(lines.slice(0, 3), 20_000)).toEqual({ text: lines.slice(0, 3).join("\n"), cut: false });
  });

  it("any other video page with a client transcript gets the same structured note", async () => {
    const notes = {
      summary: "Talk über Agenten.",
      chapters: [{ title: "Start", start_sec: 0 }],
      key_takeaways: ["A"],
      learnings: [],
      quotes: [],
      resources: [],
    };
    const adapter = createClientMediaAdapter({ models: staticRouter({ fast: mockModel(notes) }) });
    const input = {
      userId: USER_ID,
      url: "https://vimeo.com/123456",
      title: "Agenten-Talk",
      imageUrl: "https://i.vimeocdn.com/x.jpg",
      transcript: {
        text: "",
        source: "page" as const,
        segments: [{ start: 0, text: "Willkommen." }],
      },
      media: {
        kind: "video" as const,
        provider: "other" as const,
        channel: "Conf",
        duration_sec: 600,
      },
    };
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ userId: USER_ID, url: "https://vimeo.com/1" })).toBe(false);
    const out = await adapter.extract(input);
    expect(out).toMatchObject({
      type: "video",
      titleHint: "Agenten-Talk",
      coverImageUrl: "https://i.vimeocdn.com/x.jpg",
    });
    expect(out.contentMd).toContain("## Executive Summary\n\nTalk über Agenten.");
    expect(out.metadata).toMatchObject({
      transcript_source: "client:page",
      channel: "Conf",
      duration_sec: 600,
    });
  });
});
