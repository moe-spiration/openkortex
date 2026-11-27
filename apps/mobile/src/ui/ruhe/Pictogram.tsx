import { useEffect, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedProps, useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";
import { cubicPoint, loopAt, trackAt } from "./keyframes";
import { useMotion } from "./motion";
import { AGENT, AGENT_IDLE, IDEA, IDEA_RAYS, INBOX, PICTOGRAM_SIZE, SEARCH, SEARCH_ROWS, STACK, SYNC, SYNC_PATH_A, SYNC_PATH_B, type LayerSpec, type PictogramKind, type PictogramSize } from "./pictogramSpec";

export type { PictogramKind, PictogramSize } from "./pictogramSpec";

/*
 * Large animated pictograms of the Ruhe look (motion-demos.html, web components/motion/Pictogram.tsx): line drawings
 * in text tone with exactly one accent element, looping slowly where nothing else happens (empty views, the agent at
 * work, sync). Each moving part is its own layer (an Animated.View over one 150 × 120 drawing) that moves with
 * transforms, so the same code runs on Android and in the Expo web preview; drawn lines animate their dash offset.
 * One frame clock per pictogram on the UI thread; Bewegung "Aus" shows the still picture (shapes and tracks:
 * pictogramSpec.ts).
 */

const VB_W = 150;
const VB_H = 120;
const APath = Animated.createAnimatedComponent(Path);

interface Ctx {
  clock: SharedValue<number>;
  /** Pixels per grid unit. */
  k: number;
  w: number;
  h: number;
  calm: boolean;
}

/** The loop clock in ms on the UI thread; -1 while motion is off (still picture). */
function useClock(run: boolean): SharedValue<number> {
  const t = useSharedValue(-1);
  const cb = useFrameCallback((f) => {
    t.value = f.timeSinceFirstFrame;
  }, false);
  useEffect(() => {
    cb.setActive(run);
    if (!run) t.value = -1;
    return () => cb.setActive(false);
  }, [run, cb, t]);
  return t;
}

function Drawing({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none">
      {children}
    </Svg>
  );
}

const ABS = { position: "absolute", left: 0, top: 0 } as const;

/** A moving part: opacity, rotate, translate and scale from its spec, around its origin. */
function Layer({ c, spec, children }: { c: Ctx; spec: LayerSpec; children: ReactNode }) {
  const { clock, k, calm } = c;
  const origin = spec.origin ? `${(spec.origin[0] / VB_W) * 100}% ${(spec.origin[1] / VB_H) * 100}%` : "50% 50%";
  const style = useAnimatedStyle(() => {
    const T = clock.value;
    const rest = spec.rest;
    if (T < 0) return { opacity: rest.o, transform: [{ rotate: `${rest.r}deg` }, { translateX: rest.x * k }, { translateY: rest.y * k }, { scale: rest.s }] };
    const p = loopAt(T, spec.period, spec.delay);
    const o = spec.o ? trackAt(spec.o, p, calm) : rest.o;
    const r = spec.r ? trackAt(spec.r, p, calm) : rest.r;
    const x = spec.x ? trackAt(spec.x, p, calm) : rest.x;
    const y = spec.y ? trackAt(spec.y, p, calm) : rest.y;
    const s = spec.s ? trackAt(spec.s, p, calm) : rest.s;
    return { opacity: o, transform: [{ rotate: `${r}deg` }, { translateX: x * k }, { translateY: y * k }, { scale: s }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[ABS, { width: c.w, height: c.h, transformOrigin: origin }, style]}>
      <Drawing w={c.w} h={c.h}>{children}</Drawing>
    </Animated.View>
  );
}

/** A line that draws itself (stroke-dashoffset from the spec's `dash` track). */
function DashPath({ c, spec, d, stroke, width, dash, opacity }: { c: Ctx; spec: LayerSpec; d: string; stroke: string; width: number; dash: string; opacity?: number }) {
  const { clock, calm } = c;
  const props = useAnimatedProps(() => {
    const T = clock.value;
    if (T < 0 || !spec.dash) return { strokeDashoffset: spec.rest.dash };
    return { strokeDashoffset: trackAt(spec.dash, loopAt(T, spec.period, spec.delay), calm) };
  });
  return <APath d={d} stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} opacity={opacity} fill="none" animatedProps={props} />;
}

/** A sync packet travelling along a curve (CSS offset-path); drawn at the centre and moved there. */
function Packet({ c, spec, path, color }: { c: Ctx; spec: LayerSpec; path: number[]; color: string }) {
  const { clock, k, calm } = c;
  const style = useAnimatedStyle(() => {
    const T = clock.value;
    const p = T < 0 ? -1 : loopAt(T, spec.period, spec.delay);
    const q = p < 0 || !spec.x ? spec.rest.x : trackAt(spec.x, p, calm);
    const o = p < 0 || !spec.o ? spec.rest.o : trackAt(spec.o, p, calm);
    const pt = cubicPoint(path, q);
    return { opacity: o, transform: [{ translateX: (pt.x - VB_W / 2) * k }, { translateY: (pt.y - VB_H / 2) * k }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[ABS, { width: c.w, height: c.h }, style]}>
      <Drawing w={c.w} h={c.h}>
        <Circle cx={VB_W / 2} cy={VB_H / 2} r={3} fill={color} />
      </Drawing>
    </Animated.View>
  );
}

export function Pictogram({ kind, size = "md", idle, bg, style }: { kind: PictogramKind; size?: PictogramSize; /** Agent without a job: slower, nothing connects. */ idle?: boolean; /** Fill behind the drawing (default: page). */ bg?: string; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  const m = useMotion();
  const z = PICTOGRAM_SIZE[size];
  const clock = useClock(!m.reduced);
  const c: Ctx = { clock, k: z.w / VB_W, w: z.w, h: z.h, calm: m.calm };
  const col = { ln: th.t2, f: th.t3, ac: th.accent, bg: bg ?? th.bgMainWindow, on: th.onAccent };
  const ln = { stroke: col.ln, strokeWidth: z.line, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const f = { ...ln, stroke: col.f };
  const ac = { stroke: col.ac, strokeWidth: z.accent, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

  let body: ReactNode = null;
  if (kind === "inbox")
    body = (
      <>
        <Layer c={c} spec={INBOX.sheet}>
          <Rect x={52} y={26} width={46} height={34} rx={4} {...ln} fill={col.bg} />
          <Path d="M60 37h30M60 45h22" {...f} />
        </Layer>
        <Layer c={c} spec={INBOX.tray}>
          <Path d="M30 64h22l6 12h34l6-12h22v28a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z" {...ln} fill={col.bg} />
        </Layer>
        <Layer c={c} spec={INBOX.check}>
          <DashPath c={c} spec={INBOX.check} d="M66 86l6 6 12-12" stroke={col.ac} width={z.accent} dash="30" />
        </Layer>
      </>
    );
  else if (kind === "agent") {
    const a = idle ? AGENT_IDLE : AGENT;
    const wireOpacity = idle ? AGENT_IDLE.wire.rest.o : 1;
    body = (
      <>
        <View style={ABS}>
          <Drawing w={c.w} h={c.h}>
            <Circle cx={75} cy={60} r={40} {...f} fill="none" strokeDasharray="2 6" />
          </Drawing>
        </View>
        <Layer c={c} spec={a.orb}>
          <Circle cx={115} cy={60} r={4} fill={col.f} />
          <Circle cx={35} cy={60} r={3} fill={col.f} />
          <DashPath c={c} spec={a.wire} d="M115 60 L 88 60" stroke={col.f} width={z.line} dash="3 5" opacity={wireOpacity} />
        </Layer>
        <Layer c={c} spec={a.orb2}>
          <Circle cx={75} cy={22} r={3.5} fill={col.f} />
          <DashPath c={c} spec={a.wire} d="M75 22 L 75 46" stroke={col.f} width={z.line} dash="3 5" opacity={wireOpacity} />
        </Layer>
        <Layer c={c} spec={a.spark}>
          <Path d="M75 46c1.6 7 5 10.4 12 12-7 1.6-10.4 5-12 12-1.6-7-5-10.4-12-12 7-1.6 10.4-5 12-12z" {...ac} />
        </Layer>
      </>
    );
  } else if (kind === "sync")
    body = (
      <>
        <View style={ABS}>
          <Drawing w={c.w} h={c.h}>
            <Rect x={22} y={42} width={26} height={34} rx={3} {...ln} fill="none" />
            <Rect x={102} y={42} width={26} height={34} rx={3} {...ln} fill="none" />
            <Path d="M28 52h14M28 59h10M108 52h14M108 59h10" {...f} />
          </Drawing>
        </View>
        <Layer c={c} spec={SYNC.arrows}>
          <Path d="M75 42a18 18 0 0 1 16 10M75 78a18 18 0 0 1-16-10" {...f} />
          <Path d="M91 46v6h-6M59 74v-6h6" {...f} />
        </Layer>
        <Packet c={c} spec={SYNC.packetA} path={SYNC_PATH_A} color={col.ac} />
        <Packet c={c} spec={SYNC.packetB} path={SYNC_PATH_B} color={col.ac} />
      </>
    );
  else if (kind === "stack")
    body = (
      <>
        <Layer c={c} spec={STACK.left}>
          <Rect x={50} y={34} width={50} height={64} rx={6} {...f} fill={col.bg} />
        </Layer>
        <Layer c={c} spec={STACK.right}>
          <Rect x={50} y={34} width={50} height={64} rx={6} {...f} fill={col.bg} />
        </Layer>
        <View style={ABS}>
          <Drawing w={c.w} h={c.h}>
            <Rect x={50} y={34} width={50} height={64} rx={6} {...ln} fill={col.bg} />
            <Path d="M58 46h26M58 54h34M58 62h20" {...f} />
          </Drawing>
        </View>
        <Layer c={c} spec={STACK.ok}>
          <Circle cx={104} cy={30} r={10} fill={col.ac} />
          <Path d="M99 30l3.5 3.5L109 27" stroke={col.on} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Layer>
      </>
    );
  else if (kind === "search")
    body = (
      <>
        {SEARCH_ROWS.map(([x, y, w], i) => (
          <Layer key={i} c={c} spec={SEARCH.rows[i]!}>
            <Rect x={x} y={y} width={w} height={8} rx={4} {...f} fill="none" />
          </Layer>
        ))}
        <Layer c={c} spec={SEARCH.lens}>
          <Circle cx={75} cy={58} r={16} {...ln} fill={col.bg} fillOpacity={0.6} />
          <Path d="M87 70l12 12" {...ac} />
        </Layer>
      </>
    );
  else
    body = (
      <>
        <Layer c={c} spec={IDEA.halo}>
          <Circle cx={75} cy={52} r={20} fill={col.ac} />
        </Layer>
        {IDEA_RAYS.map((d, i) => (
          <Layer key={d} c={c} spec={IDEA.rays[i]!}>
            <DashPath c={c} spec={IDEA.rays[i]!} d={d} stroke={col.ln} width={z.line} dash="10" />
          </Layer>
        ))}
        <View style={ABS}>
          <Drawing w={c.w} h={c.h}>
            <Path d="M64 74c0-8-10-12-10-24a21 21 0 0 1 42 0c0 12-10 16-10 24z" {...ln} fill="none" />
            <Path d="M66 82h18M69 90h12" {...ac} />
          </Drawing>
        </View>
      </>
    );

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ width: z.w, height: z.h, alignSelf: "center" }, style]}
    >
      {body}
    </View>
  );
}
