/*
 * Whisper-style models invent text on silence or noise ("Untertitel der Amara.org-Community",
 * "Vielen Dank fürs Zuschauen"). Phrases below are known artefacts of the training data; a
 * transcript that is nothing but such phrases (or too short to be speech) is treated as empty.
 */

/** Segments of Groq verbose_json at or above this are dropped as non-speech. */
export const NO_SPEECH_PROB_MAX = 0.6;

/** A voice note shorter than this (letters/digits) is not a statement. */
export const MIN_TRANSCRIPT_CHARS = 3;

const KNOWN_PHRASES: readonly RegExp[] = [
  /untertitel(?:ung)?\s+(?:der|von|im auftrag)\b.*(?:amara|zdf|swr|ard|funk)/i,
  /amara\.org/i,
  /untertitel\s+(?:der|von)\s+.{0,40}community/i,
  /untertitelung\s+des\s+zdf/i,
  /copyright\s+wdr/i,
  /vielen dank f[uü]rs? (?:zuschauen|zuh[oö]ren)/i,
  /danke f[uü]rs? (?:zuschauen|zuh[oö]ren)/i,
  /vielen dank f[uü]r (?:ihre|eure|deine) aufmerksamkeit/i,
  /bis zum n[aä]chsten mal/i,
  /thanks? for watching/i,
  /thank you for watching/i,
  /please subscribe/i,
  /subtitles? by\b/i,
  /subtitled by\b/i,
  /transcribed by\b/i,
  /^\s*(?:ご視聴ありがとうございました|字幕.*)\s*$/,
];

const normalize = (t: string) =>
  t
    .replace(/[♪♫[\]()*_"„“”'.,!?…:;-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** True when `text` is a known Whisper artefact (the phrase, possibly repeated or with noise marks). */
export function isWhisperHallucination(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return KNOWN_PHRASES.some((re) => re.test(t)) && t.length <= 160;
}

/** Nothing usable: blank, below the minimum length or only known artefacts. */
export function isEmptySpeech(text: string): boolean {
  const flat = normalize(text);
  if (flat.replace(/\s/g, "").length < MIN_TRANSCRIPT_CHARS) return true;
  return isWhisperHallucination(text);
}

/** Drops artefact segments; what remains is joined by the caller. */
export function dropHallucinatedSegments<T extends { text: string }>(segments: readonly T[]): T[] {
  return segments.filter((s) => !isWhisperHallucination(s.text));
}
