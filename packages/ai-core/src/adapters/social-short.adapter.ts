import { byLocale, ph } from "../i18n";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { AudioInput, AudioTranscriber, TranscriptSegment } from "../audio/transcriber";
import {
  AdapterDeclinedError,
  ExtractionError,
  NotImplementedAdapterError,
  errorMessage,
} from "../errors";
import type { FetchLike } from "../http";
import { clientSegments } from "../media/notes";
import { createPublicSocialDownloader } from "./social-short.downloader";
import type { ModelRouter } from "../router/model-router";
import { STORAGE_BUCKETS, imageExtension, itemStoragePath, type StorageGateway } from "../storage";
import type {
  ExtractedPayload,
  IngestionAdapter,
  RawIngestInput,
  StructuralChunk,
} from "./base-adapter";
import { transcriptToggleLines } from "../util/transcript-toggle";
import { formatTimestamp } from "./youtube.adapter";
import { modelFor } from "../router/model-router";

// Instagram Reels & TikTok (spec 01 A5): audio transcript + vision OCR on 4 keyframes + caption
// → one structured note. Downloading and frame extraction live behind `SocialMediaDownloader`
// (yt-dlp + ffmpeg worker, or the mobile app sending the shared file); no scraping here.

const ID = "social-short";
export const KEYFRAME_COUNT = 4;

export type SocialPlatform = "instagram" | "tiktok";

export interface SocialKeyframe {
  timeSec: number;
  image: Uint8Array;
  mimeType: string;
}

export interface SocialMediaBundle {
  platform: SocialPlatform;
  /** Canonical post URL. */
  url: string;
  caption?: string;
  author?: string;
  postedAt?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  /** Audio track (any format Whisper accepts: m4a, mp3, webm, wav). */
  audio?: AudioInput;
  /** Representative frames; more than 4 are thinned out evenly. */
  keyframes: SocialKeyframe[];
  /** Subtitles the platform publishes (TikTok WebVTT): used instead of speech-to-text. */
  transcript?: TranscriptSegment[];
  transcriptSource?: string;
  /** What the downloader could not get (kept in the item's metadata). */
  warnings?: string[];
}

/** Port the desktop/mobile/worker side implements. */
export interface SocialMediaDownloader {
  fetch(url: string, platform: SocialPlatform): Promise<SocialMediaBundle>;
}

export const notImplementedSocialMediaDownloader: SocialMediaDownloader = {
  async fetch() {
    throw new NotImplementedAdapterError(ID, "media download for Reels/TikTok");
  },
};

export interface SocialShortAdapterOptions {
  /** Default: the public page downloader (social-short.downloader.ts). */
  downloader?: SocialMediaDownloader;
  /** HTTP for the default downloader. */
  fetch?: FetchLike;
  /** Groq Whisper (createGroqWhisperTranscriber). Without it: no audio transcript. */
  transcriber?: AudioTranscriber;
  /** Vision (keyframe OCR) and fast model (synthesis). */
  models?: ModelRouter;
  /** Stores the first keyframe as cover in kortex-media. */
  storage?: StorageGateway;
}

export function detectSocialPlatform(url: string | undefined): SocialPlatform | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host === "instagram.com" && /^\/(reels?|p|tv)\/[\w-]+/.test(u.pathname)) return "instagram";
  if (
    (host === "tiktok.com" && /\/video\/\d+|^\/t\//.test(u.pathname)) ||
    host === "vm.tiktok.com" ||
    host === "vt.tiktok.com"
  ) {
    return "tiktok";
  }
  return undefined;
}

/** Picks `n` frames spread evenly over the clip. */
export function pickKeyframes<T>(frames: readonly T[], n = KEYFRAME_COUNT): T[] {
  if (frames.length <= n) return [...frames];
  return Array.from(
    { length: n },
    (_, i) => frames[Math.round((i * (frames.length - 1)) / (n - 1))] as T,
  );
}

export const KeyframeOcrSchema = z.object({
  overlays: z.array(z.object({ frame: z.number(), text: z.string() })),
  visual_summary: z.string(),
});

