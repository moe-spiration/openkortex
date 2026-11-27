import { useEffect, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { alpha } from "../theme/color";
import { FONT, RADIUS, ruheWeight, TYPE, type TagTone, type TypeStep, type Theme } from "../theme/tokens";
import { isPackCover, type CoverSource } from "../theme/cover";
import { PackTileImage } from "../theme/PackImages";
import { useTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";
import { useGesturePlay } from "./ruhe/gestures";
import { tick } from "../lib/haptics";

/* Building blocks of the mobile design system (kx-* classes of the prototype as React Native components). */

/** `inset 0 0 0 1px <color>`: the prototype's hairline ring. Cast: RN types the string form loosely. */
export const ring = (color: string, px = 1): ViewStyle => ({ boxShadow: `inset 0 0 0 ${px}px ${color}` }) as ViewStyle;

/**
 * A content panel. Classic: a soft card. Ruhe ("structure you feel, not see"): no box, only a hairline above,
 * the content runs on the canvas (web ruhe-views: journal without panel).
 */
export const panel = (th: Theme, gap = 10): ViewStyle =>
  th.look === "ruhe"
    ? ({ gap, paddingTop: 14, paddingBottom: 4, boxShadow: `inset 0 1px 0 0 ${th.hair}` } as ViewStyle)
    : { gap, padding: 14, borderRadius: RADIUS.card, backgroundColor: alpha(th.bgSurfaceFlat, 0.72) };

/** A list row surface. Classic: a filled row card. Ruhe: flat with a hairline below. */
export const rowSurface = (th: Theme): ViewStyle =>
  th.look === "ruhe" ? ({ borderRadius: 0, backgroundColor: "transparent", paddingHorizontal: 2, boxShadow: `inset 0 -1px 0 0 ${th.hair}` } as ViewStyle) : { borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceFlat };

export const glass = (th: Theme): ViewStyle =>
  ({
    backgroundColor: th.bgFloatingGlass,
    ...(Platform.OS === "web" ? { backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)" } : null),
  }) as ViewStyle;

/* ------------------------------------------------------------------ text */

export interface TProps extends TextProps {
  size?: number;
  weight?: 300 | 400 | 500 | 600 | 700;
  color?: string;
  lh?: number;
  /** Letter-spacing in em (CSS), converted to px. */
  ls?: number;
  mono?: boolean;
  /** @deprecated Typography v2: use `type="display"` etc. Kept as Geist 600. */
  display?: boolean;
  /** Typography v2 step (size, line height, weight, tracking); explicit props still override. */
  type?: TypeStep;
  /** Tabular mono numbers (`kx-num`). */
  num?: boolean;
  align?: TextStyle["textAlign"];
}

/** Base text: Geist 13/20, 500, -0.01em (prototype body). */
/**
 * Ruhe type steps (2026-11-26, 700 since 2026-11-27 with Geist 700 loaded): page titles large and tight (30/700, -0.03 em), section titles 600, the light
 * display/greeting step becomes a page title too. Everything else keeps the v2 scale.
 */
const RUHE_T: Partial<Record<keyof typeof TYPE, { size: number; lh: number; weight: number; ls: number }>> = {
  display: { size: 30, lh: 36, weight: 700, ls: -0.03 },
  greeting: { size: 30, lh: 36, weight: 700, ls: -0.03 },
  h1: { size: 28, lh: 34, weight: 700, ls: -0.03 },
  h2: { size: 15, lh: 22, weight: 500, ls: -0.01 },
  h3: { size: 15, lh: 22, weight: 500, ls: -0.01 },
};

export function T({ type, size: sizeProp, weight: weightProp, color, lh: lhProp, ls: lsProp, mono, display, num, align, style, children, ...rest }: TProps) {
  const th = useTheme();
  const ruhe = th.look === "ruhe";
  const step = type ? (ruhe ? (RUHE_T[type] ?? TYPE[type]) : TYPE[type]) : undefined;
  const size = sizeProp ?? step?.size ?? 13;
  const raw = (weightProp ?? step?.weight ?? 500) as 300 | 400 | 500 | 600 | 700;
  // Ruhe: one step finer, no bold below title size (tokens ruheWeight); vivid keeps its weights.
  const weight = ruhe ? ruheWeight(raw, size) : raw;
  const lh = lhProp ?? step?.lh ?? 20;
  const ls = lsProp ?? step?.ls ?? -0.01;
  // Ruhe: numbers stay in Geist with tabular figures (density through type), mono only for real code.
  const monoFace = mono || (num && !ruhe);
  const family = display && !ruhe ? FONT.display : monoFace ? (weight <= 400 ? FONT.mono400 : FONT.mono500) : weight === 300 ? FONT.sans300 : weight === 400 ? FONT.sans400 : weight === 600 ? FONT.sans600 : weight === 700 ? FONT.sans700 : FONT.sans500;
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: family,
          fontSize: size,
          lineHeight: lh,
          letterSpacing: ls * size,
          color: color ?? th.textPrimary,
          textAlign: align,
          ...(num && ruhe ? { fontVariant: ["tabular-nums" as const] } : null),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** `kx-eyebrow`: Geist meta 12.5/18, muted (Typography v2: not mono). */
export function Eyebrow({ size = 12, color, style, children }: { size?: number; color?: string; style?: StyleProp<TextStyle>; children: ReactNode }) {
  const th = useTheme();
  return (
    <T weight={400} size={size} lh={18} ls={0} color={color ?? th.textMuted} style={style}>
      {children}
    </T>
  );
}

/** `kx-help`: meta step 12.5/18, 400, muted. */
export function Help({ size = 12, color, style, numberOfLines, align, children }: { size?: number; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; align?: TextStyle["textAlign"]; children: ReactNode }) {
  const th = useTheme();
  return (
    <T weight={400} size={size} lh={18} ls={0} color={color ?? th.textMuted} numberOfLines={numberOfLines} align={align} style={style}>
      {children}
    </T>
  );
}

/** `kx-label`: meta step 12/18, 500, secondary. */
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const th = useTheme();
  return (
    <T weight={500} size={12} lh={18} ls={0} color={th.textSecondary} style={style}>
      {children}
    </T>
  );
}

/** Group head in 11 px uppercase, +0.06em (`micro` step). */
export function Micro({ children, color, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  const th = useTheme();
  // Ruhe: labels in sentence case (mockup `.mlab`), no uppercase tracking.
  if (th.look === "ruhe")
    return (
      <T size={13} lh={18} ls={0} weight={600} color={color ?? th.t2} style={style}>
        {children}
      </T>
    );
  return (
    <T type="micro" color={color ?? th.textMuted} style={[{ textTransform: "uppercase" }, style]}>
      {children}
    </T>
  );
}

/** Section head: the H3 step of the v2 scale (15/22, 500). */
export function Section({ children }: { children: ReactNode }) {
  return (
    <T type="h3">
      {children}
    </T>
  );
}

/* ------------------------------------------------------------------ layout helpers */

export const row = (gap = 8): ViewStyle => ({ flexDirection: "row", alignItems: "center", gap });
export const fill: ViewStyle = { flex: 1, minWidth: 0 };

/* ------------------------------------------------------------------ pill, badge, tile */

export function tagColors(th: Theme, tone: TagTone) {
  return th.tags[tone];
}

export function Pill({
  tone = "ai",
  sm,
  nodot,
  suggest,
  on = true,
  onPress,
  children,
  style,
  accessibilityLabel,
  minHeight,
}: {
  tone?: TagTone;
  sm?: boolean;
  nodot?: boolean;
  /** Dashed, unselected suggestion chip (`kx-pill--suggest`). */
  suggest?: boolean;
  on?: boolean;
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  minHeight?: number;
}) {
  const th = useTheme();
  const c = tagColors(th, tone);
  const dashed = suggest && !on;
  // V2-11E: the tag colour is only the dot. No fill, no tinted border (`kx-pill--quiet`); an
  // unselected suggestion keeps a neutral dashed outline so it still reads as tappable.
  const content = (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: sm ? 5 : 6,
          height: sm ? 20 : 24,
          paddingHorizontal: dashed ? 8 : 0,
          borderRadius: RADIUS.pill,
          borderWidth: dashed ? 1 : 0,
          borderStyle: "dashed",
          borderColor: alpha(th.textMuted, 0.6),
        },
        style,
      ]}
    >
      {!nodot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.dot }} />}
      {typeof children === "string" ? (
        <T size={12.5} lh={18} ls={0} color={dashed ? th.textMuted : th.textSecondary}>
          {children}
        </T>
      ) : (
        children
      )}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel} style={({ pressed }) => ({ minHeight, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

export function Badge({ children, accent, style }: { children: ReactNode; accent?: boolean; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return (
    <View
      style={[
        {
          minWidth: 18,
          height: 18,
          paddingHorizontal: 5,
          borderRadius: RADIUS.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: accent ? th.accentAiSolid : th.bgSurfaceMuted,
        },
        style,
      ]}
    >
      <T mono size={11} lh={20} ls={0} color={accent ? th.onAccentAi : th.textSecondary}>
        {children}
      </T>
    </View>
  );
}

export function IconTile({ icon, tone = "muted", large, size }: { icon?: IconName; tone?: "muted" | "ai"; large?: boolean; size?: number }) {
  const th = useTheme();
  const w = large ? 44 : 32;
  const ai = tone === "ai";
  return (
    <View
      style={[
        { width: w, height: w, borderRadius: large ? RADIUS.xl : RADIUS.lg, alignItems: "center", justifyContent: "center", backgroundColor: ai ? th.accentAiSoft : th.bgSurfaceMuted },
      ]}
    >
      {icon && <Icon name={icon} color={ai ? th.tags.ai.fg : th.textSecondary} size={size ?? (large ? 20 : 16)} />}
    </View>
  );
}

/* ------------------------------------------------------------------ buttons */

/** Press-in scale of buttons and tappable rows (static, no animation: cheap and immediate). */
export const PRESS_IN = [{ scale: 0.97 }];
const NO_PRESS = [{ scale: 1 }];

type BtnVariant = "primary" | "secondary" | "ghost" | "ai" | "checkin";

export function Btn({
  variant = "secondary",
  sm,
  block,
  round,
  icon,
  iconOnly,
  size,
  minHeight,
  onPress,
  children,
  accessibilityLabel,
  color,
  style,
  grow,
}: {
  variant?: BtnVariant;
  sm?: boolean;
  block?: boolean;
  round?: boolean;
  icon?: IconName;
  iconOnly?: boolean;
  /** Fixed width/height of an icon button. */
  size?: number;
  minHeight?: number;
  onPress?: () => void;
  children?: ReactNode;
  accessibilityLabel?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
  grow?: boolean;
}) {
  const th = useTheme();
  const bg =
    variant === "primary" ? th.accentAiSolid : variant === "checkin" ? alpha(th.accentCheckin, 0.22) : variant === "ai" ? th.accentAiSoft : variant === "ghost" ? "transparent" : th.bgSurfaceMuted;
  const fg = variant === "primary" ? th.onAccentAi : variant === "checkin" ? th.accentCheckin : variant === "ai" ? th.tags.ai.fg : variant === "ghost" ? th.textSecondary : th.textPrimary;
  // Flat first (2026-11-01): fills carry the button, no outline; touch height 44 (36 small).
  const ringColor = null as string | null;
  const h = sm ? 36 : 44;
  const [play, fire] = useGesturePlay();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={
        onPress
          ? () => {
              fire();
              onPress();
            }
          : undefined
      }
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: sm ? 5 : 6,
          height: size ?? undefined,
          width: iconOnly ? (size ?? (sm ? 36 : 44)) : block ? "100%" : undefined,
          minHeight: Math.max(minHeight ?? 0, size ?? h),
          paddingHorizontal: iconOnly ? 0 : sm ? 10 : 12,
          // V2-11F: controls are 8; only round icon buttons stay circles.
          borderRadius: round && iconOnly ? RADIUS.pill : RADIUS.control,
          backgroundColor: bg,
          // Touch feedback: a clear dim plus a slight press-in, so every tap visibly lands.
          opacity: pressed ? 0.7 : 1,
          transform: pressed ? PRESS_IN : NO_PRESS,
          flexGrow: grow ? 1 : 0,
          flexShrink: grow ? 1 : 0,
          flexBasis: grow ? 0 : undefined,
        },
        ringColor ? ring(ringColor) : null,
        style,
      ]}
    >
      {icon && <Icon name={icon} play={play} color={color ?? fg} />}
      {typeof children === "string" ? (
        <T size={sm ? 12 : 13} lh={20} color={color ?? fg} numberOfLines={1}>
          {children}
        </T>
      ) : (
        children
      )}
    </Pressable>
  );
}

