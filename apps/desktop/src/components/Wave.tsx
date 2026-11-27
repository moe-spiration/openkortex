import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { levelStore } from "@/state/levels";
import { isAudible, levelOf } from "@/state/meeting";

export type WaveTone = "mic" | "out" | "ai" | "light";

export interface WaveProps {
  tone?: WaveTone;
  /** Bar count, 8..64. */
  n?: number;
  /** Height in px. */
  h?: number;
  /** Envelope gain 0.2..1 (static meters; live ones use `channel`). */
  level?: number;
  live?: boolean;
  /**
   * Live meter of channel 0 (microphone), 1 (system) or "both" (the louder one: the meeting bar's single wave)
   * from the level store (state/levels.ts): the
   * meter updates its own DOM per animation frame, React does not re-render. `showDb` adds the live
   * dB value; `live` gates the motion (e.g. only while recording).
   */
  channel?: 0 | 1 | "both";
  /** With `channel`: show the live dB value on the right. */
  showDb?: boolean;
  label?: string;
  labelW?: string;
  meta?: string;
  /**
   * Fill the parent's width: the meter shrinks (min-width 0) while label and dB stay fixed
   * (V2-05b/c). Use in fixed-width containers like the HUD.
   */
  fill?: boolean;
  /** No 20 px line box around the meter: the wave is exactly `h` tall (V2-07a, pill). */
  bare?: boolean;
}

/** Bar heights / opacity / timing of the prototype's waveform (Wave.dc.html), deterministic per (n, level). */
export function waveBars(n: number, level: number) {
  return Array.from({ length: n }, (_, i) => {
    const env = Math.pow(Math.sin((Math.PI * (i + 0.5)) / n), 0.7);
    const jitter = 0.55 + 0.45 * Math.abs(Math.sin(i * 12.9898 + n * 3.1));
    return {
      hp: Math.max(14, Math.round(100 * env * jitter * level)),
      op: (0.45 + 0.55 * env).toFixed(2),
      dur: (0.7 + ((i * 37) % 9) / 10).toFixed(2),
      delay: (((i * 53) % 11) / 10).toFixed(2),
    };
  });
}

const dbText = (db: number) => `${Math.round(db)} dB`;

/** dBFS a meter shows for `channel`: one channel, or the louder of both. */
export const channelDb = (l: { a: number; b: number }, channel: 0 | 1 | "both") =>
  channel === "both" ? Math.max(l.a, l.b) : channel === 0 ? l.a : l.b;

/**
 * Animated level meter (`.kx-wv`, Wave.dc.html). Visual motion is the CSS animation; the level
 * scales the envelope. Live meters (`channel`) scale the whole bar group with one compositor-only
 * `transform` per frame instead of re-rendering 2 x 40 bars (fx3).
 */
export const Wave = memo(function Wave({
  tone = "ai",
  n = 28,
  h = 24,
  level = 0.9,
  live = true,
  channel,
  showDb = false,
  label,
  labelW,
  meta,
  fill = false,
  bare = false,
}: WaveProps) {
  const count = Math.max(8, Math.min(64, n));
  const bound = channel !== undefined;
  const lvl = bound ? 1 : Math.max(0.2, Math.min(1, level));
  const bars = useMemo(
    () =>
      waveBars(count, lvl).map((b, i) => (
        <i
          key={i}
          style={{ height: `${b.hp}%`, opacity: b.op, animationDuration: `${b.dur}s`, animationDelay: `-${b.delay}s` }}
        />
      )),
    [count, lvl],
  );
  const wv = useRef<HTMLSpanElement>(null);
  const dbEl = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!bound) return;
    let last = NaN;
    let lastOn: boolean | null = null;
    return levelStore.subscribe((l) => {
      const db = channelDb(l, channel ?? 0);
      const on = live && isAudible(db);
      if (db === last && on === lastOn) return;
      last = db;
      if (on !== lastOn) {
        wv.current?.classList.toggle("is-idle", !on);
        lastOn = on;
      }
      // Idle bars are flat by CSS (.is-idle); do not shrink them twice.
      if (wv.current) wv.current.style.transform = on ? `scaleY(${levelOf(db).toFixed(3)})` : "";
      if (dbEl.current) dbEl.current.textContent = dbText(db);
    });
  }, [bound, channel, live]);
  const shown = bound && showDb ? dbText(channelDb(levelStore.get(), channel ?? 0)) : meta;
  const idle = bound ? !(live && isAudible(channelDb(levelStore.get(), channel ?? 0))) : !live;
  // Block host around the inline-flex meter, like the prototype's embedded component: the line box
  // (body line-height 20px) gives the row its height and the meter keeps its content width.
  return (
    <div
      className="kx-wave-host"
      style={
        bare
          ? { display: "flex", height: h, lineHeight: 0 }
          : fill
            ? { width: "100%", minWidth: 0 }
            : undefined
      }
    >
      <div
        style={{
          display: fill ? "flex" : "inline-flex",
          width: fill ? "100%" : undefined,
          minWidth: 0,
          alignItems: "center",
          gap: 10,
          fontFamily: "var(--font-sans)",
          color: "var(--text-primary)",
        }}
      >
        {label && (
          <span
            className="kx-mono"
            style={{
              fontSize: "calc(11px * var(--kx-fs, 1))",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              width: labelW ?? "auto",
              flex: "none",
            }}
          >
            {label}
          </span>
        )}
        <span
          ref={wv}
          className={`kx-wv kx-wv--${tone}${idle ? " is-idle" : ""}`}
          style={{ "--wv-h": `${h}px`, willChange: bound ? "transform" : undefined } as CSSProperties}
          aria-hidden
        >
          {bars}
        </span>
        {shown && (
          <span
            ref={dbEl}
            className="kx-num"
            style={{
              fontSize: "calc(11px * var(--kx-fs, 1))",
              color: "var(--text-muted)",
              minWidth: 44,
              textAlign: "right",
              flex: "none",
            }}
          >
            {shown}
          </span>
        )}
      </div>
    </div>
  );
});
