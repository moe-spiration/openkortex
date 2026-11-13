import { generateText, Output } from "ai";
import { z } from "zod";
import { PRIORITIES, timeframeLabel } from "@kortex/db";
import {
  formatTranscriptLine,
  looksLikeMeetingTranscript,
  parseMeetingTranscript,
  TranscriptFormatError,
  type MeetingSegment,
  type MeetingTranscript,
  type SpeakerNames,
} from "../audio/meeting-transcript";
import { normalizeActionItems } from "../enrichment/auto-organizer";
import { ExtractionError, errorMessage } from "../errors";
import { byLocale, getLocale, ph, phForms } from "../i18n";
import { renderMeetingPrompt } from "../prompts/meeting";
import type { ModelRouter } from "../router/model-router";
import {
  fileExtension,
  type ExtractedActionItem,
  type ExtractedPayload,
  type IngestionAdapter,
  type RawIngestInput,
  type StructuralChunk,
} from "./base-adapter";
import { transcriptToggleLines } from "../util/transcript-toggle";
import { formatTimestamp } from "./youtube.adapter";
import { modelFor, modelIdFor } from "../router/model-router";

const ID = "meeting";

export interface MeetingAdapterOptions {
  /** Chat model (Claude 3.7 by default) writes the protocol. Without it: transcript only. */
  models?: ModelRouter;
  speakerNames?: SpeakerNames;
  /** Characters of transcript sent to the model. Default 120k (~30k tokens, ~2.5 h of talk). */
  maxTranscriptChars?: number;
  now?: () => Date;
}

export const MeetingProtocolSchema = z.object({
  title: z.string(),
  executive_summary: z.string(),
  topics: z.array(
    z.object({ title: z.string(), summary: z.string(), start_sec: z.number().nullable() }),
  ),
  decisions: z.array(z.string()),
  risks: z.array(z.string()),
  action_items: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      assignee: z.string(),
      priority: z.enum(PRIORITIES),
      due_date: z.string().nullable(),
      source_timestamp_sec: z.number().nullable(),
      timeframe: z.string().nullish(),
      context: z.string().nullish(),
    }),
  ),
});
export type MeetingProtocol = z.infer<typeof MeetingProtocolSchema>;

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const isTranscriptFile = (input: RawIngestInput) =>
  !!input.fileBuffer &&
  (input.mimeType?.toLowerCase() === "application/json" ||
    ["json", "txt", "vtt"].includes(fileExtension(input) ?? ""));

/** Day of the meeting as the user reads it: "24.10.2026" in German, the ISO day in English. */
const deDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return getLocale() === "de" ? `${d}.${m}.${y}` : `${y}-${m}-${d}`;
};

/** Transcript sections for RAG: one per topic (by start time), else 5-minute windows. */
export function transcriptSections(
  segments: readonly MeetingSegment[],
  topics: ReadonlyArray<{ title: string; start_sec: number | null }>,
  windowSec = 300,
): Array<{ title: string; startSec: number; lines: string[] }> {
  const starts = topics
    .filter(
      (t): t is { title: string; start_sec: number } =>
        typeof t.start_sec === "number" && t.start_sec >= 0,
    )
    .sort((a, b) => a.start_sec - b.start_sec);
  let bounds: Array<{ title: string; startSec: number }>;
  if (starts.length > 0) {
    bounds = [];
    for (const t of starts) {
      if (bounds.at(-1)?.startSec !== t.start_sec)
        bounds.push({ title: t.title, startSec: t.start_sec });
    }
    if ((bounds[0]?.startSec ?? 0) > 0) bounds.unshift({ title: ph("intro"), startSec: 0 });
  } else {
    const end = Math.max(0, ...segments.map((s) => s.endSec));
    bounds = Array.from({ length: Math.max(1, Math.ceil(end / windowSec)) }, (_, i) => ({
      title: `${ph("section")} ${formatTimestamp(i * windowSec)}`,
      startSec: i * windowSec,
    }));
  }
  const sections = bounds.map((b) => ({ ...b, lines: [] as string[] }));
  for (const s of segments) {
    let idx = 0;
    for (let i = 0; i < sections.length; i++)
      if ((sections[i]?.startSec ?? 0) <= s.startSec) idx = i;
    sections[idx]?.lines.push(formatTranscriptLine(s));
  }
  return sections.filter((s) => s.lines.length > 0);
}

