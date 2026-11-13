import { describe, expect, it, vi } from "vitest";
import {
  createGroqWhisperTranscriber,
  GROQ_TRANSCRIPTIONS_URL,
  type AudioTranscriber,
} from "../src/audio/transcriber";
import {
  createYouTubeAdapter,
  extractJsonAfter,
  notImplementedYouTubeAudioSource,
  parseChaptersFromDescription,
  parseYouTubeVideoId,
  type YouTubeDataSource,
} from "../src/adapters/youtube.adapter";
import { fakeFetch, html, json, mockModel, staticRouter, USER_ID } from "./helpers";
import { json3Captions, playerResponse, VIDEO_ID, watchPageHtml } from "./fixtures/youtube";

const ytFetch = () =>
  fakeFetch([
    {
      match: (u) => u.startsWith("https://www.youtube.com/watch"),
      respond: () => html(watchPageHtml),
    },
    {
      match: (u) => u.startsWith("https://www.youtube.com/api/timedtext"),
      respond: () => json(json3Captions),
    },
  ]);

describe("parseYouTubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abcDEF12345&t=10s", VIDEO_ID],
    ["https://m.youtube.com/watch?v=abcDEF12345", VIDEO_ID],
    ["https://youtu.be/abcDEF12345?si=x", VIDEO_ID],
    ["https://www.youtube.com/shorts/abcDEF12345", VIDEO_ID],
    ["https://www.youtube.com/embed/abcDEF12345", VIDEO_ID],
    ["https://www.youtube.com/channel/UC123", undefined],
    ["https://vimeo.com/123", undefined],
    ["not a url", undefined],
  ])("%s", (url, id) => expect(parseYouTubeVideoId(url)).toBe(id));
});

describe("youtube helpers", () => {
  it("extracts the player JSON even with braces inside strings", () => {
    expect(extractJsonAfter(watchPageHtml, "ytInitialPlayerResponse")).toEqual(playerResponse);
  });

  it("parses description chapters only when they start at 0:00", () => {
    expect(parseChaptersFromDescription(playerResponse.videoDetails.shortDescription)).toEqual([
      { title: "Intro", startSec: 0 },
      { title: "Supabase Setup", startSec: 60 },
      { title: "MCP Server", startSec: 150 },
    ]);
    expect(parseChaptersFromDescription("1:00 a\n2:00 b")).toEqual([]);
    expect(parseChaptersFromDescription("00:00 Start\n01:02:03 – Ende")).toEqual([
      { title: "Start", startSec: 0 },
      { title: "Ende", startSec: 3723 },
    ]);
  });
});

