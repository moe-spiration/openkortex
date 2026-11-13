// Spotify oEmbed, a Podcasting 2.0 RSS feed and a WebVTT publisher transcript.

export const SPOTIFY_URL = "https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=abc";
export const FEED_URL = "https://feeds.example.com/kortex-cast.xml";
export const AUDIO_URL = "https://cdn.example.com/ep42.mp3";
export const VTT_URL = "https://cdn.example.com/ep42.vtt";

export const oembed = {
  html: '<iframe src="https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk"></iframe>',
  title: "#42 – Second Brains mit MCP",
  thumbnail_url: "https://i.scdn.co/image/ep42.jpg",
  provider_name: "Spotify",
  type: "rich",
};

export const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title>Kortex Cast</title>
  <itunes:author>Max &amp; Sven</itunes:author>
  <itunes:image href="https://cdn.example.com/show.jpg"/>
  <item>
    <title>#43 – Etwas ganz anderes</title>
    <enclosure url="https://cdn.example.com/ep43.mp3" type="audio/mpeg" length="1"/>
  </item>
  <item>
    <title><![CDATA[#42 – Second Brains mit MCP]]></title>
    <guid>ep-42</guid>
    <pubDate>Tue, 21 Oct 2026 06:00:00 GMT</pubDate>
    <description><![CDATA[<p>Wir sprechen über <b>MCP</b> und Second Brains.</p>]]></description>
    <itunes:duration>1:02:03</itunes:duration>
    <enclosure url="${AUDIO_URL}" type="audio/mpeg" length="123456"/>
    <podcast:transcript url="https://cdn.example.com/ep42.html" type="text/html"/>
    <podcast:transcript url="${VTT_URL}" type="text/vtt"/>
  </item>
</channel>
</rss>`;

export const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:04.500
<v Max>Willkommen zu Folge 42.

2
00:00:04.500 --> 00:00:09.000
<v Max>Heute geht es um MCP.

3
00:12:30.000 --> 00:12:36.000
<v Sven>Ein Second Brain ohne Agenten-Zugriff ist nur ein Archiv.
`;

export const showNotes = {
  summary: "Max und Sven besprechen, wie MCP Second Brains für Agenten öffnet.",
  chapters: [
    { title: "Intro", start_sec: 0 },
    { title: "Agenten-Zugriff", start_sec: 750 },
  ],
  key_takeaways: ["MCP standardisiert Tool-Zugriff."],
  learnings: ["Agenten über MCP an das eigene Wissen anbinden."],
  quotes: [
    {
      text: "Ein Second Brain ohne Agenten-Zugriff ist nur ein Archiv.",
      speaker: "Sven",
      time_sec: 750,
    },
  ],
  resources: ["Model Context Protocol", "Obsidian"],
};
