import { useContext, useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useTheme } from "../theme/ThemeProvider";
import { ICONS, type IconName } from "./iconShapes";
import { GESTURE_OF, GESTURES, GestureCtx, type GestureSpec } from "./ruhe/gestures";
import { trackAt } from "./ruhe/keyframes";
import { useMotion } from "./ruhe/motion";

export type { IconName };

export interface IconProps {
  name: IconName;
  color: string;
  /** Pixel size; the prototype uses 16 (default), 14 (`kx-ico--sm`), 22 (tab bar), 24 (orb). */
  size?: number;
  /** Line width in the 24 grid. Default: Ruhe 1.4, from 20 px 1.25 (r2-type, same as the web); vivid 1.6. */
  strokeWidth?: number;
  rotate?: number;
  /** Tap count of the control: each change plays the icon's gesture once (Ruhe). Default: the GestureCtx host. */
  play?: number;
}

/** An icon keeps its size in a tight row (a long label next to it squeezed it to a dot). */
const NO_SHRINK = { flexShrink: 0 } as const;

/** Ruhe line width (one stroke for every line icon, finer on large icons). */
export const ruheStroke = (size: number): number => (size >= 20 ? 1.25 : 1.4);

export function Icon({ name, color, size = 16, strokeWidth, rotate, play }: IconProps) {
  const th = useTheme();
  const host = useContext(GestureCtx);
  const ruhe = th.look === "ruhe";
  const sw = strokeWidth ?? (ruhe ? ruheStroke(size) : 1.6);
  const svg = (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={rotate ? { flexShrink: 0, transform: [{ rotate: `${rotate}deg` }] } : NO_SHRINK}>
      {(ICONS[name] ?? []).map((s, i) => {
        const common = { stroke: color, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
        if (s.t === "p") return <Path key={i} d={s.d} {...common} />;
        if (s.t === "c") return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} {...common} />;
        return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...common} />;
      })}
    </Svg>
  );
  const trigger = play ?? host;
  const g = ruhe && trigger != null ? GESTURE_OF[name] : undefined;
  if (!g) return svg;
  return (
    <GestureIcon spec={GESTURES[g]} play={trigger!} size={size}>
      {svg}
    </GestureIcon>
  );
}

/** Plays a gesture once whenever `play` changes (not on mount). */
function GestureIcon({ spec, play, size, children }: { spec: GestureSpec; play: number; size: number; children: ReactNode }) {
  const m = useMotion();
  const p = useSharedValue(1);
  const last = useRef(play);
  const calm = m.calm;
  const off = m.reduced;
  const dur = calm ? Math.round(spec.dur * 0.7) : spec.dur;
  useEffect(() => {
    if (play === last.current) return;
    last.current = play;
    if (off) return;
    p.value = 0;
    p.value = withTiming(1, { duration: dur, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [play, off, dur, p]);
  const k = size / 16;
  const move = useAnimatedStyle(() => {
    const t = p.value;
    const r = spec.r ? trackAt(spec.r, t, calm) : 0;
    const s = spec.s ? trackAt(spec.s, t, calm) : 1;
    const sy = spec.sy ? trackAt(spec.sy, t, calm) : 1;
    const x = spec.x ? trackAt(spec.x, t, calm) * k : 0;
    const y = spec.y ? trackAt(spec.y, t, calm) * k : 0;
    const o = spec.o ? trackAt(spec.o, t, calm) : 1;
    return { opacity: o, transform: [{ translateX: x }, { translateY: y }, { rotate: `${r}deg` }, { scale: s }, { scaleY: sy }] };
  });
  const reveal = useAnimatedStyle(() => ({ width: spec.reveal ? size * trackAt(spec.reveal, p.value, calm) : size }));
  const origin = spec.origin ? `${spec.origin[0]}% ${spec.origin[1]}%` : "50% 50%";
  return (
    <Animated.View style={[{ width: size, height: size, flexShrink: 0, transformOrigin: origin }, move]}>
      <Animated.View style={[{ height: size, overflow: "hidden" }, reveal]}>
        <View style={{ width: size, height: size }}>{children}</View>
      </Animated.View>
    </Animated.View>
  );
}