export const SocialNoteSchema = z.object({
  title: z.string(),
  kind: z.enum(["tutorial", "recipe", "tips", "review", "story", "other"]),
  summary: z.string(),
  steps: z.array(z.string()),
  ingredients: z.array(z.string()),
  key_points: z.array(z.string()),
  tools_mentioned: z.array(z.string()),
});
export type SocialNote = z.infer<typeof SocialNoteSchema>;

const ocrPrompt = (n: number) =>
  byLocale({
    en: `These are ${n} keyframes (in chronological order, frame 1-${n}) of a short social media video.
Read every text shown on screen (text overlays, subtitles, ingredient lists, screen texts) verbatim.
Deliver JSON: "overlays": [{ "frame": number, "text": "..." }] (empty when there is no text), "visual_summary": 1-2 sentences on what can be seen in the video.`,
    de: ocrPromptDe(n),
  });

const ocrPromptDe = (
  n: number,
) => `Dies sind ${n} Keyframes (in zeitlicher Reihenfolge, Frame 1-${n}) eines kurzen Social-Media-Videos.
Lies jeden eingeblendeten Text (Text-Overlays, Untertitel, Zutatenlisten, Bildschirmtexte) wortgetreu aus.
Liefere JSON: "overlays": [{ "frame": Nummer, "text": "..." }] (leer, wenn kein Text), "visual_summary": 1-2 Sätze, was im Video zu sehen ist.`;

const SYNTHESIS_PROMPT_EN = `You turn a short social media video (Instagram Reel / TikTok) into a structured note for the Second Brain Kortex.
Sources: caption, audio transcript, text overlays from keyframes, visual description.
Deliver JSON:
- "title": meaningful title (max. 80 characters)
- "kind": "tutorial" | "recipe" | "tips" | "review" | "story" | "other"
- "summary": 2-3 sentences TL;DR
- "steps": steps that can be numbered (for a tutorial/recipe), otherwise empty
- "ingredients": ingredients with quantities (recipes only), otherwise empty
- "key_points": the most important statements/tips
- "tools_mentioned": products, apps, tools, brands that are named
Language of the video, default English. Invent nothing that is in none of the sources.`;

const synthesisPrompt = (): string => byLocale({ en: SYNTHESIS_PROMPT_EN, de: SYNTHESIS_PROMPT_DE });

const SYNTHESIS_PROMPT_DE = `Du machst aus einem kurzen Social-Media-Video (Instagram Reel / TikTok) eine strukturierte Notiz für das Second Brain Kortex.
Quellen: Caption, Audio-Transkript, Text-Overlays aus Keyframes, visuelle Beschreibung.
Liefere JSON:
- "title": aussagekräftiger Titel (max. 80 Zeichen)
- "kind": "tutorial" | "recipe" | "tips" | "review" | "story" | "other"
- "summary": 2-3 Sätze TL;DR
- "steps": nummerierbare Schritte (bei Tutorial/Rezept), sonst leer
- "ingredients": Zutaten mit Mengen (nur bei Rezepten), sonst leer
- "key_points": wichtigste Aussagen/Tipps
- "tools_mentioned": genannte Produkte, Apps, Tools, Marken
Sprache des Videos, Standard Deutsch. Erfinde nichts, was in keiner Quelle steht.`;

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram Reel",
  tiktok: "TikTok",
};

