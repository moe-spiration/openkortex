import { ph } from "../i18n";
import {
  clientSegments,
  clockStamp,
  generateMediaNotes,
  renderMediaNote,
  timedLines,
} from "../media/notes";
import type { ModelRouter } from "../router/model-router";
import {
  isHttpUrl,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
} from "./base-adapter";
import { detectSocialPlatform } from "./social-short.adapter";

/*
 * Any other video or audio page (Vimeo, conference sites, news players …) whose transcript the
 * client already read: the same structured notes as YouTube, with the page as source. YouTube and
 * podcast URLs have their own adapters (higher priority); Reels/TikToks go to social-short.
 */

const ID = "client-media";

export function createClientMediaAdapter(options: { models?: ModelRouter } = {}): IngestionAdapter {
  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      isHttpUrl(input.url) &&
      clientSegments(input.transcript).length > 0 &&
      // Reels and TikToks get the social note (social-short reads the client transcript too).
      !detectSocialPlatform(input.url),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const url = input.url as string;
      const warnings: string[] = [];
      const segments = clientSegments(input.transcript);
      const media = input.media;
      const title = input.title?.trim() || new URL(url).hostname.replace(/^www\./, "");
      const notes = options.models
        ? await generateMediaNotes(
            options.models,
            {
              kind: media?.kind ?? "video",
              title,
              channel: media?.channel,
              lines: timedLines(segments),
            },
            warnings,
          )
        : null;
      const duration = media?.duration_sec ?? segments.at(-1)?.endSec;
      const rendered = renderMediaNote({
        title,
        facts: [
          media?.channel ?? null,
          duration ? clockStamp(duration) : null,
          media?.published_at ? media.published_at.slice(0, 10) : null,
          `[${ph("openOriginal")}](${url})`,
        ].filter((x): x is string => !!x),
        jump: () => null,
        notes,
        segments,
      });
      return {
        type: media?.kind === "podcast" || media?.kind === "audio" ? "podcast" : "video",
        sourcePlatform: media?.provider ?? "web",
        titleHint: title,
        contentMd: rendered.contentMd,
        ...(input.imageUrl ? { coverImageUrl: input.imageUrl } : {}),
        sourceUrl: url,
        structuralChunks: rendered.chunks,
        metadata: {
          channel: media?.channel ?? null,
          duration_sec: duration ? Math.round(duration) : null,
          published_at: media?.published_at ?? null,
          transcript_source: `client:${input.transcript!.source}`,
          transcript_language: input.transcript!.lang ?? null,
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
