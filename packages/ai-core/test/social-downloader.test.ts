import { describe, expect, it, vi } from "vitest";
import { createClientMediaAdapter } from "../src/adapters/client-media.adapter";
import { createSocialShortAdapter } from "../src/adapters/social-short.adapter";
import {
  createPublicSocialDownloader,
  instagramShortcode,
  isPlatformMediaUrl,
  parseInstagramEmbed,
  parseTikTokPage,
  pickSubtitle,
  TIKTOK_OEMBED_URL,
} from "../src/adapters/social-short.downloader";
import type { AudioTranscriber } from "../src/audio/transcriber";
import { AdapterDeclinedError } from "../src/errors";
import { PNG_1PX } from "./fixtures/make-epub";
import {
  GERMAN_VTT,
  IG_URL,
  instagramEmbed,
  instagramMedia,
  TIKTOK_URL,
  tiktokItem,
  tiktokPage,
} from "./fixtures/social";
import { fakeFetch, json, mockModel, staticRouter, USER_ID } from "./helpers";

const image = () => new Response(PNG_1PX, { headers: { "content-type": "image/png" } });
const mp4 = (bytes = 2048) =>
  new Response(new Uint8Array(bytes), {
    headers: { "content-type": "video/mp4", "content-length": String(bytes) },
  });
const page = (html: string) =>
  new Response(html, {
    headers: [
      ["content-type", "text/html"],
      ["set-cookie", "tt_chain_token=abc; Path=/; Secure"],
      ["set-cookie", "ttwid=xyz; Path=/"],
    ],
  });