export function createSocialShortAdapter(
  options: SocialShortAdapterOptions = {},
): IngestionAdapter {
  const downloader = options.downloader ?? createPublicSocialDownloader({ fetch: options.fetch });

  /**
   * What the client (extension, mobile share) sent: caption as title, poster, transcript.
   * Used when the server cannot read the post itself.
   */
  function clientBundle(input: RawIngestInput, platform: SocialPlatform): SocialMediaBundle | null {
    const transcript = clientSegments(input.transcript);
    if (!transcript.length && !input.title?.trim()) return null;
    return {
      platform,
      url: input.url as string,
      caption: input.title,
      author: input.media?.channel,
      postedAt: input.media?.published_at,
      durationSec: input.media?.duration_sec,
      thumbnailUrl: input.imageUrl,
      keyframes: [],
      ...(transcript.length
        ? { transcript, transcriptSource: `client:${input.transcript!.source}` }
        : {}),
    };
  }

  async function load(input: RawIngestInput, platform: SocialPlatform): Promise<SocialMediaBundle> {
    try {
      const b = await downloader.fetch(input.url as string, platform);
      // A transcript from the client beats paid speech-to-text.
      const client = clientSegments(input.transcript);
      if (!b.transcript?.length && client.length)
        return {
          ...b,
          transcript: client,
          transcriptSource: `client:${input.transcript!.source}`,
          audio: undefined,
        };
      return { ...b, thumbnailUrl: b.thumbnailUrl ?? input.imageUrl };
    } catch (err) {
      const fallback = err instanceof AdapterDeclinedError ? clientBundle(input, platform) : null;
      if (!fallback) throw err;
      return { ...fallback, warnings: [errorMessage(err)] };
    }
  }

  async function transcribe(
    audio: AudioInput | undefined,
    warnings: string[],
  ): Promise<TranscriptSegment[]> {
    if (!audio) return [];
    if (!options.transcriber) {
      warnings.push("no transcriber configured");
      return [];
    }
    try {
      return await options.transcriber.transcribe(audio);
    } catch (err) {
      warnings.push(`transcription failed: ${errorMessage(err)}`);
      return [];
    }
  }

  async function readOverlays(frames: SocialKeyframe[], warnings: string[]) {
    if (!options.models || frames.length === 0) return null;
    try {
      const { output } = await generateText({
        model: modelFor(options.models, "vision_ocr"),
        output: Output.object({ schema: KeyframeOcrSchema, name: "keyframe_ocr" }),
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: ocrPrompt(frames.length) },
              ...frames.map((f) => ({
                type: "file" as const,
                data: f.image,
                mediaType: f.mimeType,
              })),
            ],
          },
        ],
      });
      return output;
    } catch (err) {
      warnings.push(`keyframe OCR failed: ${errorMessage(err)}`);
      return null;
    }
  }

  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      !input.fileBuffer && detectSocialPlatform(input.url) !== undefined,

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const platform = detectSocialPlatform(input.url) as SocialPlatform;
      const bundle = await load(input, platform);
      const warnings: string[] = [...(bundle.warnings ?? [])];
      const frames = pickKeyframes([...bundle.keyframes].sort((a, b) => a.timeSec - b.timeSec));

      const [segments, ocr] = await Promise.all([
        bundle.transcript?.length
          ? Promise.resolve(bundle.transcript)
          : transcribe(bundle.audio, warnings),
        readOverlays(frames, warnings),
      ]);
      const transcript = segments
        .map((s) => `[${formatTimestamp(s.startSec)}] ${s.text}`)
        .join("\n");
      const overlays = (ocr?.overlays ?? [])
        .filter((o) => o.text.trim())
        .map((o) => ({ timeSec: frames[o.frame - 1]?.timeSec ?? null, text: o.text.trim() }));

      if (!bundle.caption?.trim() && !transcript && overlays.length === 0) {
        throw new ExtractionError(
          ID,
          "no caption, audio transcript or on-screen text to work with",
        );
      }

      let note: SocialNote | null = null;
      if (options.models) {
        try {
          const { output } = await generateText({
            model: modelFor(options.models, "summarize"),
            system: synthesisPrompt(),
            prompt: byLocale({
              en: [
                `Platform: ${PLATFORM_LABEL[platform]}${bundle.author ? ` by @${bundle.author.replace(/^@/, "")}` : ""}`,
                `Caption:\n${bundle.caption?.trim() || "(none)"}`,
                `Audio transcript:\n${transcript || "(none)"}`,
                `Text overlays:\n${overlays.map((o) => `- ${o.text}`).join("\n") || "(none)"}`,
                `Visual: ${ocr?.visual_summary ?? "(unknown)"}`,
              ],
              de: [
                `Plattform: ${PLATFORM_LABEL[platform]}${bundle.author ? ` von @${bundle.author.replace(/^@/, "")}` : ""}`,
                `Caption:\n${bundle.caption?.trim() || "(keine)"}`,
                `Audio-Transkript:\n${transcript || "(keins)"}`,
                `Text-Overlays:\n${overlays.map((o) => `- ${o.text}`).join("\n") || "(keine)"}`,
                `Visuell: ${ocr?.visual_summary ?? "(unbekannt)"}`,
              ],
            }).join("\n\n"),
            output: Output.object({ schema: SocialNoteSchema, name: "social_note" }),
            temperature: 0.2,
          });
          note = output;
        } catch (err) {
          warnings.push(`synthesis failed: ${errorMessage(err)}`);
        }
      }

      let coverImageUrl = bundle.thumbnailUrl;
      let coverStoragePath: string | null = null;
      const cover = frames[0];
      if (options.storage && input.itemId && cover) {
        coverStoragePath = itemStoragePath(
          input.userId,
          input.itemId,
          imageExtension(cover.mimeType),
        );
        const res = await options.storage.upload({
          bucket: STORAGE_BUCKETS.media,
          path: coverStoragePath,
          data: cover.image,
          contentType: cover.mimeType,
        });
        coverImageUrl = res.url ?? coverImageUrl;
      }

      const author = bundle.author ? `@${bundle.author.replace(/^@/, "")}` : null;
      const title =
        note?.title.trim() ||
        bundle.caption?.split("\n", 1)[0]?.slice(0, 80) ||
        PLATFORM_LABEL[platform];
      const facts = [
        PLATFORM_LABEL[platform],
        author,
        bundle.durationSec ? formatTimestamp(bundle.durationSec).replace(/^00:/, "") : null,
        `[Original](${bundle.url})`,
      ]
        .filter(Boolean)
        .join(" · ");
      const md: string[] = [`# ${title}`, "", `> ${facts}`, ""];
      if (note) {
        md.push(`**TL;DR:** ${note.summary.trim()}`, "");
        if (note.ingredients.length)
          md.push(`## ${ph("ingredients")}`, "", ...note.ingredients.map((i) => `- [ ] ${i}`), "");
        if (note.steps.length)
          md.push(`## ${ph("steps")}`, "", ...note.steps.map((s, i) => `${i + 1}. ${s}`), "");
        if (note.key_points.length)
          md.push(`## ${ph("keyStatements")}`, "", ...note.key_points.map((k) => `- ${k}`), "");
        if (note.tools_mentioned.length)
          md.push(
            `## ${ph("toolsMentioned")}`,
            "",
            ...note.tools_mentioned.map((t) => `- ${t}`),
            "",
          );
      }
      if (overlays.length) {
        md.push(
          `## ${ph("textOverlays")}`,
          "",
          ...overlays.map(
            (o) => `- ${o.timeSec !== null ? `[${formatTimestamp(o.timeSec)}] ` : ""}${o.text}`,
          ),
          "",
        );
      }
      if (bundle.caption?.trim()) md.push(`## ${ph("caption")}`, "", bundle.caption.trim(), "");
      if (transcript) md.push(...transcriptToggleLines(transcript.split("\n").flatMap((l) => [l, ""])), "");

      const structuralChunks: StructuralChunk[] = [];
      if (note)
        structuralChunks.push({
          heading: ph("note"),
          text: [note.summary, ...note.steps, ...note.ingredients, ...note.key_points].join("\n"),
        });
      if (transcript)
        structuralChunks.push({
          heading: ph("transcript"),
          pageOrTimestamp: "00:00:00",
          text: transcript,
        });
      const extra = [overlays.map((o) => o.text).join("\n"), bundle.caption?.trim() ?? ""]
        .filter(Boolean)
        .join("\n\n");
      if (extra) structuralChunks.push({ heading: "Caption & Overlays", text: extra });

      return {
        type: note?.kind === "recipe" ? "recipe" : "social",
        sourcePlatform: platform,
        titleHint: title,
        contentMd: md.join("\n").trim(),
        coverImageUrl,
        sourceUrl: bundle.url,
        structuralChunks,
        metadata: {
          platform,
          author,
          posted_at: bundle.postedAt ?? null,
          duration_sec: bundle.durationSec ?? null,
          kind: note?.kind ?? null,
          keyframes_analyzed: frames.length,
          overlay_count: overlays.length,
          transcript_source: transcript
            ? bundle.transcript?.length
              ? (bundle.transcriptSource ?? "platform")
              : (options.transcriber?.id ?? "unknown")
            : "none",
          tools_mentioned: note?.tools_mentioned ?? [],
          ingredients: note?.ingredients ?? [],
          cover_storage_path: coverStoragePath,
          warnings: warnings.length ? warnings : undefined,
        },
      };
    },
  };
}
