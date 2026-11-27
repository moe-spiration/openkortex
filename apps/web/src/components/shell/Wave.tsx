"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { motionOff } from "@/lib/settings/motion";

/*
 * Animated audio waveform (design/reference/Wave.dc.html).
 * V2-05b: the root fills its container and the bars (.kx-wv) shrink and clip, so label and dB stay fixed.
 */

export interface WaveProps {
  tone?: "mic" | "out" | "ai" | "light";
  n?: number;
  h?: number;
  level?: number;
  live?: boolean;
  label?: string;
  labelW?: string;
  meta?: string;
  /** Root overrides, e.g. width "auto" where the wave sits inline next to other flexible content. */
  style?: CSSProperties;
}

export function Wave({
  tone = "ai",
  n = 28,
  h = 24,
  level = 0.9,
  live = true,
  label,
  labelW,
  meta,
  style,
}: WaveProps) {
  const count = Math.max(8, Math.min(64, n));
  const lv = Math.max(0.2, Math.min(1, level));
  const bars = Array.from({ length: count }, (_, i) => {
    const env = Math.pow(Math.sin((Math.PI * (i + 0.5)) / count), 0.7);
    const jitter = 0.55 + 0.45 * Math.abs(Math.sin(i * 12.9898 + count * 3.1));
    return {
      height: Math.max(14, Math.round(100 * env * jitter * lv)) + "%",
      opacity: Number((0.45 + 0.55 * env).toFixed(2)),
      animationDuration: (0.7 + ((i * 37) % 9) / 10).toFixed(2) + "s",
      animationDelay: "-" + (((i * 53) % 11) / 10).toFixed(2) + "s",
    } satisfies CSSProperties;
  });
  return (
    <span
      style={{
        display: "flex",
        width: "100%",
        minWidth: 0,
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--font-sans)",
        color: "var(--text-primary)",
        ...style,
      }}
    >
      {label && (
        <span
          className="kx-num"
          style={{
            flex: "none",
            fontSize: "calc(12px * var(--kx-fs, 1))",
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
            width: labelW ?? "auto",
          }}
        >
          {label}
        </span>
      )}
      <span
        className={`kx-wv kx-wv--${tone}${live ? "" : " is-idle"}`}
        style={{ "--wv-h": `${h}px` } as CSSProperties}
        aria-hidden
      >
        {bars.map((st, i) => (
          <i key={i} style={st} />
        ))}
      </span>
      {meta && (
        <span
          className="kx-num"
          style={{
            flex: "none",
            fontSize: "calc(12px * var(--kx-fs, 1))",
            color: "var(--text-muted)",
            minWidth: 44,
            textAlign: "right",
          }}
        >
          {meta}
        </span>
      )}
    </span>
  );
}

/** Bars of the Orbit-Bar recording wave (W9, Tactile Craft): 48 × 3 px, 2 px apart, 4 to 26 px high (CSS clips to the room). */
export const LIVE_WAVE_BARS = 48;
const MIN_H = 4;
const MAX_H = 26;

/** Level 0..1 from one frame of time-domain samples (RMS, lifted so speech fills the range). */
export function levelOf(samples: Uint8Array): number {
  let sum = 0;
  for (const b of samples) {
    const x = (b - 128) / 128;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return Math.min(1, Math.sqrt(rms) * 1.6);
}

/** Bewegung "Aus" (or System on an OS that asks for reduced motion): lib/settings/motion.ts. */
const reducedMotion = motionOff;

/**
 * Live wave of the Orbit-Bar: fed by the real microphone level (Web Audio AnalyserNode on the
 * recording stream), newest level on the right, louder bars brighter. Without a stream (no
 * microphone, level lost) the wave stays flat; with reduced motion it stands still at mid height.
 */
export function LiveWave({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bars = Array.from(ref.current?.children ?? []) as HTMLElement[];
    const paint = (levels: readonly number[]) =>
      bars.forEach((el, i) => {
        const v = Math.max(0, Math.min(1, levels[i] ?? 0));
        el.style.height = `${Math.round(MIN_H + v * (MAX_H - MIN_H))}px`;
        el.style.opacity = (0.45 + 0.55 * v).toFixed(2);
      });
    const flat = (v: number) => paint(bars.map(() => v));
    if (!stream) return flat(0);
    if (reducedMotion()) return flat(0.5);
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return flat(0);
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const history = bars.map(() => 0);
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 45) return; // ~22 updates per second
      last = t;
      analyser.getByteTimeDomainData(samples);
      history.shift();
      history.push(levelOf(samples));
      paint(history);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);
  return (
    <span ref={ref} className="kx-orbit-wave" aria-hidden data-live={stream ? "true" : "false"}>
      {Array.from({ length: LIVE_WAVE_BARS }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