/** Round icon button (header avatar, close buttons ...). */
export function Press({ onPress, style, children, accessibilityLabel, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={style} {...rest}>
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ progress, check, switch, spinner */

export function Progress({ pct, color, height = 3, style }: { pct: number; color?: string; height?: number; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return (
    <View style={[{ height, borderRadius: 2, backgroundColor: th.bgSurfaceMuted, overflow: "hidden" }, style]}>
      <View style={{ width: `${pct}%`, height: "100%", borderRadius: 2, backgroundColor: color ?? th.textSecondary }} />
    </View>
  );
}

export function Check({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={onPress} hitSlop={12}>
      <View style={[{ width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: on ? th.accentAiSolid : th.bgSurfaceFlat }, on ? null : ring(alpha(th.textMuted, 0.7), 1.5)]}>
        {on && <Icon name="check" color={th.onAccentAi} size={13} strokeWidth={2.6} />}
      </View>
    </Pressable>
  );
}

export function Toggle({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={() => {
        tick();
        onPress();
      }}
      hitSlop={8}
    >
      <View style={{ width: 40, height: 24, borderRadius: RADIUS.pill, backgroundColor: on ? th.accentAiSolid : th.bgSurfaceMuted }}>
        <View style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF" }} />
      </View>
    </Pressable>
  );
}

export function Spinner({ color, size = 14 }: { color?: string; size?: number }) {
  const th = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color ?? th.textMuted,
        borderRightColor: "transparent",
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
      }}
    />
  );
}