export function renderMeetingMarkdown(
  t: MeetingTranscript,
  protocol: MeetingProtocol | null,
  actionItems: readonly ExtractedActionItem[],
  meta: { title: string; date: string },
): string {
  const facts = [
    `Meeting · ${deDate(meta.date)}`,
    t.durationSec ? `${ph("duration")} ${formatTimestamp(t.durationSec)}` : null,
    t.speakers.length ? `${ph("participants")}: ${t.speakers.join(", ")}` : null,
  ].filter(Boolean);
  const list = (items: readonly string[]) => items.map((i) => `- ${i.trim()}`);
  // Empty sections are left out (no "- Keine").
  const section = (title: string, items: readonly string[]) => {
    if (items.length) md.push(`## ${title}`, "", ...list(items), "");
  };
  const md: string[] = [`# ${meta.title}`, "", `> ${facts.join(" · ")}`, ""];
  if (protocol) {
    md.push(`## ${ph("executiveSummary")}`, "", protocol.executive_summary.trim(), "");
    if (protocol.topics.length) md.push(`## ${ph("topicsDiscussed")}`, "");
    protocol.topics.forEach((topic, i) => {
      const at =
        typeof topic.start_sec === "number" ? ` [${formatTimestamp(topic.start_sec)}]` : "";
      md.push(`### ${i + 1}. ${topic.title}${at}`, "", topic.summary.trim(), "");
    });
    section(ph("decisionsMade"), protocol.decisions);
    section(ph("openRisks"), protocol.risks);
    if (actionItems.length) md.push(`## ${ph("extractedActionItems")}`, "");
    for (const a of actionItems) {
      const due = a.due_date ? ` (Due: ${a.due_date.slice(0, 10)})` : "";
      const at =
        a.source_timestamp_sec !== null ? ` · [${formatTimestamp(a.source_timestamp_sec)}]` : "";
      const tf = timeframeLabel(a.timeframe);
      const extra = `${tf ? ` · ${ph("timeframe")}: ${tf}` : ""}${a.context ? ` · ${ph("context")}: ${a.context}` : ""}`;
      md.push(`- [ ] @${a.assignee}: ${a.title}${due}${at}${extra}`);
    }
    if (actionItems.length) md.push("");
  } else {
    md.push(`> ${ph("minutesFailed")}`, "");
  }
  // One paragraph per line: quoted consecutive lines would otherwise merge into one.
  md.push(...transcriptToggleLines(t.segments.flatMap((seg) => [formatTranscriptLine(seg), ""])));
  return md.join("\n").trim();
}

