import { byLocale, ph } from "../i18n";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { ClientTranscript, StructuralChunk } from "../adapters/base-adapter";
import type { TranscriptSegment } from "../audio/transcriber";
import { errorMessage } from "../errors";
import { modelFor, type ModelRouter } from "../router/model-router";
import { formatTimestamp } from "../adapters/youtube.adapter";
import { transcriptToggleLines } from "../util/transcript-toggle";

/*
 * Structured notes for long-form media (YouTube, podcasts, other videos): one routed `summarize`
 * call returns JSON (schema below), the Markdown is rendered here in code so every note has the
 * same shape: summary, Kernpunkte, Learnings, chapters with jump links, real quotes, mentioned
 * resources, then the timestamped transcript as a folded toggle at the very end.
 * Entities, tags and action items come from the auto-organizer afterwards, as for every item.
 */

export const MediaNotesSchema = z.object({
  summary: z.string(),
  // The model copies the "[mm:ss]" stamp as text; code turns it into seconds (models mix up minutes and seconds in numbers).
  chapters: z.array(
    z.object({ title: z.string(), start_sec: z.union([z.number(), z.string()]).nullable() }),
  ),
  key_takeaways: z.array(z.string()),
  /** Actionable learnings: what to apply or do differently after watching/listening. */
  learnings: z.array(z.string()),
  quotes: z.array(
    z.object({
      text: z.string(),
      speaker: z.string().nullable(),
      time_sec: z.union([z.number(), z.string()]).nullable(),
    }),
  ),
  resources: z.array(z.string()),
});
export type MediaNotes = Omit<z.infer<typeof MediaNotesSchema>, "chapters" | "quotes"> & {
  chapters: { title: string; start_sec: number | null }[];
  quotes: { text: string; speaker: string | null; time_sec: number | null }[];
};
type RawMediaNotes = z.infer<typeof MediaNotesSchema>;

/** "mm:ss" / "h:mm:ss" text → seconds; plain numbers are seconds already. Anything else: null. */
export function stampToSec(v: number | string | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/^\[|\]$/g, "");
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?:\.\d+)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Transcript text sent to the model (≈ 15k tokens); longer ones are condensed evenly. */
/** Longest source description kept in a note without model notes. */
export const DESCRIPTION_CHARS = 600;

export const NOTES_TRANSCRIPT_CHARS = 60_000;

/** Upper bounds per list, applied in code (the prompt asks for less; models sometimes overshoot). */
export const NOTES_LIMITS = {
  chapters: 12,
  key_takeaways: 8,
  learnings: 6,
  quotes: 5,
  resources: 15,
} as const;

const PROMPT_EN = `You write structured notes on a video or podcast for the Second Brain Kortex.
Deliver JSON:
- "summary": executive summary in 3-5 sentences: what it is about, what the core message is, who it is relevant for.
- "chapters": 3-10 thematic chapters in chronological order { "title", "start_sec" } with start_sec as text: the [mm:ss] timestamp (or h:mm:ss) exactly as in the transcript, e.g. "02:15", otherwise null.
- "key_takeaways": 4-8 key points: the most important statements of the content (one sentence each, concrete, no empty phrases).
- "learnings": 2-5 actionable learnings: what one can concretely apply, change or try (one sentence each, phrased as a clear action). No repetition of the key points.
- "quotes": 2-5 striking verbatim quotes from the transcript { "text", "speaker" (or null), "time_sec" (timestamp as text as in the transcript, or null) }. Real quotes only.
- "resources": books, tools, companies, people, links that are mentioned.
Plain running text in the strings only, no Markdown. Cuts in the transcript are marked with […].
Language of the content, default English. Without a transcript work from title and description only: short summary, empty quotes and learnings, chapters only from the description.`;