describe("youtube adapter", () => {
  it("builds a chaptered, timestamped transcript from captions (prefers German)", async () => {
    const fetch = ytFetch();
    const out = await createYouTubeAdapter({ fetch }).extract({
      userId: USER_ID,
      url: `https://youtu.be/${VIDEO_ID}`,
    });

    const captionCall = fetch.calls.find((c) => c.url.includes("timedtext"));
    expect(captionCall?.url).toContain("lang=de");
    expect(captionCall?.url).toContain("fmt=json3");

    expect(out.type).toBe("video");
    expect(out.sourcePlatform).toBe("youtube");
    expect(out.titleHint).toBe("Second Brain mit MCP bauen");
    expect(out.sourceUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    expect(out.coverImageUrl).toBe("https://i.ytimg.com/vi/abcDEF12345/maxresdefault.jpg");
    const at = (sec: number) => `(https://www.youtube.com/watch?v=${VIDEO_ID}&t=${sec}s)`;
    expect(out.contentMd).toContain(`- [1:00]${at(60)} Supabase Setup`);
    expect(out.contentMd).toContain(`> ### [0:00]${at(0)} Intro`);
    expect(out.contentMd).toContain(
      `> [0:00]${at(0)} Hallo und willkommen zu Kortex. Heute geht es um das Second Brain.`,
    );
    expect(out.contentMd).toContain(
      `> ### [2:30]${at(150)} MCP Server\n>\n> [2:31]${at(151)} Jetzt der MCP Server mit sechs Tools.`,
    );

    expect(out.structuralChunks?.map((c) => [c.heading, c.pageOrTimestamp])).toEqual([
      ["Beschreibung", undefined],
      ["Intro", "00:00:00"],
      ["Supabase Setup", "00:01:00"],
      ["MCP Server", "00:02:30"],
    ]);
    // Lines more than 30 s apart get their own timestamp.
    expect(out.structuralChunks?.[2]?.text).toBe(
      "[00:01:01] Zuerst richten wir Supabase ein.\n[00:01:35] Das Schema liegt im Schema kortex.",
    );
    expect(out.metadata).toMatchObject({
      video_id: VIDEO_ID,
      channel: "Kortex Lab",
      duration_sec: 185,
      published_at: "2026-09-30",
      chapters_source: "description",
      transcript_source: "youtube_captions",
      transcript_language: "de",
    });
  });

  it("uses the Whisper fallback when there are no captions", async () => {
    const source: YouTubeDataSource = {
      getVideoInfo: async () => ({
        videoId: VIDEO_ID,
        title: "Ohne Untertitel",
        durationSec: 400,
        captionTracks: [],
      }),
      getTranscript: vi.fn(),
    };
    const transcriber: AudioTranscriber = {
      id: "fake-whisper",
      transcribe: vi.fn(async () => [
        { startSec: 0, text: "Erster Satz." },
        { startSec: 320, text: "Zweiter Abschnitt." },
      ]),
    };
    const audio = {
      fetchAudio: vi.fn(async () => ({ data: new Uint8Array([1]), mimeType: "audio/webm" })),
    };
    const out = await createYouTubeAdapter({
      dataSource: source,
      whisperFallback: { audioSource: audio, transcriber },
    }).extract({
      userId: USER_ID,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });
    expect(audio.fetchAudio).toHaveBeenCalledWith(VIDEO_ID);
    expect(source.getTranscript).not.toHaveBeenCalled();
    expect(out.metadata.transcript_source).toBe("whisper");
    expect(out.metadata.chapters_source).toBe("none");
    expect(out.structuralChunks?.map((c) => c.pageOrTimestamp)).toEqual(["00:00:00", "00:05:00"]);
  });

  it("keeps the item (description only) when no transcript can be obtained", async () => {
    const fetch = fakeFetch([
      { match: (u) => u.includes("/watch"), respond: () => html(watchPageHtml) },
      { match: (u) => u.includes("timedtext"), respond: () => json({}, 429) },
      { match: (u) => u.includes("/youtubei/v1/player"), respond: () => json({}, 429) },
    ]);
    const out = await createYouTubeAdapter({
      fetch,
      whisperFallback: {
        audioSource: notImplementedYouTubeAudioSource,
        transcriber: { id: "x", transcribe: vi.fn() },
      },
    }).extract({ userId: USER_ID, url: `https://youtu.be/${VIDEO_ID}` });
    expect(out.metadata.transcript_source).toBe("none");
    expect(out.metadata.transcript_missing).toBe("captions_failed");
    expect(out.contentMd).toContain("Die Untertitel ließen sich serverseitig nicht laden");
    expect(out.metadata.warnings).toEqual([
      expect.stringContaining("429"),
      expect.stringContaining("not implemented"),
    ]);
  });

  it("web caption URL comes back empty (PO token): falls back to the Android player's track", async () => {
    const appTrack = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=de&kind=asr&app=1`;
    const fetch = fakeFetch([
      { match: (u) => u.includes("/watch"), respond: () => html(watchPageHtml) },
      {
        match: (u) => u.includes("timedtext") && u.includes("app=1"),
        respond: () => json(json3Captions),
      },
      { match: (u) => u.includes("timedtext"), respond: () => new Response("", { status: 200 }) },
      {
        match: (u) => u.includes("/youtubei/v1/player"),
        respond: () =>
          json({
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [{ baseUrl: appTrack, languageCode: "de", kind: "asr" }],
              },
            },
          }),
      },
    ]);
    const out = await createYouTubeAdapter({ fetch }).extract({
      userId: USER_ID,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    expect(out.metadata.transcript_source).toBe("youtube_captions");
    expect(out.metadata.transcript_missing).toBeNull();
    const player = fetch.calls.find((c) => c.url.includes("/youtubei/v1/player"));
    expect(player?.body).toMatchObject({
      videoId: VIDEO_ID,
      context: { client: { clientName: "ANDROID" } },
    });
  });

  it("keeps an unplayable video with its reason instead of failing the capture", async () => {
    const page = watchPageHtml.replace(
      '"status":"OK"',
      '"status":"ERROR","reason":"Video nicht verfügbar"',
    );
    const fetch = fakeFetch([
      {
        match: (u) => u.includes("/oembed"),
        respond: () => json({ title: "Gelöschtes Video", author_name: "Kortex Lab" }),
      },
      { match: () => true, respond: () => html(page) },
    ]);
    const out = await createYouTubeAdapter({ fetch }).extract({
      userId: USER_ID,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    expect(out.titleHint).toBe("Gelöschtes Video");
    expect(out.metadata).toMatchObject({
      transcript_missing: "player_failed",
      channel: "Kortex Lab",
    });
    expect(out.metadata.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/not playable: Video nicht verfügbar/)]),
    );
  });

  it("server bot-walled by YouTube: oEmbed details, a clear notice, no failure", async () => {
    const wall =
      '<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you are not a bot"}};</script></html>';
    const fetch = fakeFetch([
      {
        match: (u) => u.includes("/oembed"),
        respond: () => json({ title: "Second Brain mit MCP bauen", author_name: "Kortex Lab" }),
      },
      { match: (u) => u.includes("/watch"), respond: () => html(wall) },
    ]);
    const out = await createYouTubeAdapter({ fetch }).extract({
      userId: USER_ID,
      url: `https://youtu.be/${VIDEO_ID}`,
    });
    expect(out.titleHint).toBe("Second Brain mit MCP bauen");
    expect(out.metadata).toMatchObject({
      transcript_missing: "youtube_blocked",
      transcript_source: "none",
      channel: "Kortex Lab",
    });
    expect(out.contentMd).toContain("Mit der Kortex-Browser-Erweiterung clippen");
    expect(fetch.calls.some((c) => c.url.includes("timedtext"))).toBe(false);
  });

  it("uses the transcript the client sent (extension) without fetching captions", async () => {
    const wall =
      '<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"bot"}};</script></html>';
    const fetch = fakeFetch([
      {
        match: (u) => u.includes("/oembed"),
        respond: () => json({ title: "Video", author_name: "Kanal" }),
      },
      { match: (u) => u.includes("/watch"), respond: () => html(wall) },
    ]);
    const out = await createYouTubeAdapter({ fetch }).extract({
      userId: USER_ID,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      transcript: {
        text: "",
        lang: "de",
        source: "youtube-captions",
        segments: [
          { start: 0, dur: 4, text: "Hallo zusammen." },
          { start: 95, text: "Zweiter Teil." },
        ],
      },
      media: { kind: "video", provider: "youtube", duration_sec: 120, published_at: "2026-10-01" },
    });
    expect(out.metadata).toMatchObject({
      transcript_source: "client:youtube-captions",
      transcript_language: "de",
      duration_sec: 120,
      published_at: "2026-10-01",
      transcript_missing: null,
    });
    expect(out.contentMd).toContain(
      `[1:35](https://www.youtube.com/watch?v=${VIDEO_ID}&t=95s) Zweiter Teil.`,
    );
    expect(out.contentMd).not.toContain("Kein Transkript");
  });

  it("writes summary, chapters with jump links, takeaways and quotes with the routed model", async () => {
    const notes = {
      summary: "Wie man ein Second Brain mit MCP baut.",
      chapters: [
        { title: "Einführung", start_sec: 0 },
        { title: "Werkzeuge", start_sec: 151 },
      ],
      key_takeaways: ["MCP verbindet Agenten mit dem Vault."],
      learnings: ["Den eigenen Vault per MCP für Agenten öffnen."],
      quotes: [{ text: "Jetzt der MCP Server mit sechs Tools.", speaker: null, time_sec: 151 }],
      resources: ["Supabase"],
    };
    const source: YouTubeDataSource = {
      getVideoInfo: async () => ({
        videoId: VIDEO_ID,
        title: "MCP",
        durationSec: 200,
        captionTracks: [{ baseUrl: "x", languageCode: "de" }],
      }),
      getTranscript: async () => [
        { startSec: 0, text: "Hallo." },
        { startSec: 151, text: "Jetzt der MCP Server mit sechs Tools." },
      ],
    };
    const out = await createYouTubeAdapter({
      dataSource: source,
      models: staticRouter({ fast: mockModel(notes) }),
    }).extract({ userId: USER_ID, url: `https://youtu.be/${VIDEO_ID}` });
    const at = (sec: number) => `(https://www.youtube.com/watch?v=${VIDEO_ID}&t=${sec}s)`;
    expect(out.contentMd).toContain(
      "## Executive Summary\n\nWie man ein Second Brain mit MCP baut.",
    );
    expect(out.contentMd).toContain(
      `## Kapitel\n\n- [0:00]${at(0)} Einführung\n- [2:31]${at(151)} Werkzeuge`,
    );
    expect(out.contentMd).toContain(
      "## Kernpunkte\n\n- MCP verbindet Agenten mit dem Vault.\n\n## Learnings\n\n- Den eigenen Vault per MCP für Agenten öffnen.",
    );
    expect(out.contentMd).toContain(`> „Jetzt der MCP Server mit sechs Tools.“ — [2:31]${at(151)}`);
    // Synthesis on top, the timestamped transcript in its own section at the end.
    const headings = out.contentMd.match(/^## .+$/gm);
    expect(headings).toEqual([
      "## Executive Summary",
      "## Kernpunkte",
      "## Learnings",
      "## Kapitel",
      "## Zitate",
      "## Erwähnte Ressourcen",
    ]);
    expect(out.contentMd).toContain("\n> [!toggle]- Transkript\n>\n> ### ");
    expect(out.metadata).toMatchObject({
      chapters_source: "ai",
      resources: ["Supabase"],
      learnings: ["Den eigenen Vault per MCP für Agenten öffnen."],
    });
  });
});