describe("TikTok", () => {
  it("reads caption, author, date and German subtitles; no video download needed", async () => {
    const fetch = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(tiktokItem())) },
      { match: (u) => u.endsWith("sub-de.vtt"), respond: () => new Response(GERMAN_VTT) },
      { match: (u) => u.endsWith("origin.jpeg"), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(TIKTOK_URL, "tiktok");
    expect(b).toMatchObject({
      platform: "tiktok",
      url: TIKTOK_URL,
      caption: "Ofenhähnchen mit Zitrone 🍋 #rezept",
      author: "kochmitlisa",
      postedAt: "2025-03-11T17:01:45.000Z",
      durationSec: 58,
      transcriptSource: "tiktok-subtitles",
    });
    expect(b.transcript?.map((s) => s.text)).toEqual([
      "Heute machen wir ein ganzes Ofenhähnchen.",
      "Zitrone halbieren und in das Hähnchen stecken.",
    ]);
    expect(b.audio).toBeUndefined();
    expect(b.keyframes).toHaveLength(1);
    // Subtitle and image requests carry the page's cookies and the TikTok referer.
    const sub = fetch.calls.find((c) => c.url.endsWith("sub-de.vtt"));
    expect(sub?.headers).toMatchObject({
      cookie: "tt_chain_token=abc; ttwid=xyz",
      referer: "https://www.tiktok.com/",
    });
  });

  it("without subtitles: downloads the smallest rendition for speech-to-text", async () => {
    const item = tiktokItem({ video: { ...tiktokItem().video, subtitleInfos: [] } });
    const fetch = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(item)) },
      { match: (u) => u.endsWith("sd.mp4"), respond: () => mp4() },
      { match: (u) => u.endsWith(".jpeg"), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(TIKTOK_URL, "tiktok");
    expect(b.transcript).toBeUndefined();
    expect(b.audio).toMatchObject({
      mimeType: "video/mp4",
      fileName: "tiktok-7480598109484010794.mp4",
    });
    expect(fetch.calls.some((c) => c.url.endsWith("hd.mp4"))).toBe(false);
  });

  it("skips the download for long clips and oversized files", async () => {
    const long = tiktokItem({
      video: { ...tiktokItem().video, duration: 1200, subtitleInfos: [] },
    });
    const fetch = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(long)) },
      { match: (u) => u.endsWith(".jpeg"), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(TIKTOK_URL, "tiktok");
    expect(b.audio).toBeUndefined();
    expect(b.warnings).toContain("audio: clip longer than 10 min, not transcribed");

    const short = tiktokItem({ video: { ...tiktokItem().video, subtitleInfos: [] } });
    const big = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(short)) },
      { match: (u) => u.endsWith("sd.mp4"), respond: () => mp4(5000) },
      { match: (u) => u.endsWith(".jpeg"), respond: image },
    ]);
    const b2 = await createPublicSocialDownloader({ fetch: big, maxVideoBytes: 4000 }).fetch(
      TIKTOK_URL,
      "tiktok",
    );
    expect(b2.audio).toBeUndefined();
    expect(b2.warnings).toContain("audio: video not downloadable or too large");
  });

  it("page blocked: oEmbed gives caption, author and thumbnail; nothing at all: declines", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === TIKTOK_URL,
        respond: () => new Response("<html>captcha</html>", { status: 200 }),
      },
      {
        match: (u) => u.startsWith(TIKTOK_OEMBED_URL),
        respond: () =>
          json({
            title: "Ofenhähnchen",
            author_unique_id: "kochmitlisa",
            thumbnail_url: "https://p16-common-sign.tiktokcdn-eu.com/t.jpeg",
          }),
      },
      { match: (u) => u.endsWith("t.jpeg"), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(TIKTOK_URL, "tiktok");
    expect(b).toMatchObject({
      caption: "Ofenhähnchen",
      author: "kochmitlisa",
      thumbnailUrl: "https://p16-common-sign.tiktokcdn-eu.com/t.jpeg",
    });
    expect(b.keyframes).toHaveLength(1);

    const none = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => new Response("", { status: 403 }) },
      { match: (u) => u.startsWith(TIKTOK_OEMBED_URL), respond: () => json({}, 404) },
    ]);
    await expect(
      createPublicSocialDownloader({ fetch: none }).fetch(TIKTOK_URL, "tiktok"),
    ).rejects.toBeInstanceOf(AdapterDeclinedError);
  });

  it("parsers: page data and subtitle choice", () => {
    expect(parseTikTokPage("<html></html>")).toBeUndefined();
    expect(parseTikTokPage(tiktokPage(tiktokItem()))?.id).toBe("7480598109484010794");
    const infos = tiktokItem().video.subtitleInfos;
    expect(pickSubtitle(infos, ["de", "en"])?.LanguageCodeName).toBe("deu-DE");
    expect(pickSubtitle(infos, ["fr"])?.LanguageCodeName).toBe("eng-US");
  });
});