const PROMPT_DE = `Du schreibst strukturierte Notizen zu einem Video oder Podcast für das Second Brain Kortex.
Liefere JSON:
- "summary": Executive Summary in 3-5 Sätzen: Worum geht es, was ist die Kernaussage, für wen relevant.
- "chapters": 3-10 thematische Kapitel in zeitlicher Reihenfolge { "title", "start_sec" } mit start_sec als Text: der [mm:ss]-Zeitstempel (oder h:mm:ss) exakt wie im Transkript, z. B. "02:15", sonst null.
- "key_takeaways": 4-8 Kernpunkte: die wichtigsten inhaltlichen Aussagen (je ein Satz, konkret, keine Floskeln).
- "learnings": 2-5 umsetzbare Learnings: was man konkret anwenden, ändern oder ausprobieren kann (je ein Satz, als klare Handlung formuliert). Keine Wiederholung der Kernpunkte.
- "quotes": 2-5 prägnante wörtliche Zitate aus dem Transkript { "text", "speaker" (oder null), "time_sec" (Zeitstempel als Text wie im Transkript, oder null) }. Nur echte Zitate.
- "resources": erwähnte Bücher, Tools, Firmen, Personen, Links.
Nur Fließtext in den Strings, kein Markdown. Kürzungen im Transkript sind mit […] markiert.
Sprache des Inhalts, Standard Deutsch. Ohne Transkript nur aus Titel und Beschreibung arbeiten: kurze Summary, leere Zitate und Learnings, Kapitel nur aus der Beschreibung.`;

/** Display stamp: mm:ss or h:mm:ss (chunks keep the hh:mm:ss form of formatTimestamp). */
export const clockStamp = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

/** Segments from a client transcript (its own timing, or one block without). */
export function clientSegments(t: ClientTranscript | undefined): TranscriptSegment[] {
  if (!t) return [];
  const segs = (t.segments ?? [])
    .filter((s) => Number.isFinite(s.start) && s.text?.trim())
    .map((s) => ({
      startSec: Math.max(0, s.start),
      ...(s.dur !== undefined ? { endSec: Math.max(0, s.start) + Math.max(0, s.dur) } : {}),
      text: s.text.replace(/\s+/g, " ").trim(),
    }));
  if (segs.length) return segs;
  const text = t.text?.trim();
  return text ? [{ startSec: 0, text }] : [];
}

const STAMP = /^\[[\d:]+\]\s*/;

/** Cuts at a word boundary and marks the cut. */
const clip = (t: string, max: number): string => {
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(" ", max - 4);
  return `${t.slice(0, cut > max * 0.6 ? cut : max - 4).trimEnd()} […]`;
};

/**
 * Transcript for the one notes call, under the char budget. Short ones go in verbatim. Long ones
 * are condensed so every part of the episode stays represented (no hour-long holes): each line, or
 * each group of neighbouring lines (one timestamp per group), keeps its opening words up to an
 * equal share of the budget. Start, middle and end survive; chapters keep usable timestamps.
 */
export function sampleLines(
  lines: readonly string[],
  budget = NOTES_TRANSCRIPT_CHARS,
): { text: string; cut: boolean } {
  const full = lines.join("\n");
  if (full.length <= budget) return { text: full, cut: false };
  // Lines per group so that each group keeps at least ~240 chars of text.
  const perGroup = Math.max(1, Math.ceil((240 * lines.length) / budget));
  const groups: string[] = [];
  for (let i = 0; i < lines.length; i += perGroup) {
    const slice = lines.slice(i, i + perGroup);
    const stamp = STAMP.exec(slice[0]!)?.[0] ?? "";
    groups.push(stamp + slice.map((l) => l.replace(STAMP, "")).join(" "));
  }
  const share = Math.max(40, Math.floor(budget / groups.length) - 1);
  return { text: groups.map((g) => clip(g, share)).join("\n").slice(0, budget), cut: true };
}

const cleanItem = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^(?:[-*•]|\d+[.)])\s+/, "") // list markers the model sometimes adds
    .trim();