describe("Groq Whisper transcriber", () => {
  it("drops segments with a high no_speech_prob; all dropped counts as empty", async () => {
    const reply = (segments: object[]) =>
      fakeFetch([{ match: (u) => u === GROQ_TRANSCRIPTIONS_URL, respond: () => json({ text: "x", segments }) }]);
    const audio = { data: new Uint8Array([1]), mimeType: "audio/mpeg" };
    const mixed = reply([
      { start: 0, end: 1, text: " Hallo Welt", no_speech_prob: 0.05 },
      { start: 1, end: 2, text: " Untertitel der Amara.org-Community", no_speech_prob: 0.92 },
    ]);
    expect(await createGroqWhisperTranscriber({ apiKey: "k", fetch: mixed }).transcribe(audio)).toEqual([
      { startSec: 0, endSec: 1, text: "Hallo Welt" },
    ]);
    const silent = reply([{ start: 0, end: 1, text: " Danke", no_speech_prob: 0.8 }]);
    await expect(createGroqWhisperTranscriber({ apiKey: "k", fetch: silent }).transcribe(audio)).rejects.toThrow(
      /empty transcription/,
    );
  });

  it("posts multipart audio and maps verbose_json segments", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === GROQ_TRANSCRIPTIONS_URL,
        respond: () =>
          json({
            text: "a b",
            segments: [
              { start: 0, end: 1.5, text: " a" },
              { start: 1.5, end: 3, text: " b" },
            ],
          }),
      },
    ]);
    const segments = await createGroqWhisperTranscriber({ apiKey: "gsk_test", fetch }).transcribe(
      { data: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg", fileName: "a.mp3" },
      { language: "de" },
    );
    expect(segments).toEqual([
      { startSec: 0, endSec: 1.5, text: "a" },
      { startSec: 1.5, endSec: 3, text: "b" },
    ]);
    const call = fetch.calls[0];
    expect(call?.headers.authorization).toBe("Bearer gsk_test");
    const form = call?.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("language")).toBe("de");
    expect((form.get("file") as File).name).toBe("a.mp3");
  });
});
