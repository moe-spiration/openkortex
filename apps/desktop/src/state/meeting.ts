import type { CoachCard, Events } from "@/bridge/contract";
import { msg, t } from "@/i18n";

/*
 * Live meeting state of the HUD and pill (H1): transcript lines, clips, coaching cards, session and
 * levels, all from bridge events (Rust core natively, the mock bridge in the browser preview).
 * Pure reducer, tested in test/meeting.test.ts. No demo content lives here.
 */

/** Lines kept in memory; the HUD shows the newest that fit. */
export const MAX_LINES = 80;

export interface LiveLine {
  id: number;
  kind: "speech" | "clip";
  channel: 0 | 1;
  who: string;
  ts: string;
  text: string;
}

export interface MeetingLive {
  lines: LiveLine[];
  /** Interim text per channel (Deepgram override only). */
  partial: [string | null, string | null];
  cards: CoachCard[];
  coach: { state: "idle" | "loading" | "error"; message: string | null; at: string | null };
  transcript: { state: "waiting" | "listening" | "error" | "off"; transcriber: string | null; message: string | null };
  session: { state: "none" | "connecting" | "live" | "offline" | "ended"; itemId: string | null; title: string | null; message: string | null };
  result: { state: "uploading" | "done" | "error"; itemId: string | null; segments: number | null; message: string | null; file: string | null } | null;
  /** dBFS per channel; `mic` false = the microphone delivers only digital silence (audio.rs). */
  levels: { a: number; b: number; mic: boolean };
  seq: number;
}

export const initialMeeting = (): MeetingLive => ({
  lines: [],
  partial: [null, null],
  cards: [],
  coach: { state: "idle", message: null, at: null },
  transcript: { state: "waiting", transcriber: null, message: null },
  session: { state: "none", itemId: null, title: null, message: null },
  result: null,
  levels: { a: -60, b: -60, mic: true },
  seq: 0,
});

export type MeetingEvent =
  | { type: "final"; p: Events["transcript:final"] }
  | { type: "partial"; p: Events["transcript:partial"] }
  | { type: "clip"; ts: string; text: string }
  | { type: "cards"; p: Events["coaching:cards"] }
  | { type: "coach"; p: Events["coaching:status"] }
  | { type: "transcript"; p: Events["transcript:status"] }
  | { type: "session"; p: Events["meeting:live"] }
  | { type: "upload"; p: Events["meeting:upload"] }
  | { type: "levels"; a: number; b: number; mic?: boolean }
  | { type: "reset" };

const push = (s: MeetingLive, line: Omit<LiveLine, "id">): MeetingLive => ({
  ...s,
  seq: s.seq + 1,
  lines: [...s.lines, { ...line, id: s.seq + 1 }].slice(-MAX_LINES),
});

export function meetingReducer(s: MeetingLive, e: MeetingEvent): MeetingLive {
  switch (e.type) {
    case "final": {
      const text = e.p.text.trim();
      const partial: MeetingLive["partial"] = [...s.partial];
      partial[e.p.channel] = null;
      if (!text) return { ...s, partial };
      return { ...push(s, { kind: "speech", channel: e.p.channel, who: e.p.speaker, ts: e.p.ts, text }), partial, transcript: { ...s.transcript, state: "listening", message: null } };
    }
    case "partial": {
      const partial: MeetingLive["partial"] = [...s.partial];
      partial[e.p.channel] = e.p.text.trim() || null;
      return { ...s, partial };
    }
    case "clip":
      return push(s, { kind: "clip", channel: 0, who: "Clip", ts: e.ts, text: e.text.trim() || t("Marked moment") });
    case "cards":
      return { ...s, cards: e.p.cards.slice(0, 3), coach: { state: "idle", message: null, at: e.p.at ?? s.coach.at } };
    case "coach":
      return { ...s, coach: { ...s.coach, state: e.p.state, message: e.p.message ?? null } };
    case "transcript":
      return {
        ...s,
        transcript: {
          state: e.p.state,
          transcriber: e.p.transcriber ?? s.transcript.transcriber,
          message: e.p.message ?? null,
        },
      };
    case "session":
      return {
        ...s,
        session: { state: e.p.state, itemId: e.p.item_id ?? s.session.itemId, title: e.p.title ?? s.session.title, message: e.p.message ?? null },
        transcript: e.p.transcriber ? { ...s.transcript, transcriber: e.p.transcriber } : s.transcript,
      };
    case "upload":
      return {
        ...s,
        result: {
          state: e.p.state,
          itemId: e.p.item_id ?? s.result?.itemId ?? s.session.itemId,
          segments: e.p.segments ?? null,
          message: e.p.message ?? null,
          file: e.p.file ?? null,
        },
      };
    case "levels":
      return { ...s, levels: { a: e.a, b: e.b, mic: e.mic ?? true } };
    case "reset":
      return initialMeeting();
  }
}

/** "edenai:deepgram" → "Eden AI · deepgram"; "deepgram:nova-3" → "Deepgram Nova-3". */
export function transcriberLabel(id: string | null): string {
  if (!id) return t("Transcription");
  const [provider = "", model = ""] = id.split(":");
  if (provider === "deepgram") return `Deepgram ${model.replace(/^nova-(\d)/i, "Nova-$1")}`.trim();
  const names: Record<string, string> = { edenai: "Eden AI", openrouter: "OpenRouter", groq: "Groq", anthropic: "Anthropic" };
  return [names[provider] ?? provider, model].filter(Boolean).join(" · ");
}

/** One line under the Meeting-Center heading: what happens with the running or next meeting. */
export function meetingStatus(
  connected: boolean,
  live: boolean,
  session: MeetingLive["session"]["state"],
  transcriptMessage: string | null,
): string {
  if (!connected) return t("Without an account the recording stays local (WAV in the recordings folder).");
  if (!live) return t("Microphone and system audio separately, transcribed live, minutes afterwards in 20_Meetings/.");
  if (session === "connecting") return t("Connecting to Kortex …");
  if (session === "offline") return t("No connection to Kortex: the recording is uploaded after the meeting.");
  return transcriptMessage ?? t("Live transcript and coaching run in the HUD.");
}

/** dBFS → wave envelope 0.2..1 (silence stays a flat line, speech fills the meter). */
export const levelOf = (db: number) => Math.max(0.2, Math.min(1, (db + 60) / 45));

/** Below this the meter stands still instead of animating (no fake motion on silence). */
export const QUIET_DB = -55;
export const isAudible = (db: number) => db > QUIET_DB;

/** Default headline of a coaching card without its own title (English sources, shown with `t`). */
export const COACH_TITLE: Record<CoachCard["kind"], string> = {
  fact: msg("Fact check"),
  question: msg("Good moment to ask"),
  action: msg("Action item detected"),
};

/** The object file the coaching draws on (first card that names one), for the chip "Akte …". */
export function coachObject(cards: readonly CoachCard[]): NonNullable<CoachCard["object"]> | null {
  return cards.find((c) => c.object?.id && c.object.title)?.object ?? null;
}

/** Action items among the coaching cards (chip "2 Aufgaben erkannt"). */
export const actionCount = (cards: readonly CoachCard[]) => cards.filter((c) => c.kind === "action").length;

/** Index of the card shown after `at` (wraps), -1 without cards. */
export const nextCard = (cards: readonly CoachCard[], at: number) => (cards.length ? (at + 1) % cards.length : -1);
