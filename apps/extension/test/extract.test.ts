// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fitTranscriptText, TRANSCRIPT_MAX_CHARS, applyLimits } from "../src/lib/limits";
import { extractPage } from "../src/lib/extract";
import { amazon, largestDynamicImage } from "../src/lib/extract/amazon";
import { largeContentImages } from "../src/lib/extract/generic";
import { applePodcasts, spotify } from "../src/lib/extract/podcasts";
import {
  jsonObjectAt,
  parseClock,
  parseJson3,
  pickTrack,
  readPanelSegments,
  readTranscriptPanel,
  thumbnailCandidates,
  videoIdOf,
  youtube,
} from "../src/lib/extract/youtube";
import { buildWebClip } from "../src/lib/requests";
import { mediaLine, transcriptHint } from "../src/lib/result";

// Fixtures are trimmed snapshots of real public pages (see test/fixtures): head metadata, JSON-LD and the
// handful of body nodes the extractors read.
const fixture = (name: string) => new DOMParser().parseFromString(readFileSync(resolve(__dirname, "fixtures", name), "utf8"), "text/html");
const html = (body: string, head = "") => new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, "text/html");
const noFetch = async () => {
  throw new Error("no network in tests");
};

const YT_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const json3 = JSON.stringify({
  events: [
    { tStartMs: 18000, dDurationMs: 4000, segs: [{ utf8: "Uns beiden ist die Liebe" }, { utf8: " nicht fremd" }] },
    { tStartMs: 22000, segs: [{ utf8: "\n" }] },
    { tStartMs: 23000, dDurationMs: 3500, segs: [{ utf8: "Du kennst die Regeln" }] },
  ],
});

