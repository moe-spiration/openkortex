import { formatTimestamp, parseTimestamp } from "../adapters/youtube.adapter";
import { KortexAiError } from "../errors";
import { ph, phForms } from "../i18n";

// Dual-channel meeting transcripts: channel 0 = the user's microphone, channel 1 = system
// audio (remote participants). Accepts what the desktop app may send:
//  - Deepgram prerecorded JSON (`results.channels[]` / `results.utterances[]`, multichannel)
//  - Deepgram live-stream `Results` messages collected in an array (only `is_final` ones count)
//  - Kortex normalized JSON `{ format: "kortex-meeting-v1", segments: [{ channel, start, end, text, speaker? }] }`
//  - Plain text lines: `[00:01:12] Max: …`, `[00:01:12] [Kanal 1] …`

export interface MeetingSegment {
  channel: number;
  speaker: string;
  startSec: number;
  endSec: number;
  text: string;
}

export type MeetingTranscriptFormat = "deepgram" | "deepgram_stream" | "kortex" | "text";

export interface MeetingTranscript {
  format: MeetingTranscriptFormat;
  segments: MeetingSegment[];
  durationSec: number;
  /** Distinct speaker names in order of first appearance. */
  speakers: string[];
  title?: string;
  startedAt?: string;
  platform?: string;
}

export interface SpeakerNames {
  /** Channel 0 (microphone). Default "Ich". */
  self?: string;
  /** Channel 1 (system audio). Default "Gesprächspartner"; numbered when diarization finds several. */
  remote?: string;
  /** Explicit names per channel, wins over self/remote. */
  channels?: string[];
}

/** Canonical JSON the desktop app should send (`kortex-meeting-v1`). */
export interface KortexMeetingJson {
  format: "kortex-meeting-v1";
  title?: string;
  started_at?: string;
  platform?: string;
  channel_names?: string[];
  segments: Array<{ channel: number; start: number; end?: number; text: string; speaker?: string }>;
}

export class TranscriptFormatError extends KortexAiError {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

interface RawSeg {
  channel: number;
  diarSpeaker?: number;
  speaker?: string;
  startSec: number;
  endSec: number;
  text: string;
}

interface DgWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  speaker?: number;
}

/** Groups word timings into sentences/turns: same speaker, gaps < 1.2 s, max 40 words. */
function wordsToSegments(words: DgWord[], channel: number): RawSeg[] {
  const out: RawSeg[] = [];
  let cur: (RawSeg & { n: number }) | undefined;
  for (const w of words) {
    const text = (w.punctuated_word ?? w.word ?? "").trim();
    if (!text) continue;
    const start = num(w.start);
    const end = num(w.end, start);
    const speakerChanged = cur && w.speaker !== undefined && w.speaker !== cur.diarSpeaker;
    if (!cur || speakerChanged || start - cur.endSec > 1.2 || cur.n >= 40) {
      if (cur) out.push(cur);
      cur = { channel, diarSpeaker: w.speaker, startSec: start, endSec: end, text, n: 1 };
    } else {
      cur.text += ` ${text}`;
      cur.endSec = end;
      cur.n++;
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({
    channel: s.channel,
    diarSpeaker: s.diarSpeaker,
    startSec: s.startSec,
    endSec: s.endSec,
    text: s.text,
  }));
}

function fromDeepgram(json: Record<string, unknown>): RawSeg[] {
  const results = json.results as Record<string, unknown> | undefined;
  if (!results) return [];
  const utterances = results.utterances as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances
      .map((u) => ({
        channel: num(u.channel),
        diarSpeaker: typeof u.speaker === "number" ? u.speaker : undefined,
        startSec: num(u.start),
        endSec: num(u.end, num(u.start)),
        text: String(u.transcript ?? "").trim(),
      }))
      .filter((s) => s.text);
  }
  const channels = (results.channels as Array<Record<string, unknown>> | undefined) ?? [];
  return channels.flatMap((ch, channel) => {
    const alt = (ch.alternatives as Array<Record<string, unknown>> | undefined)?.[0];
    if (!alt) return [];
    const paragraphs = (
      alt.paragraphs as { paragraphs?: Array<Record<string, unknown>> } | undefined
    )?.paragraphs;
    if (Array.isArray(paragraphs) && paragraphs.length > 0) {
      return paragraphs.flatMap((p) =>
        ((p.sentences as Array<Record<string, unknown>> | undefined) ?? []).map((s) => ({
          channel,
          diarSpeaker: typeof p.speaker === "number" ? p.speaker : undefined,
          startSec: num(s.start),
          endSec: num(s.end, num(s.start)),
          text: String(s.text ?? "").trim(),
        })),
      );
    }
    if (Array.isArray(alt.words) && alt.words.length > 0)
      return wordsToSegments(alt.words as DgWord[], channel);
    const t = String(alt.transcript ?? "").trim();
    return t
      ? [
          {
            channel,
            startSec: 0,
            endSec: num(json.metadata && (json.metadata as Record<string, unknown>).duration),
            text: t,
          },
        ]
      : [];
  });
}

