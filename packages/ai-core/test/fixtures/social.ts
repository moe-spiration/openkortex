// Trimmed shapes of the public TikTok video page and Instagram embed page (structure as served
// on 2026-10-25; values made up).

export const TIKTOK_URL = "https://www.tiktok.com/@kochmitlisa/video/7480598109484010794";

export const tiktokItem = (over: Record<string, unknown> = {}) => ({
  id: "7480598109484010794",
  desc: "Ofenhähnchen mit Zitrone 🍋 #rezept",
  createTime: "1741712505",
  author: { uniqueId: "kochmitlisa" },
  video: {
    duration: 58,
    playAddr: "https://v16-webapp-prime.tiktok.com/play.mp4",
    cover: "https://p16-common-sign.tiktokcdn-eu.com/cover.jpeg",
    originCover: "https://p16-common-sign.tiktokcdn-eu.com/origin.jpeg",
    bitrateInfo: [
      {
        DataSize: 9_000_000,
        PlayAddr: { UrlList: ["https://v16-webapp-prime.tiktok.com/hd.mp4"] },
      },
      {
        DataSize: 3_000_000,
        PlayAddr: { UrlList: ["https://v16-webapp-prime.tiktok.com/sd.mp4"] },
      },
    ],
    subtitleInfos: [
      {
        Url: "https://v16-webapp-prime.tiktok.com/sub-en.vtt",
        LanguageCodeName: "eng-US",
        Format: "webvtt",
      },
      {
        Url: "https://v16-webapp-prime.tiktok.com/sub-de.vtt",
        LanguageCodeName: "deu-DE",
        Format: "webvtt",
      },
    ],
  },
  ...over,
});

export const tiktokPage = (item: unknown) =>
  `<!DOCTYPE html><html><head><title>TikTok</title></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    {
      __DEFAULT_SCOPE__: {
        "webapp.app-context": { language: "de-DE" },
        "webapp.video-detail": { itemInfo: { itemStruct: item }, statusCode: 0 },
      },
    },
  )}</script></body></html>`;

export const GERMAN_VTT = `WEBVTT


00:00:00.000 --> 00:00:04.880
Heute machen wir ein ganzes Ofenhähnchen.

00:00:05.060 --> 00:00:09.660
Zitrone halbieren und in das Hähnchen stecken.
`;

export const IG_URL = "https://www.instagram.com/reel/DSu-vbYDDlf/?igsh=abc";

export const instagramMedia = (over: Record<string, unknown> = {}) => ({
  __typename: "GraphVideo",
  shortcode: "DSu-vbYDDlf",
  is_video: true,
  video_url: "https://scontent-fra5-1.cdninstagram.com/o1/v/clip.mp4?efg=x",
  video_duration: 71.471,
  display_url: "https://scontent-fra5-1.cdninstagram.com/v/still.jpg?stp=dst-jpg",
  taken_at_timestamp: 1766780000,
  owner: { username: "frenchfusemusic" },
  edge_media_to_caption: {
    edges: [{ node: { text: "Best funny videos of 2025! 😂🔥\nWhich one?" } }],
  },
  ...over,
});

/** The embed page keeps the post as a JSON string inside a JS object literal. */
export const instagramEmbed = (media: unknown) =>
  `<html><body><div class="Caption">…</div><script>window.__additionalDataLoaded('extra',{"shortcode":"DSu-vbYDDlf","contextJSON":${JSON.stringify(
    JSON.stringify({ context: { type: "GraphVideo" }, gql_data: { shortcode_media: media } }),
  )},"hasSeen":false});</script></body></html>`;