/* ------------------------------------------------------------------ images */

export function Photo({ source, style }: { source: CoverSource; style?: StyleProp<ViewStyle> }) {
  // Type tile of the active theme pack (cover fallback, spec 4); resolved here because the pack can change at any time.
  if (isPackCover(source)) {
    return (
      <View style={[{ width: "100%", height: "100%", overflow: "hidden" }, style]}>
        <PackTileImage topic={source.pack} />
      </View>
    );
  }
  // Android decodes a remote cover at its full size unless told otherwise; "resize" decodes it at the size it
  // is shown (a 60px thumbnail instead of a 2000px Recall cover), which keeps long lists smooth.
  return <Image source={source} resizeMode="cover" resizeMethod="resize" fadeDuration={0} style={[{ width: "100%", height: "100%" }, style as never]} />;
}

/** Image behind a fade into `bg` (`kx-hero` + `kx-hero-fade--top`). The image covers the top `heroH` of the box. */
export function HeroTop({ source, heroH, bg, children, style }: { source: CoverSource; heroH: `${number}%` | number; bg: string; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ overflow: "hidden" }, style]}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: heroH }}>
        <Photo source={source} />
        <LinearGradient colors={[alpha(bg, 0.08), alpha(bg, 0.55), bg]} locations={[0, 0.55, 1]} style={{ position: "absolute", inset: 0 } as ViewStyle} />
      </View>
      {children}
    </View>
  );
}

