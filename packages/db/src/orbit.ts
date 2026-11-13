// Orbit-Bar logic (spec W9): intent detection and the bar's state machine. Pure, local, no network,
// no AI call, no UI; shared by web, desktop, mobile and the extension.
//
// `detectIntent` is a 1:1 port of the reference `orbit-detect.js` (2026-10-25). Changing a rule
// needs a test case (orbit.test.ts holds every case of the acceptance list A-12).

import { t, tx } from "@kortex/i18n";
import "./i18n";

export type OrbitMode = "capture" | "ask";
export type OrbitKind = "note" | "link" | "file" | "question";

export interface DetectedIntent {
  mode: OrbitMode;
  kind: OrbitKind;
  /** The text starts with "?": drop that character (explicit question). */
  stripPrefix?: boolean;
}

export const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

/** First words that make a question or a request (German and English). Extending is allowed. */
export const QUESTION_START: readonly string[] = [
  // Deutsch
  "wie", "was", "warum", "wieso", "weshalb", "wer", "wen", "wem", "wessen", "wo", "wohin", "woher", "wann", "welche", "welcher", "welches", "welchen", "wozu", "womit", "wodurch",
  "kann", "kannst", "könnte", "könntest", "soll", "sollte", "gibt", "ist", "sind", "hat", "haben", "muss", "darf", "fasse", "erkläre", "finde", "zeige", "suche", "vergleiche",
  // Englisch
  "what", "why", "how", "who", "whom", "whose", "where", "when", "which", "can", "could", "should", "does", "do", "did", "is", "are", "summarize", "explain", "find", "show", "compare",
];
const QUESTION_SET = new Set(QUESTION_START);

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * Rules, in order:
 * 1. files → capture/file · 2. empty → null · 3. starts with "?" → ask (strip prefix)
 * 4. whole input is a URL → capture/link · 5. ends with "?" and ≥ 2 words → ask
 * 6. starts with a question/request word and ≥ 3 words → ask
 * 7. exactly one URL and ≤ 4 words → capture/link · 8. else capture/note
 */
export function detectIntent(
  text: string | null | undefined,
  opts: { hasFiles?: boolean } = {},
): DetectedIntent | null {
  const input = (text ?? "").trim();
  if (opts.hasFiles) return { mode: "capture", kind: "file" };
  if (!input) return null;
  if (input[0] === "?") return { mode: "ask", kind: "question", stripPrefix: true };
  if (URL_RE.test(input)) return { mode: "capture", kind: "link" };
  const w = words(input);
  if (/\?\s*$/.test(input) && w.length >= 2) return { mode: "ask", kind: "question" };
  const first = w[0]!.toLowerCase().replace(/[^a-zäöüß]/g, "");
  if (w.length >= 3 && QUESTION_SET.has(first)) return { mode: "ask", kind: "question" };
  // A link with at most three words of comment stays a link.
  const urls = w.filter((x) => URL_RE.test(x));
  if (urls.length === 1 && w.length <= 4) return { mode: "capture", kind: "link" };
  return { mode: "capture", kind: "note" };
}

/** Text without the leading "?" (and the spaces after it). */
export function stripQuestionPrefix(text: string): string {
  return text.replace(/^\s*\?\s*/, "");
}

// --- State machine ---------------------------------------------------------------------------

export interface OrbitState {
  text: string;
  mode: OrbitMode;
  /** The user chose the mode (segment click, Tab, "?" prefix): auto-detection stops changing it. */
  pinned: boolean;
  /** Detected kind of the current input; null for an empty field. */
  kind: OrbitKind | null;
  recording: boolean;
  /** Setting "Sprachfragen sofort senden" (default off). */
  sendVoiceImmediately: boolean;
}

export type OrbitEvent =
  /** Field content after the 150 ms typing pause (or a paste). */
  | { type: "input"; text: string }
  | { type: "segment"; mode: OrbitMode }
  /** Tab inside the field (Shift+Tab leaves the field and is not an event). */
  | { type: "tab" }
  | { type: "escape" }
  /** Send button or Enter. */
  | { type: "submit" }
  /** Files or links dropped on the bar. */
  | { type: "drop"; files?: number; text?: string }
  /** Click (or Enter/Space) on the mic orb: starts a recording, or ends it with the transcript. */
  | { type: "mic"; transcript?: string }
  /** "Verwerfen" during a recording. */
  | { type: "discard" };

export type OrbitEffect =
  /** Note or link into the inbox (auto-routing; target per chip). */
  | { type: "capture"; text: string; kind: "note" | "link" }
  | { type: "captureFiles"; files: number; text?: string }
  /** Question to the vault (model per chip). */
  | { type: "ask"; text: string }
  | { type: "startRecording"; purpose: "dictation" | "voiceQuestion" }
  /** Stop the recorder and keep its result (consumed by the effects below). */
  | { type: "stopRecording" }
  /** Stop the recorder and delete audio + transcript. */
  | { type: "discardRecording" }
  /** aria-live="polite" message. */
  | { type: "announce"; message: string };

export interface OrbitStep {
  state: OrbitState;
  effects: OrbitEffect[];
}

export const initialOrbitState = (opts: { sendVoiceImmediately?: boolean } = {}): OrbitState => ({
  text: "",
  mode: "capture",
  pinned: false,
  kind: null,
  recording: false,
  sendVoiceImmediately: opts.sendVoiceImmediately ?? false,
});

const modeLabel = (mode: OrbitMode): string => (mode === "ask" ? tx("orbit", "Ask") : tx("orbit", "Capture"));