function fromDeepgramStream(messages: Array<Record<string, unknown>>): RawSeg[] {
  return messages
    .filter((m) => m.type === "Results" && m.is_final !== false)
    .flatMap((m) => {
      const channel = num((m.channel_index as number[] | undefined)?.[0]);
      const alt = (
        (m.channel as Record<string, unknown> | undefined)?.alternatives as
          Array<Record<string, unknown>> | undefined
      )?.[0];
      if (!alt) return [];
      if (Array.isArray(alt.words) && alt.words.length > 0)
        return wordsToSegments(alt.words as DgWord[], channel);
      const text = String(alt.transcript ?? "").trim();
      const start = num(m.start);
      return text ? [{ channel, startSec: start, endSec: start + num(m.duration), text }] : [];
    });
}

function fromKortex(json: KortexMeetingJson): RawSeg[] {
  return json.segments
    .map((s) => ({
      channel: num(s.channel),
      speaker: s.speaker?.trim() || undefined,
      startSec: num(s.start),
      endSec: num(s.end, num(s.start)),
      text: String(s.text ?? "").trim(),
    }))
    .filter((s) => s.text);
}

const LINE =
  /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*(?:\[(?:Kanal|Channel|Ch\.?)\s*(\d)\]\s*)?(?:([^:\][]{1,40}?):\s+)?(.+)$/i;

function fromText(text: string, names: SpeakerNames): RawSeg[] {
  // Without a configured name the user's own lines read "Ich: …" or "Me: …" (both are accepted).
  const configured = names.channels?.[0] ?? names.self;
  const selfNames = (configured ? [configured] : phForms("me")).map((n) => n.toLowerCase());
  const out: RawSeg[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(LINE);
    if (!m?.[1] || !m[4]) {
      const prev = out.at(-1);
      if (prev) prev.text += ` ${line.trim()}`;
      continue;
    }
    const start = parseTimestamp(m[1]) ?? 0;
    const speaker = m[3]?.trim();
    const channel =
      m[2] !== undefined ? Number(m[2]) : speaker && !selfNames.includes(speaker.toLowerCase()) ? 1 : 0;
    const prev = out.at(-1);
    if (prev && prev.endSec < start) prev.endSec = start;
    out.push({ channel, speaker, startSec: start, endSec: start, text: m[4].trim() });
  }
  return out;
}

function nameSegments(
  raw: RawSeg[],
  names: SpeakerNames,
  channelNames?: string[],
): MeetingSegment[] {
  const base = (channel: number) =>
    channelNames?.[channel] ??
    names.channels?.[channel] ??
    (channel === 0 ? (names.self ?? ph("me")) : (names.remote ?? ph("otherParty")));
  // Number diarized speakers per channel only when a channel has more than one.
  const perChannel = new Map<number, number[]>();
  for (const s of raw) {
    if (s.diarSpeaker === undefined || s.speaker) continue;
    const list = perChannel.get(s.channel) ?? [];
    if (!list.includes(s.diarSpeaker)) list.push(s.diarSpeaker);
    perChannel.set(s.channel, list);
  }
  return raw.map((s) => {
    const list = perChannel.get(s.channel) ?? [];
    const speaker =
      s.speaker ??
      (list.length > 1 && s.diarSpeaker !== undefined
        ? `${base(s.channel)} ${list.indexOf(s.diarSpeaker) + 1}`
        : base(s.channel));
    return {
      channel: s.channel,
      speaker,
      startSec: s.startSec,
      endSec: Math.max(s.endSec, s.startSec),
      text: s.text,
    };
  });
}