/** Image on the right edge fading to the card background (`kx-hero-img--side`). */
export function HeroSide({ source, heroW, bg }: { source: CoverSource; heroW: `${number}%`; bg: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: heroW }}>
      <Photo source={source} />
      <LinearGradient colors={[bg, alpha(bg, 0.4), alpha(bg, 0.1)]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", inset: 0 } as ViewStyle} />
    </View>
  );
}

/* ------------------------------------------------------------------ motion */

/** Slides up 24px and fades in (`kx-slide-up`, 180ms). */
export function SlideUp({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 180, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: Platform.OS !== "web" }).start();
  }, [v]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>{children}</Animated.View>;
}

/** Fades in with a 6px rise (`kx-in`, 150ms). */
export function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 150, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: Platform.OS !== "web" }).start();
  }, [v]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>{children}</Animated.View>;
}

/** Audio waveform (`Wave.dc.html`): bars with an envelope and looping heights. */
export function Wave({ n = 30, h = 18, tone = "ai" }: { n?: number; h?: number; tone?: "ai" | "mic" | "out" }) {
  const th = useTheme();
  const color = tone === "mic" ? th.accentCheckin : tone === "out" ? th.tags.auto.dot : th.accentAi;
  const bars = Array.from({ length: n }, (_, i) => {
    const env = Math.pow(Math.sin((Math.PI * (i + 0.5)) / n), 0.7);
    const jitter = 0.55 + 0.45 * Math.abs(Math.sin(i * 12.9898 + n * 3.1));
    return { hp: Math.max(14, Math.round(100 * env * jitter * 0.9)), dur: 700 + ((i * 37) % 9) * 100, delay: ((i * 53) % 11) * 100, op: 0.45 + 0.55 * env };
  });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, height: h }}>
      {bars.map((b, i) => (
        <WaveBar key={i} h={(h * b.hp) / 100} dur={b.dur} delay={b.delay} opacity={b.op} color={color} />
      ))}
    </View>
  );
}