/** Applies detection to new field text (respecting `pinned`). */
function withText(state: OrbitState, raw: string): OrbitStep {
  const hit = detectIntent(raw);
  if (!hit) return { state: { ...state, text: raw, kind: null, ...(state.pinned ? {} : { mode: "capture" }) }, effects: [] };
  if (hit.stripPrefix) {
    // "?" is an explicit choice: drop it and keep "Fragen" while the rest is typed.
    return { state: { ...state, text: stripQuestionPrefix(raw), mode: "ask", kind: "question", pinned: true }, effects: [] };
  }
  if (state.pinned) return { state: { ...state, text: raw, kind: hit.kind }, effects: [] };
  const effects: OrbitEffect[] =
    hit.mode !== state.mode
      ? [{ type: "announce", message: t("Mode: {mode}, detected automatically", { mode: modeLabel(hit.mode) }) }]
      : [];
  return { state: { ...state, text: raw, mode: hit.mode, kind: hit.kind }, effects };
}

const cleared = (state: OrbitState): OrbitState => ({
  ...state,
  text: "",
  mode: "capture",
  pinned: false,
  kind: null,
});

/** One transition with its side effects (what the UI must do). */
export function orbitStep(state: OrbitState, event: OrbitEvent): OrbitStep {
  switch (event.type) {
    case "input":
      return state.recording ? { state, effects: [] } : withText(state, event.text);

    case "segment":
      return { state: { ...state, mode: event.mode, pinned: true }, effects: [] };

    case "tab":
      return {
        state: { ...state, mode: state.mode === "capture" ? "ask" : "capture", pinned: true },
        effects: [],
      };

    case "escape":
    case "discard":
      if (state.recording)
        return {
          state: { ...state, recording: false },
          effects: [{ type: "discardRecording" }, { type: "announce", message: t("Recording stopped") }],
        };
      return event.type === "escape" ? { state: cleared(state), effects: [] } : { state, effects: [] };

    case "submit": {
      const text = state.text.trim();
      if (!text || state.recording) return { state, effects: [] };
      const effect: OrbitEffect =
        state.mode === "ask"
          ? { type: "ask", text }
          : { type: "capture", text, kind: state.kind === "link" ? "link" : "note" };
      return { state: cleared(state), effects: [effect] };
    }

    case "drop": {
      const files = event.files ?? 0;
      const text = event.text?.trim() ?? "";
      if (!files && !text) return { state, effects: [] };
      const effect: OrbitEffect = files
        ? { type: "captureFiles", files, ...(text ? { text } : {}) }
        : { type: "capture", text, kind: detectIntent(text)?.kind === "link" ? "link" : "note" };
      // The drop is processed on its own; the field keeps its text, `pinned` stays as it was.
      return { state: { ...state, mode: "capture" }, effects: [effect] };
    }

    case "mic": {
      if (!state.recording) {
        return {
          state: { ...state, recording: true },
          effects: [
            { type: "startRecording", purpose: state.mode === "ask" ? "voiceQuestion" : "dictation" },
            { type: "announce", message: t("Recording in progress") },
          ],
        };
      }
      const transcript = event.transcript?.trim() ?? "";
      const stopped: OrbitState = { ...state, recording: false };
      const done: OrbitEffect[] = [
        { type: "stopRecording" },
        { type: "announce", message: t("Recording stopped") },
      ];
      if (!transcript) return { state: stopped, effects: done };
      if (state.mode === "capture") {
        // Dictation: the transcript goes straight into the inbox as a note.
        return { state: stopped, effects: [...done, { type: "capture", text: transcript, kind: "note" }] };
      }
      if (state.sendVoiceImmediately)
        return { state: cleared(stopped), effects: [...done, { type: "ask", text: transcript }] };
      // Voice question: the transcript lands in the field; detection runs on it like on input.
      const next = withText(stopped, transcript);
      return { state: next.state, effects: [...done, ...next.effects] };
    }
  }
}

/** Reducer form (`useReducer`); effects are dropped, use `orbitStep` where they matter. */
export function orbitReducer(state: OrbitState, event: OrbitEvent): OrbitState {
  return orbitStep(state, event).state;
}

// --- Derived labels --------------------------------------------------------------------------

/**
 * Hint at the right of the field (only with text): "Auto → Inbox", "Link → Inbox",
 * "Auto → Answer"; pinned: "→ Inbox" / "→ Answer" (German: "→ Antwort").
 */
export function orbitHint(state: OrbitState): string | null {
  if (!state.text.trim() || state.recording) return null;
  const target = state.mode === "ask" ? t("→ Answer") : "→ Inbox";
  if (state.pinned) return target;
  return state.mode === "capture" && state.kind === "link" ? `Link ${target}` : `Auto ${target}`;
}

/** Tooltip and aria-label of the mic orb. */
export function orbitMicLabel(state: OrbitState): string {
  if (state.recording) return t("Stop recording");
  return state.mode === "ask" ? t("Start voice question") : t("Start dictation");
}

/** Hint during a recording (neutral wording, decision K9). */
export function orbitRecordingHint(state: OrbitState): string {
  if (state.mode === "capture") return t("Kortex is listening · tap the orb to save");
  return state.sendVoiceImmediately
    ? t("Kortex is listening · tap the orb to send")
    : t("Kortex is listening · tap the orb to insert");
}

/** Send is dimmed (40 %) with an empty field. */
export const orbitCanSend = (state: OrbitState) => !state.recording && state.text.trim().length > 0;