/** Trims, de-duplicates and caps every list: the same shape for every note. */
export function normalizeMediaNotes(n: RawMediaNotes): MediaNotes {
  const list = (items: readonly string[], max: number, skip: readonly string[] = []) => {
    const seen = new Set(skip.map((s) => s.toLowerCase()));
    const out: string[] = [];
    for (const raw of items) {
      const t = cleanItem(raw);
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
      if (out.length === max) break;
    }
    return out;
  };
  const takeaways = list(n.key_takeaways, NOTES_LIMITS.key_takeaways);
  return {
    summary: n.summary.replace(/[ \t]+/g, " ").trim(),
    chapters: n.chapters
      .map((c) => ({ title: cleanItem(c.title), start_sec: stampToSec(c.start_sec) }))
      .filter((c) => c.title)
      .slice(0, NOTES_LIMITS.chapters),
    key_takeaways: takeaways,
    // A learning that only repeats a Kernpunkt is dropped.
    learnings: list(n.learnings, NOTES_LIMITS.learnings, takeaways),
    quotes: n.quotes
      .map((q) => ({
        text: q.text
          .replace(/\s+/g, " ")
          .replace(/^["„“”']+|["„“”']+$/g, "")
          .trim(),
        speaker: q.speaker?.trim() || null,
        time_sec: stampToSec(q.time_sec),
      }))
      .filter((q) => q.text)
      .slice(0, NOTES_LIMITS.quotes),
    resources: list(n.resources, NOTES_LIMITS.resources),
  };
}

export async function generateMediaNotes(
  models: ModelRouter,
  input: {
    kind: "video" | "podcast" | "audio";
    title: string;
    channel?: string;
    description?: string;
    lines: readonly string[];
  },
  warnings: string[],
): Promise<MediaNotes | null> {
  const { text, cut } = sampleLines(input.lines);
  try {
    const { output } = await generateText({
      model: modelFor(models, "summarize"),
      system: byLocale({ en: PROMPT_EN, de: PROMPT_DE }),
      prompt: byLocale({
        en: [
          `Kind: ${input.kind === "video" ? "Video" : "Podcast/Audio"}`,
          `Title: ${input.title}`,
          `Channel/Show: ${input.channel ?? "(unknown)"}`,
          `Description: ${input.description?.slice(0, 5000) ?? "(none)"}`,
          `Transcript${cut ? " (shortened evenly, every section sampled)" : ""}:\n${text || "(none)"}`,
        ],
        de: [
          `Art: ${input.kind === "video" ? "Video" : "Podcast/Audio"}`,
          `Titel: ${input.title}`,
          `Kanal/Show: ${input.channel ?? "(unbekannt)"}`,
          `Beschreibung: ${input.description?.slice(0, 5000) ?? "(keine)"}`,
          `Transkript${cut ? " (gleichmäßig gekürzt, jeder Abschnitt angerissen)" : ""}:\n${text || "(keins)"}`,
        ],
      }).join("\n\n"),
      output: Output.object({ schema: MediaNotesSchema, name: "media_notes" }),
      temperature: 0.2,
    });
    const notes = normalizeMediaNotes(output);
    // Without a transcript there is nothing to quote from.
    return input.lines.length ? notes : { ...notes, quotes: [] };
  } catch (err) {
    warnings.push(`notes: ${errorMessage(err)}`);
    return null;
  }
}

export interface MediaNoteInput {
  title: string;
  /** Short facts line under the title ("Kanal: … · Dauer: … · [Auf YouTube ansehen](…)"). */
  facts: string[];
  /** Jump link for a position, or null when the source has none. */
  jump: (sec: number) => string | null;
  notes: MediaNotes | null;
  /** Chapters given by the source itself (YouTube description); win over the model's. */
  sourceChapters?: { title: string; startSec: number }[];
  description?: string;
  segments: readonly TranscriptSegment[];
  /** Transcript section windows when there are no chapters (seconds). */
  windowSec?: number;
  /** Shown under the facts (e.g. why there is no transcript and what helps). */
  notice?: string;
  /** Transcript lines get their own timestamp when this far apart (seconds, default 30). */
  lineSec?: number;
}

/** Caption segments → readable lines of ~lineSec; a speaker change starts a new line. */
export function groupLines(
  segments: readonly TranscriptSegment[],
  lineSec = 30,
): { start: number; text: string }[] {
  const out: { start: number; speaker?: string; parts: string[] }[] = [];
  for (const s of segments) {
    const cur = out.at(-1);
    if (!cur || cur.speaker !== s.speaker || s.startSec - cur.start >= lineSec)
      out.push({
        start: s.startSec,
        ...(s.speaker ? { speaker: s.speaker } : {}),
        parts: [s.text],
      });
    else cur.parts.push(s.text);
  }
  return out.map((l) => ({
    start: l.start,
    text: `${l.speaker ? `${l.speaker}: ` : ""}${l.parts.join(" ")}`,
  }));
}

const stamp = (sec: number, jump: MediaNoteInput["jump"]) => {
  const t = clockStamp(sec);
  const href = jump(sec);
  return href ? `[${t}](${href})` : `[${t}]`;
};

/** Markdown (clean, portable) and transcript chunks per chapter with their start timestamp. */
export function renderMediaNote(o: MediaNoteInput): {
  contentMd: string;
  chunks: StructuralChunk[];
  chapters: { title: string; start_sec: number }[];
} {
  const md: string[] = [`# ${o.title}`, ""];
  if (o.facts.length) md.push(`> ${o.facts.join(" · ")}`, "");
  if (o.notice) md.push(`> ${o.notice}`, "");

  // Chapters beyond the end of the transcript are a unit mix-up of the model: dropped.
  const lastSeg = o.segments.at(-1);
  const endSec = lastSeg ? (lastSeg.endSec ?? lastSeg.startSec) : Infinity;
  const modelChapters = (o.notes?.chapters ?? [])
    .filter(
      (c): c is { title: string; start_sec: number } =>
        c.start_sec !== null && c.start_sec >= 0 && c.start_sec <= endSec,
    )
    .sort((a, b) => a.start_sec - b.start_sec);
  const chapters = o.sourceChapters?.length
    ? o.sourceChapters.map((c) => ({ title: c.title, start_sec: c.startSec }))
    : modelChapters;

  // Synthesis first (what you read), then sources, then the transcript.
  if (o.notes?.summary.trim()) md.push(`## ${ph("executiveSummary")}`, "", o.notes.summary.trim(), "");
  if (o.notes?.key_takeaways.length)
    md.push(`## ${ph("keyPoints")}`, "", ...o.notes.key_takeaways.map((k) => `- ${k}`), "");
  if (o.notes?.learnings.length)
    md.push(`## ${ph("learnings")}`, "", ...o.notes.learnings.map((l) => `- ${l}`), "");
  if (chapters.length)
    md.push(
      `## ${ph("chapters")}`,
      "",
      ...chapters.map((c) => `- ${stamp(c.start_sec, o.jump)} ${c.title}`),
      "",
    );
  if (o.notes?.quotes.length) {
    md.push(`## ${ph("quotes")}`, "");
    const [open, close] = byLocale({ en: ["“", "”"], de: ["„", "“"] });
    for (const q of o.notes.quotes) {
      const who = [q.speaker, q.time_sec !== null ? stamp(q.time_sec, o.jump) : null]
        .filter(Boolean)
        .join(" ");
      md.push(`> ${open}${q.text.trim()}${close}${who ? ` — ${who}` : ""}`, "");
    }
  }
  if (o.notes?.resources.length)
    md.push(`## ${ph("resourcesMentioned")}`, "", ...o.notes.resources.map((r) => `- ${r}`), "");
  // The source description (YouTube: links, sponsors, hashtags) is only a fallback when there are no notes.
  const description = o.notes ? "" : clip(o.description?.trim() ?? "", DESCRIPTION_CHARS);
  if (description) md.push(`## ${ph("description")}`, "", description, "");

  const chunks: StructuralChunk[] = [];
  if (o.notes)
    chunks.push({
      heading: ph("executiveSummary"),
      text: [o.notes.summary, ...o.notes.key_takeaways, ...o.notes.learnings].join("\n"),
    });
  if (o.description?.trim())
    chunks.push({ heading: ph("description"), text: clip(o.description.trim(), 2000) });
  if (o.segments.length) {
    const last = o.segments.at(-1)!;
    const end = last.endSec ?? last.startSec;
    const win = o.windowSec ?? 300;
    const windows = chapters.length
      ? chapters.map((c) => ({ title: c.title, start: c.start_sec }))
      : Array.from({ length: Math.max(1, Math.ceil(end / win)) }, (_, i) => ({
          title: `${ph("section")} ${clockStamp(i * win)}`,
          start: i * win,
        }));
    if ((windows[0]?.start ?? 0) > 0) windows.unshift({ title: ph("intro"), start: 0 });
    // Full timestamped transcript, folded at the very end of the note.
    const tr: string[] = [];
    windows.forEach((w, i) => {
      const stop = windows[i + 1]?.start ?? Infinity;
      const lines = groupLines(
        o.segments.filter((s) => s.startSec >= w.start && s.startSec < stop),
        o.lineSec ?? 30,
      );
      if (!lines.length) return;
      tr.push(`### ${stamp(w.start, o.jump)} ${w.title}`, "");
      for (const l of lines) tr.push(`${stamp(l.start, o.jump)} ${l.text}`, "");
      chunks.push({
        heading: w.title,
        pageOrTimestamp: formatTimestamp(w.start),
        text: lines.map((l) => `[${formatTimestamp(l.start)}] ${l.text}`).join("\n"),
      });
    });
    md.push(...transcriptToggleLines(tr), "");
  }
  return { contentMd: md.join("\n").trim(), chunks, chapters };
}

/** "[mm:ss] text" lines for the model (timestamps let it place chapters). */
export const timedLines = (segments: readonly TranscriptSegment[]) =>
  segments.map((s) => `[${clockStamp(s.startSec)}] ${s.speaker ? `${s.speaker}: ` : ""}${s.text}`);
