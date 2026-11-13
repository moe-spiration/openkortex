import { t } from "../i18n";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { AudioRecorder } from "expo-audio";
import { useTheme } from "../theme/ThemeProvider";
import { autoGain, GAIN_START, pushLevel, smooth, type Gain } from "./level";

/*
 * A4: the recording waveform follows the real microphone level. One poller per recorder reads the status
 * every 60 ms and shares the sample with every meter on screen: Android's MediaRecorder.getMaxAmplitude
 * resets on each read, so two meters polling on their own would steal each other's peaks. Each sample
 * becomes the newest bar on the right (speech scrolls through the wave, silence stays flat); auto gain
 * adapts to quiet phone microphones.
 */

const POLL_MS = 60;
const HISTORY = 64;

type Sample = { level: number; hist: number[] };
type Poller = { subs: Set<(s: Sample) => void>; timer: ReturnType<typeof setInterval> | null; gain: Gain; level: number; hist: number[] };
const pollers = new Map<AudioRecorder, Poller>();
/** Loudest raw dBFS sample per recording (the meter is on screen while recording), read once by saveVoice. */
const peaks = new WeakMap<AudioRecorder, number>();

/** Returns and clears the loudest dBFS sample seen since the last call (undefined: no meter data). */
export function takePeakDb(recorder: AudioRecorder): number | undefined {
  const v = peaks.get(recorder);
  peaks.delete(recorder);
  return v;
}

function subscribe(recorder: AudioRecorder, fn: (s: Sample) => void): () => void {
  let p = pollers.get(recorder);
  if (!p) {
    p = { subs: new Set(), timer: null, gain: GAIN_START, level: 0, hist: [] };
    pollers.set(recorder, p);
  }
  const poll = p;
  poll.subs.add(fn);
  if (!poll.timer) {
    poll.timer = setInterval(() => {
      let st: { isRecording?: boolean; metering?: number } = {};
      try {
        st = recorder.getStatus();
      } catch {
        // Released recorder: report silence.
      }
      if (st.isRecording && st.metering != null && Number.isFinite(st.metering) && st.metering > -159) peaks.set(recorder, Math.max(peaks.get(recorder) ?? -Infinity, st.metering));
      const { gain, level } = st.isRecording ? autoGain(poll.gain, st.metering) : { gain: poll.gain, level: 0 };
      poll.gain = gain;
      poll.level = smooth(poll.level, level);
      poll.hist = pushLevel(poll.hist, poll.level, HISTORY);
      const sample = { level: poll.level, hist: poll.hist };
      poll.subs.forEach((s) => s(sample));
    }, POLL_MS);
  }
  return () => {
    poll.subs.delete(fn);
    if (!poll.subs.size && poll.timer) {
      clearInterval(poll.timer);
      pollers.delete(recorder);
    }
  };
}

/** Live level 0 … 1 of a recorder (smoothed) and its recent history (oldest first). */
export function useMicLevel(recorder: AudioRecorder): Sample {
  const [s, setS] = useState<Sample>({ level: 0, hist: [] });
  useEffect(() => subscribe(recorder, setS), [recorder]);
  return s;
}

export function LevelWave({ recorder, n = 44, h = 34, color }: { recorder: AudioRecorder; n?: number; h?: number; color?: string }) {
  const th = useTheme();
  const { level, hist: all } = useMicLevel(recorder);
  const tail = all.slice(-n);
  const hist = [...Array<number>(n - tail.length).fill(0), ...tail];
  const c = color ?? th.accentAi;
  return (
    <View accessibilityLabel={t("Input level {n} percent", { n: Math.round(level * 100) })} style={{ flexDirection: "row", alignItems: "center", gap: 2, height: h }}>
      {hist.map((v, i) => (
        <View key={i} style={{ width: 2.5, height: Math.max(3, h * (0.08 + 0.92 * v)), borderRadius: 2, backgroundColor: c, opacity: 0.4 + 0.6 * Math.min(1, v * 1.6 + i / n / 3) }} />
      ))}
    </View>
  );
}

/** A soft halo around the recording orb that grows with the input level. */
export function LevelHalo({ recorder, size, color }: { recorder: AudioRecorder; size: number; color: string }) {
  const { level } = useMicLevel(recorder);
  const s = 1 + level * 0.55;
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.18 + level * 0.3, transform: [{ scale: s }] }}
    />
  );
}
