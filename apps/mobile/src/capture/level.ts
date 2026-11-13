/*
 * Microphone level: expo-audio reports metering in dBFS (-160 … 0). Speech sits roughly between
 * -45 and -5 dB, so that window maps to 0 … 1. Pure functions, tested without React Native.
 */

export const FLOOR_DB = -50;
export const CEIL_DB = -5;

/** dBFS → 0 … 1 (undefined / silence → 0). */
export function dbToLevel(db: number | undefined | null): number {
  if (db == null || !Number.isFinite(db)) return 0;
  const v = (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB);
  return Math.max(0, Math.min(1, v));
}

/** Fast attack, slower release, so bars jump with a syllable and fall back smoothly. */
export function smooth(prev: number, next: number, attack = 0.65, release = 0.25): number {
  const k = next > prev ? attack : release;
  return prev + (next - prev) * k;
}

/** Appends a level to a fixed-length history (oldest first). */
export function pushLevel(history: number[], level: number, n: number): number[] {
  const out = history.length >= n ? history.slice(history.length - n + 1) : history.slice();
  out.push(level);
  while (out.length < n) out.unshift(0);
  return out;
}

/**
 * Auto gain: phone microphones differ a lot (Android reports MediaRecorder.getMaxAmplitude as dBFS, often
 * far below the fixed window above). The floor follows the quietest recent sample, the peak the loudest,
 * and the level is the position between them, so speech always moves the meter and silence stays low.
 */
export interface Gain {
  floor: number;
  peak: number;
}

export const GAIN_START: Gain = { floor: -60, peak: -25 };
/** Minimum span between floor and peak, so background noise never fills the meter. */
const SPAN_DB = 18;

export function autoGain(g: Gain, db: number | undefined | null): { gain: Gain; level: number } {
  // -160 = MediaRecorder returned 0 (no new peak since the last read): silence, keep the state.
  if (db == null || !Number.isFinite(db) || db <= -159) return { gain: g, level: 0 };
  const floor = db < g.floor ? db : g.floor + 0.15;
  const peak = Math.max(db > g.peak ? db : g.peak - 0.25, floor + SPAN_DB);
  const level = Math.max(0, Math.min(1, (db - floor) / (peak - floor)));
  return { gain: { floor, peak }, level };
}

/** A voice memo shorter than this is a mis-tap, not a thought. */
export const MIN_VOICE_SEC = 1;
/** Loudest sample below this (dBFS): the microphone heard nothing, nothing is uploaded. */
export const SILENCE_PEAK_DB = -50;

/** Why a finished recording must not be uploaded; null = fine. `peakDb` undefined = no meter data, so do not block. */
export function voiceRejection(sec: number, peakDb: number | undefined): "short" | "silent" | null {
  if (sec < MIN_VOICE_SEC) return "short";
  if (peakDb != null && peakDb < SILENCE_PEAK_DB) return "silent";
  return null;
}