describe("hardening (review N5 #15, #16, #23)", () => {
  it("skips media, subtitle and image URLs that are not on the platforms' https hosts", async () => {
    const evil = tiktokItem({
      video: {
        ...tiktokItem().video,
        playAddr: "http://169.254.169.254/latest/meta-data/",
        bitrateInfo: [],
        originCover: "https://attacker.example/cover.jpg",
        subtitleInfos: [
          { Url: "https://attacker.example/sub.vtt", LanguageCodeName: "deu-DE", Format: "webvtt" },
        ],
      },
    });
    const fetch = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(evil)) },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(TIKTOK_URL, "tiktok");
    expect(fetch.calls.map((c) => c.url)).toEqual([TIKTOK_URL]);
    expect(b.audio).toBeUndefined();
    expect(b.keyframes).toEqual([]);
    expect(b.warnings).toEqual(
      expect.arrayContaining([
        "subtitles: not a platform media URL, skipped",
        "audio: not a platform media URL, skipped",
        "image: not a platform media URL, skipped",
      ]),
    );
    expect(isPlatformMediaUrl("https://scontent-fra5-1.cdninstagram.com/v/x.mp4")).toBe(true);
    expect(isPlatformMediaUrl("http://v16-webapp-prime.tiktok.com/x.mp4")).toBe(false);
    expect(isPlatformMediaUrl("https://tiktok.com.attacker.example/x.mp4")).toBe(false);
  });

  it("sends the TikTok cookies to TikTok hosts only, also across redirects", async () => {
    const fetch = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(tiktokItem())) },
      {
        match: (u) => u.endsWith("sub-de.vtt"),
        respond: () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://subs.fbcdn.net/sub.vtt" },
          }),
      },
      {
        match: (u) => u === "https://subs.fbcdn.net/sub.vtt",
        respond: () => new Response(GERMAN_VTT),
      },
      { match: (u) => u.endsWith("origin.jpeg"), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(TIKTOK_URL, "tiktok");
    expect(b.transcript).toHaveLength(2);
    const onTikTok = fetch.calls.find((c) => c.url.endsWith("sub-de.vtt"));
    const offTikTok = fetch.calls.find((c) => c.url === "https://subs.fbcdn.net/sub.vtt");
    expect(onTikTok?.headers.cookie).toBe("tt_chain_token=abc; ttwid=xyz");
    expect(offTikTok?.headers.cookie).toBeUndefined();
  });

  it("keeps only raster stills (an SVG, whatever its header says, is dropped)", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`.padEnd(
      2000,
      " ",
    );
    const fetch = fakeFetch([
      {
        match: (u) => u.includes("/embed/captioned/"),
        respond: () => page(instagramEmbed(instagramMedia({ video_url: undefined }))),
      },
      {
        match: (u) => u.includes("still.jpg"),
        respond: () => new Response(svg, { headers: { "content-type": "image/svg+xml" } }),
      },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(IG_URL, "instagram");
    expect(b.keyframes).toEqual([]);
  });

  it("caps the video download while streaming, without a Content-Length", async () => {
    const item = tiktokItem({ video: { ...tiktokItem().video, subtitleInfos: [] } });
    const chunked = () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1000));
            c.close();
          },
        }),
        { headers: { "content-type": "video/mp4" } },
      );
    const fetch = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(item)) },
      { match: (u) => u.endsWith("sd.mp4"), respond: chunked },
      { match: (u) => u.endsWith(".jpeg"), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch, maxVideoBytes: 4000 }).fetch(
      TIKTOK_URL,
      "tiktok",
    );
    expect(b.audio).toBeUndefined();
    expect(b.warnings).toContain("audio: video not downloadable or too large");
  });
});

describe("Instagram", () => {
  it("reads the post from the embed page (as a link preview) and downloads the clip", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === "https://www.instagram.com/p/DSu-vbYDDlf/embed/captioned/",
        respond: () => page(instagramEmbed(instagramMedia())),
      },
      { match: (u) => u.includes("clip.mp4"), respond: () => mp4() },
      { match: (u) => u.includes("still.jpg"), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(IG_URL, "instagram");
    expect(b).toMatchObject({
      platform: "instagram",
      url: "https://www.instagram.com/reel/DSu-vbYDDlf/",
      caption: "Best funny videos of 2025! 😂🔥\nWhich one?",
      author: "frenchfusemusic",
      durationSec: 71,
      audio: { mimeType: "video/mp4", fileName: "instagram-DSu-vbYDDlf.mp4" },
    });
    expect(b.keyframes).toHaveLength(1);
    expect(fetch.calls[0]?.headers["user-agent"]).toMatch(/^facebookexternalhit/);
  });

  it("carousel: up to 4 images become keyframes", async () => {
    const children = Array.from({ length: 6 }, (_, i) => ({
      node: { display_url: `https://scontent-fra5-1.cdninstagram.com/c${i}.jpg` },
    }));
    const media = instagramMedia({
      __typename: "GraphSidecar",
      video_url: undefined,
      edge_sidecar_to_children: { edges: children },
    });
    const fetch = fakeFetch([
      { match: (u) => u.includes("/embed/captioned/"), respond: () => page(instagramEmbed(media)) },
      { match: (u) => /c\d\.jpg$/.test(u), respond: image },
    ]);
    const b = await createPublicSocialDownloader({ fetch }).fetch(
      "https://www.instagram.com/p/DSu-vbYDDlf/",
      "instagram",
    );
    expect(b.keyframes).toHaveLength(4);
    expect(b.url).toBe("https://www.instagram.com/p/DSu-vbYDDlf/");
  });

  it("login wall or private post: declines (ingest falls back to the page clipper)", async () => {
    const fetch = fakeFetch([
      {
        match: () => true,
        respond: () => new Response("<html><script>require('x')</script></html>"),
      },
    ]);
    await expect(
      createPublicSocialDownloader({ fetch }).fetch(IG_URL, "instagram"),
    ).rejects.toThrow(/post data unavailable/);
    expect(parseInstagramEmbed("<html>")).toBeUndefined();
    expect(instagramShortcode("https://www.instagram.com/lisa/reel/C9xYz123AbC/")).toBe(
      "C9xYz123AbC",
    );
  });
});

