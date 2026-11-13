// Trimmed-down watch page with innertube player data, plus json3 captions.

export const VIDEO_ID = "abcDEF12345";

export const playerResponse = {
  playabilityStatus: { status: "OK" },
  videoDetails: {
    videoId: VIDEO_ID,
    title: "Second Brain mit MCP bauen",
    author: "Kortex Lab",
    lengthSeconds: "185",
    shortDescription:
      'In diesem Video bauen wir ein "Second Brain" {mit} MCP.\n\n0:00 Intro\n1:00 Supabase Setup\n2:30 MCP Server\n\nLinks: https://kortex.example',
    thumbnail: {
      thumbnails: [
        { url: "https://i.ytimg.com/vi/abcDEF12345/default.jpg", width: 120 },
        { url: "https://i.ytimg.com/vi/abcDEF12345/maxresdefault.jpg", width: 1280 },
      ],
    },
  },
  microformat: { playerMicroformatRenderer: { publishDate: "2026-09-30" } },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=abcDEF12345&lang=en",
          languageCode: "en",
          name: { simpleText: "English" },
        },
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=abcDEF12345&lang=de&kind=asr",
          languageCode: "de",
          kind: "asr",
          name: { simpleText: "Deutsch (automatisch)" },
        },
      ],
    },
  },
};

export const watchPageHtml = `<!DOCTYPE html><html><head><title>YouTube</title></head><body>
<script>var ytcfg = {"x": 1};</script>
<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};var meta = document.createElement('meta');</script>
</body></html>`;

export const json3Captions = {
  events: [
    {
      tStartMs: 0,
      dDurationMs: 4000,
      segs: [{ utf8: "Hallo und willkommen" }, { utf8: " zu Kortex." }],
    },
    { tStartMs: 5000, dDurationMs: 3000, segs: [{ utf8: "\n" }] },
    { tStartMs: 12000, dDurationMs: 3000, segs: [{ utf8: "Heute geht es um das Second Brain." }] },
    { tStartMs: 61000, dDurationMs: 4000, segs: [{ utf8: "Zuerst richten wir Supabase ein." }] },
    { tStartMs: 95000, dDurationMs: 4000, segs: [{ utf8: "Das Schema liegt im Schema kortex." }] },
    {
      tStartMs: 151000,
      dDurationMs: 4000,
      segs: [{ utf8: "Jetzt der MCP Server mit sechs Tools." }],
    },
  ],
};
