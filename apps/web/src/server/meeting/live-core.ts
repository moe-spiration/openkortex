import { t } from "@/i18n";
import { z } from "zod";

/*
 * Live meeting session (W1/H1, docs/plans/2026-10-30-meeting-capture.md): the session is the
 * meeting item itself. The transcript grows as Markdown lines in content_md, everything live lives
 * in metadata.live. Pure helpers here (tested without a DB); handlers in ./live.ts.
 */

/** Channel names in the transcript (same as the desktop's record-then-upload, upload.rs). */
export const CHANNEL_NAMES = ["Ich", "Gesprächspartner"] as const;

/** A live session counts as running while the desktop wrote within this window. */
export const LIVE_STALE_MS = 3 * 60_000;
/** Transcript lines the web card / GET returns. */
export const TAIL_LINES = 8;
export const MAX_TRANSCRIPT_CHARS = 400_000;
const MAX_CLIPS = 200;

export type CoachKind = "fact" | "question" | "action";

export interface CoachCard {
  kind: CoachKind;
  text: string;
}

export interface LiveClip {
  id: string;
  at_sec: number;
  text: string;
  source: "desktop" | "web";
  created_at: string;
}

export interface LiveMeta {
  state: "recording" | "ended";
  started_at: string;
  updated_at: string;
  ended_at?: string | null;
  /** Transcript lines so far and the last transcript second. */
  segments: number;
  last_sec: number;
  clips: LiveClip[];
  cards: CoachCard[];
  coached_at?: string | null;
  /** `segments` at the last coaching run (no new text = no new run). */
  coached_segments?: number;
  /** Who transcribes live ("edenai:…", "deepgram"); shown in the HUD. */
  transcriber?: string | null;
}

export interface TranscriptLine {
  ts: string;
  sec: number;
  channel: 0 | 1;
  who: string;
  text: string;
}

/** What GET /api/meeting/live returns to the web card. */
export interface LiveSession {
  item_id: string;
  title: string;
  state: LiveMeta["state"];
  started_at: string;
  updated_at: string;
  segments: number;
  last_sec: number;
  tail: TranscriptLine[];
  clips: LiveClip[];
  cards: CoachCard[];
  transcriber: string | null;
}

// --- request bodies -------------------------------------------------------------------------

const ClientSchema = z.object({ name: z.string().max(60), version: z.string().max(30).optional() }).nullish();
const ItemId = z.string().uuid();
const Seconds = z.number().finite().min(0).max(24 * 3600);

export const SegmentSchema = z.object({
  channel: z.union([z.literal(0), z.literal(1)]),
  start_sec: Seconds,
  text: z.string().max(8_000),
});
export type LiveSegment = z.infer<typeof SegmentSchema>;

export const LiveActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    title: z.string().trim().min(1).max(200).nullish(),
    started_at: z.iso.datetime({ offset: true }).nullish(),
    transcriber: z.string().max(80).nullish(),
    client: ClientSchema,
  }),
  z.object({
    action: z.literal("append"),
    item_id: ItemId,
    segments: z.array(SegmentSchema).max(200),
    transcriber: z.string().max(80).nullish(),
  }),
  z.object({
    action: z.literal("clip"),
    item_id: ItemId,
    at_sec: Seconds.nullish(),
    text: z.string().trim().max(500).nullish(),
    source: z.enum(["desktop", "web"]).default("web"),
  }),
  z.object({
    action: z.literal("task"),
    item_id: ItemId,
    title: z.string().trim().min(1).max(300),
    at_sec: Seconds.nullish(),
  }),
  z.object({
    action: z.literal("end"),
    item_id: ItemId,
    /** Full transcript after a failed live transcription (desktop re-transcribed the WAV). */
    transcript: z.string().max(MAX_TRANSCRIPT_CHARS).nullish(),
  }),
  /** The user threw the recording away (desktop HUD "Discard"): the running session's item goes. */
  z.object({
    action: z.literal("discard"),
    item_id: ItemId,
  }),
]);
export type LiveAction = z.infer<typeof LiveActionSchema>;

export const CoachRequestSchema = z.object({ item_id: ItemId, window_minutes: z.number().min(1).max(30).optional() });

// --- transcript -----------------------------------------------------------------------------

export function hhmmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

/** `[hh:mm:ss] Ich: text` lines (the meeting adapter's plain-text transcript format). */
export function formatSegments(segments: readonly LiveSegment[]): string[] {
  return [...segments]
    .filter((s) => s.text.trim())
    .sort((a, b) => a.start_sec - b.start_sec || a.channel - b.channel)
    .map((s) => `[${hhmmss(s.start_sec)}] ${CHANNEL_NAMES[s.channel]}: ${s.text.replace(/\s+/g, " ").trim()}`);
}

const LINE = /^\[(\d{1,2}):(\d{2}):(\d{2})\]\s+([^:]+):\s*(.*)$/;