describe("social-short adapter with the downloader", () => {
  const note = {
    title: "Ofenhähnchen mit Zitrone",
    kind: "recipe",
    summary: "Ganzes Hähnchen mit Zitrone im Ofen.",
    steps: ["Zitrone halbieren", "Hähnchen füllen"],
    ingredients: ["1 Hähnchen", "1 Zitrone"],
    key_points: [],
    tools_mentioned: [],
  };
  const ocr = { overlays: [], visual_summary: "Ein Hähnchen auf einem Blech." };

  it("TikTok subtitles replace speech-to-text", async () => {
    const fetch = fakeFetch([
      { match: (u) => u === TIKTOK_URL, respond: () => page(tiktokPage(tiktokItem())) },
      { match: (u) => u.endsWith("sub-de.vtt"), respond: () => new Response(GERMAN_VTT) },
      { match: (u) => u.endsWith("origin.jpeg"), respond: image },
    ]);
    const transcriber: AudioTranscriber = { id: "edenai:assembly", transcribe: vi.fn() };
    const models = staticRouter({ fast: mockModel(note), vision: mockModel(ocr) });
    const out = await createSocialShortAdapter({ fetch, transcriber, models }).extract({
      userId: USER_ID,
      url: TIKTOK_URL,
    });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(out.metadata).toMatchObject({
      transcript_source: "tiktok-subtitles",
      author: "@kochmitlisa",
    });
    expect(out.contentMd).toContain("Heute machen wir ein ganzes Ofenhähnchen.");
  });

  it("server can't read the post: builds the note from what the client sent", async () => {
    const fetch = fakeFetch([
      { match: () => true, respond: () => new Response("", { status: 403 }) },
    ]);
    const out = await createSocialShortAdapter({ fetch }).extract({
      userId: USER_ID,
      url: IG_URL,
      title: "Best funny videos of 2025!",
      imageUrl: "https://scontent.test/poster.jpg",
      transcript: { text: "Hallo zusammen", source: "page" },
      media: { kind: "video", channel: "frenchfusemusic", duration_sec: 71 },
    });
    expect(out.metadata).toMatchObject({
      transcript_source: "client:page",
      author: "@frenchfusemusic",
    });
    expect(out.coverImageUrl).toBe("https://scontent.test/poster.jpg");
    expect((out.metadata.warnings as string[])[0]).toMatch(/declined/);
  });

  it("Reels/TikToks with a client transcript stay with social-short, not client-media", () => {
    const input = {
      userId: USER_ID,
      url: TIKTOK_URL,
      transcript: { text: "x", source: "page" as const },
    };
    expect(createClientMediaAdapter().canHandle(input)).toBe(false);
    expect(createSocialShortAdapter().canHandle(input)).toBe(true);
  });
});
