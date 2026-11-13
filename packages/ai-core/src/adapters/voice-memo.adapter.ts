import { generateText, Output } from "ai";
import { z } from "zod";
import { PRIORITIES } from "@kortex/db";
import { AdapterDeclinedError, errorMessage } from "../errors";
import { byLocale, ph } from "../i18n";
import { voiceSynthesisPrompt } from "../prompts/voice";
import { modelFor, modelIdFor, type ModelRouter } from "../router/model-router";
import type {
  ExtractedActionItem,
  ExtractedPayload,
  IngestionAdapter,
  RawIngestInput,
} from "./base-adapter";
import { transcriptToggleLines } from "../util/transcript-toggle";

const ID = "voice-memo";

/** Shorter transcripts are kept as they are: a synthesis would only repeat them. */
export const MIN_VOICE_SYNTHESIS_WORDS = 25;

export const VoiceSynthesisSchema = z.object({
  title: z.string(),
  tldr: z.string(),
  outline: z.array(z.object({ heading: z.string(), points: z.array(z.string()) })),
  action_items: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      priority: z.enum(PRIORITIES),
      due_date: z.string().nullable(),
    }),
  ),
});
export type VoiceSynthesis = z.infer<typeof VoiceSynthesisSchema>;

export interface VoiceMemoAdapterOptions {
  models: ModelRouter;
  now?: () => Date;
}

const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);

/** TL;DR, outline, tasks, then the raw transcript as a folded `[!toggle]` (portable Markdown). */
export function renderVoiceMarkdown(s: VoiceSynthesis, transcript: string): string {
  const md: string[] = [];
  if (s.tldr.trim()) md.push(`## ${ph("tldr")}`, "", s.tldr.trim(), "");
  const outline = s.outline.filter((o) => o.heading.trim() || o.points.some((p) => p.trim()));
  if (outline.length > 0) {
    md.push(`## ${ph("outline")}`, "");
    for (const o of outline) {
      if (o.heading.trim()) md.push(`### ${o.heading.trim()}`, "");
      md.push(...o.points.filter((p) => p.trim()).map((p) => `- ${p.trim()}`), "");
    }
  }
  const tasks = s.action_items.filter((a) => a.title.trim());
  if (tasks.length > 0) {
    md.push(`## ${ph("actionItems")}`, "", ...tasks.map((a) => `- [ ] ${a.title.trim()}`), "");
  }
  md.push(...transcriptToggleLines(transcript));
  return md.join("\n").trim();
}

export function voiceActionItems(s: VoiceSynthesis): ExtractedActionItem[] {
  return s.action_items
    .filter((a) => a.title.trim())
    .map((a) => ({
      title: a.title.trim().slice(0, 200),
      description: a.description?.trim() || null,
      assignee: "Me",
      priority: a.priority,
      due_date: isoDate(a.due_date),
      source_timestamp_sec: null,
    }));
}

/**
 * Voice memos (typeHint "voice", transcript in `rawText`): TL;DR, outline and action items, the
 * raw transcript folded away. Short memos and model failures decline, so the plain note adapter
 * keeps the transcript as it is.
 */
export function createVoiceMemoAdapter(options: VoiceMemoAdapterOptions): IngestionAdapter {
  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      input.typeHint === "voice" &&
      !input.url &&
      !input.fileBuffer &&
      (input.rawText?.trim().length ?? 0) > 0,

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const transcript = (input.rawText ?? "").replace(/\r\n/g, "\n").trim();
      const words = transcript.split(/\s+/).length;
      if (words < MIN_VOICE_SYNTHESIS_WORDS)
        throw new AdapterDeclinedError(ID, `memo too short for a synthesis (${words} words)`);
      const today = (options.now?.() ?? new Date()).toISOString().slice(0, 10);

      let synthesis: VoiceSynthesis;
      try {
        const { output } = await generateText({
          model: modelFor(options.models, "summarize"),
          system: voiceSynthesisPrompt(),
          prompt: `${byLocale({ en: "Today", de: "Heute" })}: ${today}\n<transcript>\n${transcript.slice(0, 40_000)}\n</transcript>`,
          output: Output.object({ schema: VoiceSynthesisSchema, name: "voice_synthesis" }),
          temperature: 0.2,
        });
        synthesis = output;
      } catch (cause) {
        throw new AdapterDeclinedError(ID, `voice synthesis failed: ${errorMessage(cause)}`);
      }

      const actionItems = voiceActionItems(synthesis);
      return {
        type: "voice",
        sourcePlatform: "manual",
        titleHint: synthesis.title.trim().slice(0, 80) || undefined,
        contentMd: renderVoiceMarkdown(synthesis, transcript),
        actionItems,
        metadata: {
          word_count: words,
          has_transcript: true,
          synthesized_by: modelIdFor(options.models, "summarize"),
        },
      };
    },
  };
}