export function parseLines(content: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const raw of content.split("\n")) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const who = m[4]!.trim();
    out.push({ ts: hhmmss(sec), sec, channel: who === CHANNEL_NAMES[0] ? 0 : 1, who, text: m[5]!.trim() });
  }
  return out;
}

/** Appends new lines to the stored transcript (one line each, no blank lines in between). */
export function appendTranscript(content: string | null | undefined, lines: readonly string[]): string {
  const base = (content ?? "").replace(/\s+$/, "");
  if (lines.length === 0) return base;
  return (base ? `${base}\n` : "") + lines.join("\n");
}

/** Raw text for the meeting adapter: marked moments first, then the transcript. */
export function finalTranscript(transcript: string, clips: readonly LiveClip[]): string {
  const marked = [...clips]
    .sort((a, b) => a.at_sec - b.at_sec)
    .map((c) => `- [${hhmmss(c.at_sec)}] ${c.text || t("Marked moment")}`);
  return [marked.length ? `## ${t("Marked moments")}\n\n${marked.join("\n")}` : null, transcript.trim()]
    .filter(Boolean)
    .join("\n\n");
}

// --- metadata -------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** metadata.live of an item, or null when it is not a live session. */
export function liveMetaOf(metadata: unknown): LiveMeta | null {
  const live = isObj(metadata) ? metadata.live : null;
  if (!isObj(live) || (live.state !== "recording" && live.state !== "ended")) return null;
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    state: live.state,
    started_at: str(live.started_at),
    updated_at: str(live.updated_at, str(live.started_at)),
    ended_at: typeof live.ended_at === "string" ? live.ended_at : null,
    segments: num(live.segments),
    last_sec: num(live.last_sec),
    clips: Array.isArray(live.clips) ? (live.clips.filter(isObj) as unknown as LiveClip[]) : [],
    cards: Array.isArray(live.cards) ? (live.cards.filter(isObj) as unknown as CoachCard[]) : [],
    coached_at: typeof live.coached_at === "string" ? live.coached_at : null,
    coached_segments: num(live.coached_segments),
    transcriber: typeof live.transcriber === "string" ? live.transcriber : null,
  };
}

/** Recording and the desktop wrote recently (a crashed desktop leaves no endless live card). */
export function isFresh(live: LiveMeta | null, now: Date): boolean {
  if (!live || live.state !== "recording") return false;
  const t = Date.parse(live.updated_at || live.started_at);
  return Number.isFinite(t) && now.getTime() - t < LIVE_STALE_MS;
}

export function addClip(live: LiveMeta, clip: LiveClip): LiveMeta {
  return { ...live, clips: [...live.clips, clip].slice(-MAX_CLIPS) };
}

export function toSession(
  row: { id: string; title: string; content_md: string | null },
  live: LiveMeta,
): LiveSession {
  return {
    item_id: row.id,
    title: row.title,
    state: live.state,
    started_at: live.started_at,
    updated_at: live.updated_at,
    segments: live.segments,
    last_sec: live.last_sec,
    tail: parseLines(row.content_md ?? "").slice(-TAIL_LINES),
    clips: live.clips.slice(-20),
    cards: live.cards.slice(0, 3),
    transcriber: live.transcriber ?? null,
  };
}

// --- coaching cards -------------------------------------------------------------------------

const KIND_BY_ORDER: CoachKind[] = ["fact", "question", "action"];

function kindOfLabel(label: string): CoachKind | null {
  const l = label.toLowerCase();
  if (/action|task|entscheidung|aufgabe|zusage|decision|commitment/.test(l)) return "action";
  if (/frage|impuls|argument|rückfrage|question|prompt/.test(l)) return "question";
  if (/fakt|kontext|abgleich|fact|quelle|context|source/.test(l)) return "fact";
  return null;
}

/**
 * Coaching bullets (ai-core parseCoachingBullets) → cards. A leading bold label ("**Fakten- &
 * Kontext-Abgleich:** …") decides the kind and is stripped; without one the prompt's order
 * (fact, question, action) applies. Empty answers ("keine", "–") are dropped.
 */
export function cardsFromBullets(bullets: readonly string[]): CoachCard[] {
  const cards: CoachCard[] = [];
  bullets.forEach((b, i) => {
    let text = b.trim();
    let kind: CoachKind | null = null;
    const m = /^\*\*([^*]+?)\*\*\s*:?\s*(.*)$/s.exec(text) ?? /^([A-Za-zÄÖÜäöüß &/-]{3,40}):\s+(.*)$/s.exec(text);
    if (m) {
      const k = kindOfLabel(m[1]!);
      if (k) {
        kind = k;
        text = m[2]!.trim();
      }
    }
    text = text.replace(/^[:\-–\s]+/, "").replace(/\*\*/g, "").trim();
    if (!text || /^(keine?s?|none|nothing|–|-|n\/a|nichts)\.?$/i.test(text) || /^\(?(?:keine?|none)\b.*\)?$/i.test(text)) return;
    cards.push({ kind: kind ?? KIND_BY_ORDER[i] ?? "fact", text });
  });
  return cards.slice(0, 3);
}