export function createMeetingAdapter(options: MeetingAdapterOptions = {}): IngestionAdapter {
  const names = options.speakerNames ?? {};
  // Read per call, not here: the adapter is built once and serves users of both languages.
  const selfName = () => names.channels?.[0] ?? names.self ?? ph("me");
  const maxChars = options.maxTranscriptChars ?? 120_000;

  return {
    id: ID,
    canHandle(input: RawIngestInput) {
      if (input.url) return false;
      if (input.typeHint === "meeting") return !!input.rawText?.trim() || isTranscriptFile(input);
      if (input.rawText) return looksLikeMeetingTranscript(input.rawText);
      if (isTranscriptFile(input))
        return looksLikeMeetingTranscript(
          decode((input.fileBuffer as Uint8Array).slice(0, 20_000)),
        );
      return false;
    },

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const text = input.rawText ?? decode(input.fileBuffer as Uint8Array);
      const self = selfName();
      let transcript: MeetingTranscript;
      try {
        transcript = parseMeetingTranscript(text, names);
      } catch (err) {
        if (err instanceof TranscriptFormatError)
          throw new ExtractionError(ID, err.message, { cause: err });
        throw err;
      }
      const date = transcript.startedAt ?? (options.now?.() ?? new Date()).toISOString();
      const warnings: string[] = [];

      let protocol: MeetingProtocol | null = null;
      if (options.models) {
        const lines = transcript.segments.map(formatTranscriptLine).join("\n");
        const truncated = lines.length > maxChars;
        try {
          const { output } = await generateText({
            model: modelFor(options.models, "meeting_coach"),
            system: renderMeetingPrompt(self, date.slice(0, 10)),
            prompt: `${byLocale({
              en: `Meeting on ${date.slice(0, 10)}, participants: ${transcript.speakers.join(", ")}${truncated ? " (transcript shortened)" : ""}`,
              de: `Meeting vom ${date.slice(0, 10)}, Teilnehmer: ${transcript.speakers.join(", ")}${truncated ? " (Transkript gekürzt)" : ""}`,
            })}\n\n${truncated ? lines.slice(0, maxChars) : lines}`,
            output: Output.object({ schema: MeetingProtocolSchema, name: "meeting_protocol" }),
            temperature: 0.2,
          });
          protocol = output;
        } catch (err) {
          warnings.push(`protocol failed: ${errorMessage(err)}`);
        }
      }

      const actionItems: ExtractedActionItem[] = normalizeActionItems(
        protocol?.action_items ?? [],
      ).map((a) => ({
        ...a,
        assignee:
          /^(ich|me|mir|user|nutzer)$/i.test(a.assignee) ||
          phForms("me").some((f) => f.toLowerCase() === a.assignee.trim().toLowerCase())
            ? self
            : a.assignee,
        source_timestamp_sec:
          a.source_timestamp_sec !== null && a.source_timestamp_sec <= transcript.durationSec + 1
            ? a.source_timestamp_sec
            : null,
      }));
      const title = transcript.title?.trim() || protocol?.title.trim() || `Meeting ${deDate(date)}`;
      const contentMd = renderMeetingMarkdown(transcript, protocol, actionItems, { title, date });

      const structuralChunks: StructuralChunk[] = [];
      if (protocol) {
        structuralChunks.push({
          heading: ph("minutes"),
          text: [
            protocol.executive_summary,
            ...protocol.decisions.map((d) => `${ph("decision")}: ${d}`),
            ...protocol.risks.map((r) => `${ph("risk")}: ${r}`),
            ...actionItems.map((a) => `${ph("task")} (${a.assignee}): ${a.title}`),
          ].join("\n"),
        });
      }
      for (const s of transcriptSections(transcript.segments, protocol?.topics ?? [])) {
        structuralChunks.push({
          heading: s.title,
          pageOrTimestamp: formatTimestamp(s.startSec),
          text: s.lines.join("\n"),
        });
      }

      return {
        type: "meeting",
        sourcePlatform: transcript.platform ?? "kortex_desktop",
        titleHint: title,
        contentMd,
        structuralChunks,
        actionItems: protocol ? actionItems : undefined,
        metadata: {
          started_at: transcript.startedAt ?? null,
          duration_sec: Math.round(transcript.durationSec),
          participants: transcript.speakers,
          channels: [...new Set(transcript.segments.map((s) => s.channel))].sort(),
          transcript_format: transcript.format,
          segment_count: transcript.segments.length,
          topics: protocol?.topics ?? [],
          decisions: protocol?.decisions ?? [],
          risks: protocol?.risks ?? [],
          protocol_model:
            protocol && options.models ? modelIdFor(options.models, "meeting_coach") : null,
          warnings: warnings.length ? warnings : undefined,
        },
      };
    },
  };
}