describe("YouTube", () => {
  it("reads the video id from every address form", () => {
    for (const u of [YT_URL, "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ?si=x", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"]) {
      expect(videoIdOf(new URL(u)), u).toBe("dQw4w9WgXcQ");
    }
    expect(videoIdOf(new URL("https://www.youtube.com/feed/subscriptions"))).toBeNull();
    expect(videoIdOf(new URL("https://www.youtube.com/watch?v=short"))).toBeNull();
    expect(videoIdOf(new URL("https://example.com/watch?v=dQw4w9WgXcQ"))).toBeNull();
  });

  it("offers maxres, sd and hq thumbnails in that order", () => {
    expect(thumbnailCandidates("dQw4w9WgXcQ")).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
  });

  it("prefers manual German, then manual English, then automatic captions", () => {
    const t = (languageCode: string, kind?: string) => ({ baseUrl: "https://x/", languageCode, kind });
    expect(pickTrack([t("en", "asr"), t("en"), t("de-DE")])?.languageCode).toBe("de-DE");
    expect(pickTrack([t("fr"), t("en"), t("es")])?.languageCode).toBe("en");
    expect(pickTrack([t("fr"), t("de", "asr"), t("en", "asr")])?.languageCode).toBe("fr");
    expect(pickTrack([t("en", "asr"), t("de", "asr")])?.languageCode).toBe("de");
    expect(pickTrack([])).toBeNull();
  });

  it("parses json3 captions and skips blank lines", () => {
    expect(parseJson3(json3)).toEqual([
      { start: 18, dur: 4, text: "Uns beiden ist die Liebe nicht fremd" },
      { start: 23, dur: 3.5, text: "Du kennst die Regeln" },
    ]);
    expect(parseJson3("")).toEqual([]);
    expect(parseJson3("<html>")).toEqual([]);
  });

  it("finds a JSON object even with braces and quotes inside strings", () => {
    const src = 'var x = {"a":"} {","b":{"c":"\\"}"}}; var y = 1;';
    expect(JSON.parse(jsonObjectAt(src, 0)!)).toEqual({ a: "} {", b: { c: '"}' } });
    expect(jsonObjectAt("{ unbalanced", 0)).toBeNull();
  });

  it("builds cover candidates, media info and a German-first transcript from the real page", async () => {
    const fetchText = vi.fn(async (url: string) => (url ? json3 : ""));
    const page = await extractPage({ doc: fixture("youtube-watch.html"), url: YT_URL, fetchText });

    expect(page.title).toBe("Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)");
    expect(page.image_url).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
    expect(page.image_candidates).toEqual(expect.arrayContaining(thumbnailCandidates("dQw4w9WgXcQ")));
    expect(page.image_candidates!.length).toBeLessThanOrEqual(6);
    expect(page.media).toEqual({ kind: "video", provider: "youtube", duration_sec: 213, channel: "Rick Astley", published_at: "2009-10-25T06:57:33.000Z" });
    expect(page.transcript).toMatchObject({ lang: "de-DE", source: "youtube-captions" });
    expect(page.transcript!.segments).toHaveLength(2);
    expect(page.transcript!.text).toBe("Uns beiden ist die Liebe nicht fremd Du kennst die Regeln");
    // the German manual track was asked for, as json3
    const asked = new URL(String(fetchText.mock.calls[0]![0]));
    expect(asked.searchParams.get("lang")).toBe("de-DE");
    expect(asked.searchParams.get("fmt")).toBe("json3");
    expect(page.capture_notes).toBeUndefined();
  });

  it("falls back to the transcript panel when the caption URL answers with an empty body", async () => {
    // current YouTube: 200 with no body unless the player attached its proof-of-origin token
    const page = await extractPage({ doc: fixture("youtube-watch.html"), url: YT_URL, fetchText: async () => "" });
    expect(page.transcript?.source).toBe("youtube-captions");
    expect(page.transcript!.segments!.length).toBeGreaterThanOrEqual(3);
    expect(page.transcript!.segments![0]).toMatchObject({ start: 18, dur: 9, text: expect.stringContaining("Liebe") });
    expect(page.transcript!.lang).toBe("de-DE");
  });

  it("reads panel lines in both markups and opens the panel when it is closed", async () => {
    expect(parseClock("1:02:05")).toBe(3725);
    expect(parseClock("0:18")).toBe(18);
    expect(parseClock("18 Sekunden")).toBeNull();
    expect(readPanelSegments(fixture("youtube-watch.html"))[0]).toMatchObject({ start: 18, text: expect.stringContaining("Uns beiden") });

    const doc = html(`<ytd-video-description-transcript-section-renderer><button>Transkript anzeigen</button></ytd-video-description-transcript-section-renderer><div id="panel"></div>`);
    doc.querySelector("button")!.addEventListener("click", () => {
      doc.querySelector("#panel")!.innerHTML = `<ytd-transcript-segment-renderer><div class="segment-timestamp"> 0:05 </div><yt-formatted-string class="segment-text">Hallo   Welt</yt-formatted-string></ytd-transcript-segment-renderer>
        <ytd-transcript-segment-renderer><div class="segment-timestamp">0:09</div><yt-formatted-string class="segment-text">Zweite Zeile</yt-formatted-string></ytd-transcript-segment-renderer>`;
    });
    const segments = await readTranscriptPanel(doc, async () => {}, 3000);
    expect(segments).toEqual([
      { start: 5, dur: 4, text: "Hallo Welt" },
      { start: 9, text: "Zweite Zeile" },
    ]);
    expect(await readTranscriptPanel(html("<p>nothing</p>"), async () => {}, 600)).toEqual([]);
  });

  it("says so when the video has no captions, and keeps cover and media", async () => {
    const doc = fixture("youtube-watch.html");
    for (const s of doc.querySelectorAll("script")) s.textContent = s.textContent!.replace(/"captionTracks":\[.*?\],"audioTracks"/s, '"captionTracks":[],"audioTracks"');
    const page = await extractPage({ doc, url: YT_URL, fetchText: noFetch });
    expect(page.transcript).toBeUndefined();
    expect(page.capture_notes).toEqual(["Keine Untertitel gefunden"]);
    expect(page.image_url).toContain("maxresdefault");
    expect(page.media?.provider).toBe("youtube");
  });

  it("re-reads the watch page when the inline player data belongs to another video (in-app navigation)", async () => {
    const fresh = readFileSync(resolve(__dirname, "fixtures", "youtube-watch.html"), "utf8");
    const fetchText = vi.fn(async (url: string) => (url.includes("/watch?v=") ? fresh : json3));
    const stale = html("<p>old</p>", `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"AAAAAAAAAAA"}};</script>`);
    const page = await extractPage({ doc: stale, url: YT_URL, fetchText });
    expect(fetchText.mock.calls[0]![0]).toBe(YT_URL);
    expect(page.media?.channel).toBe("Rick Astley");
    expect(page.transcript?.segments).toHaveLength(2);
  });

  it("still delivers cover and title when the page cannot be read at all", async () => {
    const page = await extractPage({ doc: html("<p>x</p>", "<title>Ein Video</title>"), url: YT_URL, fetchText: noFetch });
    expect(page.image_url).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
    expect(page.media).toMatchObject({ kind: "video", provider: "youtube" });
    expect(page.capture_notes).toEqual(["Keine Untertitel gefunden"]);
  });

  it("matches only video addresses", () => {
    expect(youtube.matches(new URL(YT_URL))).toBe(true);
    expect(youtube.matches(new URL("https://www.youtube.com/"))).toBe(false);
  });
});

describe("Amazon", () => {
  const url = "https://www.amazon.de/dp/B0CFP6F89F";

  it("takes the hi-res product photo and the price, no og:image needed", async () => {
    const page = await extractPage({ doc: fixture("amazon-product.html"), url, fetchText: noFetch });
    expect(page.title).toContain("Kindle Paperwhite");
    expect(page.image_url).toBe("https://m.media-amazon.com/images/I/61iHqdmJXrL._AC_SL1000_.jpg");
    expect(page.image_candidates).toContain("https://m.media-amazon.com/images/I/61iHqdmJXrL._AC_SX569_.jpg");
    expect(page.description).toMatch(/^Preis: 209,99\s?€/);
    expect(page.site_name).toBe("Amazon");
  });

  it("falls back to the largest entry of data-a-dynamic-image", () => {
    expect(largestDynamicImage('{"https://a/small.jpg":[100,100],"https://a/big.jpg":[679,679],"https://a/mid.jpg":[300,300]}')).toBe("https://a/big.jpg");
    expect(largestDynamicImage("not json")).toBeNull();
    expect(largestDynamicImage(null)).toBeNull();
  });

  it("matches product pages of every storefront, not the search", () => {
    expect(amazon.matches(new URL(url))).toBe(true);
    expect(amazon.matches(new URL("https://www.amazon.com/Some-Title/dp/B08N5WRWNW/ref=sr_1_1"))).toBe(true);
    expect(amazon.matches(new URL("https://www.amazon.co.uk/gp/product/B08N5WRWNW"))).toBe(true);
    expect(amazon.matches(new URL("https://www.amazon.de/s?k=kindle"))).toBe(false);
    expect(amazon.matches(new URL("https://example.com/dp/B08N5WRWNW"))).toBe(false);
  });
});

describe("Spotify and Apple Podcasts", () => {
  it("reads show, duration, date and artwork of an episode", async () => {
    const page = await extractPage({ doc: fixture("spotify-episode.html"), url: "https://open.spotify.com/episode/2rKMiQw2A58GL5ZHH8jfHo", fetchText: noFetch });
    expect(page.title).toBe("#2570 - Mystery Boys");
    expect(page.image_url).toBe("https://image-cdn-fa.spotifycdn.com/image/ab6772ab00001692b1bc779505bae7d8f8daa997");
    expect(page.media).toEqual({ kind: "podcast", provider: "spotify", duration_sec: 9821, channel: "The Joe Rogan Experience", published_at: "2026-10-23T17:00:00.000Z" });
    expect(mediaLine(page.media!)).toBe("The Joe Rogan Experience · 2:43:41");
  });

  it("understands the older description wording and tracks", () => {
    const doc = html("", `<meta property="og:description" content="Listen to this episode from Lage der Nation on Spotify."><meta name="music:duration" content="1800">`);
    expect(spotify.extract({ doc, url: "https://open.spotify.com/episode/x", fetchText: noFetch })).toMatchObject({ media: { kind: "podcast", channel: "Lage der Nation", duration_sec: 1800 } });
    expect(spotify.extract({ doc, url: "https://open.spotify.com/track/x", fetchText: noFetch })).toMatchObject({ media: { kind: "audio" } });
    expect(spotify.matches(new URL("https://open.spotify.com/playlist/x"))).toBe(false);
  });

  it("reads an Apple Podcasts episode from its JSON-LD", () => {
    const doc = html(
      "",
      `<meta property="og:image" content="https://is1-ssl.mzstatic.com/art/1200x630.jpg"><script type="application/ld+json">{"@context":"http://schema.org","@type":"PodcastEpisode","name":"Folge 42","datePublished":"2026-10-01","timeRequired":"PT1H12M30S","partOfSeries":{"@type":"PodcastSeries","name":"Die Show"}}</script>`,
    );
    expect(applePodcasts.extract({ doc, url: "https://podcasts.apple.com/de/podcast/x/id1?i=2", fetchText: noFetch })).toMatchObject({
      title: "Folge 42",
      images: ["https://is1-ssl.mzstatic.com/art/1200x630.jpg"],
      media: { kind: "podcast", provider: "apple", duration_sec: 4350, channel: "Die Show", published_at: "2026-10-01" },
    });
  });
});

describe("generic pages (news, blogs)", () => {
  it("takes the lead image of a real article, absolute and http(s)", async () => {
    const url = "https://www.tagesschau.de/ausland/asien/braende-indonesien-100.html";
    const page = await extractPage({ doc: fixture("news-article.html"), url, fetchText: noFetch });
    expect(page.title).toContain("Waldbrände in Indonesien");
    expect(page.image_url).toMatch(/^https:\/\/images\.tagesschau\.de\/image\/.+indonesien-braende-104/);
    expect(page.image_candidates!.every((c) => /^https?:\/\//.test(c))).toBe(true);
    expect(page.transcript).toBeUndefined();
  });

  it("ranks JSON-LD before og:image before twitter:image, drops data: URLs, resolves relative ones", async () => {
    const doc = html(
      "",
      `<meta property="og:image" content="/img/og.jpg"><meta name="twitter:image" content="data:image/png;base64,AAAA">
       <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","image":[{"@type":"ImageObject","url":"https://cdn.example.com/lead.jpg"},"https://cdn.example.com/lead-2.jpg"],"publisher":{"logo":{"url":"https://cdn.example.com/logo.png"}}}]}</script>`,
    );
    const page = await extractPage({ doc, url: "https://example.com/a/b", fetchText: noFetch });
    expect(page.image_candidates).toEqual(["https://cdn.example.com/lead.jpg", "https://cdn.example.com/lead-2.jpg", "https://example.com/img/og.jpg"]);
  });

  it("uses the largest content image as a last resort and ignores icons, nav and tiny images", () => {
    const doc = html(`
      <nav><img src="/nav-big.jpg" width="900" height="600"></nav>
      <img src="/tiny.jpg" width="40" height="40">
      <img src="/avatar.jpg" class="avatar" width="400" height="400">
      <img src="/small.jpg" width="320" height="320">
      <img src="/hero.jpg" width="1200" height="800">
      <img src="data:image/gif;base64,R0lGOD" width="900" height="900">`);
    expect(largeContentImages(doc, "https://example.com/")).toEqual(["https://example.com/hero.jpg", "https://example.com/small.jpg"]);
  });

  it("puts raster covers before SVG logos", async () => {
    const doc = html("", `<meta property="og:image" content="https://example.com/logo.svg"><meta name="twitter:image" content="https://example.com/photo.png">`);
    const page = await extractPage({ doc, url: "https://example.com/", fetchText: noFetch });
    expect(page.image_candidates).toEqual(["https://example.com/photo.png", "https://example.com/logo.svg"]);
  });

  it("reads a JSON-LD VideoObject on any site as media", async () => {
    const doc = html(
      "",
      `<script type="application/ld+json">{"@type":"VideoObject","name":"Demo","thumbnailUrl":"https://v.example.com/t.jpg","duration":"PT4M5S","uploadDate":"2026-09-30T10:00:00+02:00","author":{"name":"Studio"}}</script>`,
    );
    const page = await extractPage({ doc, url: "https://v.example.com/demo", fetchText: noFetch });
    expect(page.media).toEqual({ kind: "video", provider: "other", duration_sec: 245, channel: "Studio", published_at: "2026-09-30T08:00:00.000Z" });
    expect(page.image_url).toBe("https://v.example.com/t.jpg");
  });

  it("survives a failing site extractor and keeps the generic result", async () => {
    const boom = { id: "boom", matches: () => true, extract: () => Promise.reject(new Error("broken")) };
    const doc = html("", `<meta property="og:image" content="https://example.com/p.jpg"><title>T</title>`);
    const page = await extractPage({ doc, url: "https://example.com/x", fetchText: noFetch }, [boom]);
    expect(page.image_url).toBe("https://example.com/p.jpg");
    expect(page.title).toBe("T");
  });
});

describe("from page to request", () => {
  it("sends the chosen cover, transcript and media in the web_clip", async () => {
    const page = await extractPage({ doc: fixture("youtube-watch.html"), url: YT_URL, fetchText: async () => json3 });
    const req = buildWebClip(page, { folder: null, tags: [], note: "", image: page.image_candidates![1] });
    expect(req).toMatchObject({
      kind: "web_clip",
      type_hint: "video",
      image_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg",
      media: { provider: "youtube", duration_sec: 213 },
      transcript: { source: "youtube-captions", lang: "de-DE" },
    });
    expect(buildWebClip(page, { folder: null, tags: [], note: "", image: null }).image_url).toBeNull();
    expect(buildWebClip(page, { folder: null, tags: [], note: "" }).image_url).toBe(page.image_url);
  });

  it("describes what was found", async () => {
    const page = await extractPage({ doc: fixture("youtube-watch.html"), url: YT_URL, fetchText: async () => json3 });
    expect(transcriptHint(page.transcript!)).toBe("Transkript erkannt (1 Min., de-DE)");
    expect(transcriptHint({ text: "wort ".repeat(1500), source: "page" })).toBe("Transkript erkannt (10 Min.)");
  });

  it("trims an oversize transcript to 400,000 characters with a note, and tells the user", () => {
    const segments = Array.from({ length: 50_000 }, (_, i) => ({ start: i, text: "x".repeat(15) }));
    const text = segments.map((s) => s.text).join(" ");
    expect(text.length).toBeGreaterThan(TRANSCRIPT_MAX_CHARS);
    const cut = fitTranscriptText({ text, source: "youtube-captions", segments });
    expect(cut.cut).toBe(true);
    expect(cut.value.text.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS);
    expect(cut.value.text.endsWith("[Transkript gekürzt]")).toBe(true);
    expect(cut.value.segments!.length).toBeLessThan(segments.length);

    const small = { text: "kurz", source: "page" as const };
    expect(fitTranscriptText(small)).toEqual({ value: small, cut: false });

    const fitted = applyLimits({
      kind: "web_clip",
      client: { name: "kortex-extension", version: "0" },
      captured_at: "2026-10-24T08:00:00Z",
      url: YT_URL,
      title: "T",
      transcript: { text, source: "youtube-captions" },
    });
    expect(fitted.notices).toContain("Transkript auf 400.000 Zeichen gekürzt");
    expect(fitted.request.kind === "web_clip" && fitted.request.transcript!.text.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS);
  });
});
