import { generateText, streamText } from "ai";
import {
  formatTranscriptLine,
  lastMinutes,
  parseMeetingTranscript,
  type MeetingSegment,
  type SpeakerNames,
} from "../audio/meeting-transcript";
import { byLocale } from "../i18n";
import { DEFAULT_COACH_ROLE, defaultCoachSelf, renderLiveCoachPrompt } from "../prompts/coaching";
import type { ModelRouter } from "../router/model-router";
import { formatTimestamp } from "../adapters/youtube.adapter";
import { modelFor, type LanguageTask } from "../router/model-router";

// "Live Insight / Coaching" button of the desktop HUD: last N minutes of the 2-channel
// transcript + hybrid-search snippets → max. 3 scannable bullets. Models come from the
// ModelRouter, so every call carries data_collection: 'deny'.

export interface CoachingSnippet {
  title: string;
  type?: string;
  text: string;
  /** "Page 12", "00:05:12" … */
  page_or_timestamp?: string | null;
  item_id?: string;
}

export interface CoachingTask {
  title: string;
  assignee?: string | null;
  due_date?: string | null;
}

export interface CoachingInput {
  /** Raw transcript in any format `parseMeetingTranscript` accepts, or parsed segments. */
  transcript: string | unknown | MeetingSegment[];
  /** Minutes of conversation to look at. Default 5. */
  windowMinutes?: number;
  /** Transcript second the window ends at. Default: the latest segment. */
  untilSec?: number;
  /** Results of `match_knowledge_hybrid` for the current topic (max 8 are used). */
  snippets?: readonly CoachingSnippet[];
  openTasks?: readonly CoachingTask[];
  /** Name for channel 0. Default "Ich" (spec 5.2). */
  selfName?: string;
  selfRole?: string;
  speakerNames?: SpeakerNames;
}

export interface CoachingOptions {
  models: ModelRouter;
  /** Routed task whose model answers. Default `meeting_coach` (ADR-06). */
  task?: LanguageTask;
  abortSignal?: AbortSignal;
}

const MAX_SNIPPET_CHARS = 1_200;

const isSegments = (v: unknown): v is MeetingSegment[] =>
  Array.isArray(v) &&
  v.every((s) => typeof s === "object" && s !== null && "speaker" in s && "startSec" in s);

export function buildCoachingPrompt(input: CoachingInput): {
  system: string;
  prompt: string;
  window: MeetingSegment[];
} {
  const self = input.selfName ?? defaultCoachSelf();
  const names: SpeakerNames = { self, ...input.speakerNames };
  const segments = isSegments(input.transcript)
    ? input.transcript
    : parseMeetingTranscript(input.transcript, names).segments;
  const window = lastMinutes(segments, input.windowMinutes ?? 5, input.untilSec);
  const snippets = (input.snippets ?? []).slice(0, 8).map((s, i) => {
    const where = [s.type, s.page_or_timestamp].filter(Boolean).join(" · ");
    return `[${i + 1}] ${s.title}${where ? ` (${where})` : ""}\n${s.text.replace(/\s+/g, " ").slice(0, MAX_SNIPPET_CHARS)}`;
  });
  const tasks = (input.openTasks ?? []).slice(0, 15).map((t) => {
    const extra = [
      t.assignee,
      t.due_date ? `${byLocale({ en: "due", de: "fällig" })} ${t.due_date.slice(0, 10)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `- ${t.title}${extra ? ` (${extra})` : ""}`;
  });
  const from = window[0]?.startSec ?? 0;
  const to = window.at(-1)?.endSec ?? 0;
  const prompt = byLocale({
    en: [
      `Transcript of the last minutes (${formatTimestamp(from)}–${formatTimestamp(to)}):`,
      window.map(formatTranscriptLine).join("\n") || "(nothing said yet)",
      "",
      "Relevant excerpts from the Second Brain:",
      snippets.join("\n\n") || "(none)",
      "",
      "Open tasks:",
      tasks.join("\n") || "(none)",
    ],
    de: [
      `Transkript der letzten Minuten (${formatTimestamp(from)}–${formatTimestamp(to)}):`,
      window.map(formatTranscriptLine).join("\n") || "(noch nichts gesagt)",
      "",
      "Relevante Auszüge aus dem Second Brain:",
      snippets.join("\n\n") || "(keine)",
      "",
      "Offene Tasks:",
      tasks.join("\n") || "(keine)",
    ],
  }).join("\n");
  return {
    system: renderLiveCoachPrompt(self, input.selfRole ?? DEFAULT_COACH_ROLE),
    prompt,
    window,
  };
}

/** Streams the coaching text (pipe `result.textStream` or `result.toTextStreamResponse()` to the HUD). */
export function streamCoaching(input: CoachingInput, options: CoachingOptions) {
  const { system, prompt } = buildCoachingPrompt(input);
  return streamText({
    model: modelFor(options.models, options.task ?? "meeting_coach"),
    system,
    prompt,
    temperature: 0.3,
    maxOutputTokens: 400,
    abortSignal: options.abortSignal,
  });
}

/** Splits the model answer into at most 3 bullets (strips list markers, keeps **bold** labels). */
export function parseCoachingBullets(text: string): string[] {
  const bullets: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m?.[1]) bullets.push(m[1].trim());
    else if (bullets.length > 0) bullets[bullets.length - 1] += ` ${line}`;
    else bullets.push(line);
  }
  return bullets.slice(0, 3);
}

/** Non-streaming variant: returns the parsed bullets. */
export async function generateCoaching(
  input: CoachingInput,
  options: CoachingOptions,
): Promise<{ bullets: string[]; text: string }> {
  const { system, prompt } = buildCoachingPrompt(input);
  const { text } = await generateText({
    model: modelFor(options.models, options.task ?? "meeting_coach"),
    system,
    prompt,
    temperature: 0.3,
    maxOutputTokens: 400,
    abortSignal: options.abortSignal,
  });
  return { bullets: parseCoachingBullets(text), text };
}