function WaveBar({ h, dur, delay, opacity, color }: { h: number; dur: number; delay: number; opacity: number; color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    const id = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(id);
      loop.stop();
    };
  }, [v, dur, delay]);
  return <Animated.View style={{ width: 2.5, height: h, borderRadius: 2, backgroundColor: color, opacity, transform: [{ scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }} />;
}

/** Segmented control (`kx-tabs`). */
export function Segmented<K extends string>({ items, value, onChange, small, label, minHeight, fill }: { items: { key: K; label?: string; icon?: IconName; aria?: string }[]; value: K; onChange: (k: K) => void; small?: boolean; label?: string; minHeight?: number; fill?: boolean }) {
  const th = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: "row", gap: 2, padding: 3, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted, alignSelf: fill ? "stretch" : "flex-start" }}>
      {items.map((it) => {
        const sel = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityLabel={it.aria ?? it.label}
            accessibilityState={{ selected: sel }}
            onPress={() => {
              if (!sel) tick();
              onChange(it.key);
            }}
            style={({ pressed }) => ({ flex: fill ? 1 : undefined, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: fill ? 4 : 6, height: small ? 32 : 40, minHeight, paddingHorizontal: fill ? 4 : 12, borderRadius: RADIUS.control, backgroundColor: sel ? th.bgSurfaceFlat : pressed ? alpha(th.textPrimary, 0.06) : "transparent" })}
          >
            {it.icon && <Icon name={it.icon} size={14} color={sel ? th.textPrimary : th.textSecondary} />}
            {it.label && (
              <T size={small ? 12 : 13} lh={20} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} color={sel ? th.textPrimary : th.textSecondary}>
                {it.label}
              </T>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