/** Sorts by time and merges short back-to-back fragments of the same speaker. */
function mergeTurns(segments: MeetingSegment[]): MeetingSegment[] {
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec || a.channel - b.channel);
  const out: MeetingSegment[] = [];
  for (const s of sorted) {
    const prev = out.at(-1);
    if (
      prev &&
      prev.speaker === s.speaker &&
      s.startSec - prev.endSec < 2 &&
      prev.text.length + s.text.length < 400
    ) {
      prev.text = `${prev.text} ${s.text}`;
      prev.endSec = Math.max(prev.endSec, s.endSec);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Parses any supported transcript (string or already-parsed JSON). */
export function parseMeetingTranscript(
  input: string | unknown,
  names: SpeakerNames = {},
): MeetingTranscript {
  let data: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        data = input;
      }
    }
  }

  let format: MeetingTranscriptFormat;
  let raw: RawSeg[];
  let meta: {
    title?: string;
    startedAt?: string;
    platform?: string;
    channelNames?: string[];
    duration?: number;
  } = {};
  if (typeof data === "string") {
    format = "text";
    raw = fromText(data, names);
  } else if (isObj(data) && Array.isArray(data.segments)) {
    format = "kortex";
    const k = data as unknown as KortexMeetingJson;
    raw = fromKortex(k);
    meta = {
      title: k.title,
      startedAt: k.started_at,
      platform: k.platform,
      channelNames: k.channel_names,
    };
  } else if (isObj(data) && isObj(data.results)) {
    format = "deepgram";
    raw = fromDeepgram(data);
    const m = data.metadata as Record<string, unknown> | undefined;
    meta = {
      duration: num(m?.duration, 0) || undefined,
      startedAt: typeof m?.created === "string" ? m.created : undefined,
    };
  } else if (Array.isArray(data) || (isObj(data) && Array.isArray(data.messages))) {
    format = "deepgram_stream";
    raw = fromDeepgramStream(
      (Array.isArray(data) ? data : (data as { messages: unknown[] }).messages) as Array<
        Record<string, unknown>
      >,
    );
  } else {
    throw new TranscriptFormatError("unknown meeting transcript format");
  }

  const segments = mergeTurns(nameSegments(raw, names, meta.channelNames));
  if (segments.length === 0) throw new TranscriptFormatError("meeting transcript is empty");
  const speakers: string[] = [];
  for (const s of segments) if (!speakers.includes(s.speaker)) speakers.push(s.speaker);
  const durationSec = Math.max(meta.duration ?? 0, ...segments.map((s) => s.endSec));
  return {
    format,
    segments,
    durationSec,
    speakers,
    title: meta.title,
    startedAt: meta.startedAt,
    platform: meta.platform,
  };
}

export const formatTranscriptLine = (s: MeetingSegment): string =>
  `[${formatTimestamp(s.startSec)}] ${s.speaker}: ${s.text}`;

export const formatTranscript = (segments: readonly MeetingSegment[]): string =>
  segments.map(formatTranscriptLine).join("\n");

/** Segments of the last `minutes` before `untilSec` (default: end of transcript). */
export function lastMinutes(
  segments: readonly MeetingSegment[],
  minutes: number,
  untilSec?: number,
): MeetingSegment[] {
  const end = untilSec ?? Math.max(0, ...segments.map((s) => s.endSec));
  const from = end - minutes * 60;
  return segments.filter((s) => s.endSec >= from && s.startSec <= end);
}

/** Cheap check for canHandle: does this text look like a supported transcript? */
export function looksLikeMeetingTranscript(text: string): boolean {
  const head = text.trimStart().slice(0, 20_000);
  if (head.startsWith("{") || head.startsWith("[{")) {
    return /"format"\s*:\s*"kortex-meeting-v1"|"results"\s*:\s*\{[\s\S]*"channels"|"type"\s*:\s*"Results"/.test(
      head,
    );
  }
  return false;
}
