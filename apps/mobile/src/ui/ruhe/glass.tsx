import { createContext, useContext, type ComponentRef, type ReactNode, type RefObject } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { alpha } from "../../theme/color";
import { RUHE_GLASS } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { useReduceMotion } from "./motion";

/*
 * Glass is a recipe, not a style (android-richtlinien section 6). Exactly four things float on glass: the tab bar,
 * the neutral context button, sheets and menus. Never on content, never glass on glass, at most three at a time.
 *
 * Android: real blur through expo-blur (`BlurView` + `BlurTargetView`, Dimezis, API 31+ only). Below API 31 and with
 * "reduce motion" the same layout gets a calm opaque fill (glassStrong at .94) plus the ring. The web build uses
 * CSS backdrop-filter. No fake glass effects (no gradients, no specular edges).
 */

type BlurTarget = RefObject<ComponentRef<typeof View> | null>;

const BlurTargetCtx = createContext<BlurTarget | null>(null);

/** Provided by the tab layout: the view behind every floating glass surface (expo-blur needs it on Android). */
export function GlassTargetProvider({ target, children }: { target: BlurTarget; children: ReactNode }) {
  return <BlurTargetCtx.Provider value={target}>{children}</BlurTargetCtx.Provider>;
}

export const useGlassTarget = (): BlurTarget | null => useContext(BlurTargetCtx);

export type GlassVariant = "bar" | "sheet" | "knob";

/** True where a real blur is drawn: Android 12 (API 31) and newer, or the web. */
export const canBlur = (): boolean => Platform.OS === "web" || (Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version >= 31);

const RECIPE: Record<GlassVariant, { blur: number; sat: number; intensity: number; fill: number }> = {
  bar: { blur: 22, sat: 160, intensity: 40, fill: 0.72 },
  knob: { blur: 22, sat: 160, intensity: 40, fill: 0.72 },
  sheet: { blur: 26, sat: 150, intensity: 50, fill: 0.84 },
};

/**
 * A floating glass surface: ring `0 0 0 1px hairStrong` plus the soft drop (the only shadow of the look), the fill
 * and blur behind the children. `radius` is the surface's one radius (bar 29, knob 29, sheet 36).
 */
export function RGlass({ variant = "bar", radius, style, children, pointerEvents }: { variant?: GlassVariant; radius: number; style?: StyleProp<ViewStyle>; children?: ReactNode; pointerEvents?: "auto" | "box-none" | "none" | "box-only" }) {
  const th = useTheme();
  return (
    <View pointerEvents={pointerEvents} style={[{ borderRadius: radius, boxShadow: glassEdge(th) } as ViewStyle, style]}>
      <GlassFill variant={variant} radius={radius} />
      {children}
    </View>
  );
}

/** Ring plus drop of a floating glass surface (the only shadow of the look). */
export const glassEdge = (th: ReturnType<typeof useTheme>): string => `0 0 0 1px ${th.hairStrong}, ${dropOf(th.name)}`;

/** The glass behind a floating surface (absolute fill): blur where possible, else the calm opaque fill. */
export function GlassFill({ variant = "bar", radius }: { variant?: GlassVariant; radius: number }) {
  const th = useTheme();
  const target = useGlassTarget();
  const reduced = useReduceMotion();
  const r = RECIPE[variant];
  const base = RUHE_GLASS[th.name];
  const web = Platform.OS === "web";
  const blur = !reduced && canBlur() && (web || !!target);
  // Web reads the mockup 1:1 (.72 everywhere); Android gets a denser sheet fill under blur and a near-opaque one without.
  const fill = alpha(base, blur ? (web ? 0.72 : r.fill) : 0.94);
  return (
    <View
      pointerEvents="none"
      style={[
        { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius, overflow: "hidden", backgroundColor: web ? fill : undefined } as ViewStyle,
        web && blur ? ({ backdropFilter: `blur(${r.blur}px) saturate(${r.sat}%)`, WebkitBackdropFilter: `blur(${r.blur}px) saturate(${r.sat}%)` } as ViewStyle) : null,
      ]}
    >
      {!web && blur && target && (
        <BlurView intensity={r.intensity} tint={th.name === "dark" ? "dark" : "light"} blurTarget={target} blurMethod="dimezisBlurViewSdk31Plus" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      )}
      {!web && <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: fill }} />}
    </View>
  );
}

/** The floating drop of the look (mockup `--shadow`). */
export const dropOf = (name: "dark" | "light"): string => (name === "dark" ? "0 12px 40px -12px rgba(0, 0, 0, 0.6)" : "0 12px 40px -14px rgba(40, 30, 20, 0.22)");

/** Scrim behind a sheet: lum0 at 45 % (never black). */
export const scrimOf = (th: ReturnType<typeof useTheme>): string => alpha(th.lum0, 0.45);

/**
 * Edge fade (`.edgeblur`): the canvas runs out under the tab bar and the context button. 140 high, transparent to
 * lum1 at 85 %. No line, no blur, nothing at the top (the status bar is transparent, titles scroll away).
 */
export function EdgeFade({ height = 140 }: { height?: number }) {
  const th = useTheme();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[alpha(th.lum1, 0), th.lum1, th.lum1]}
      locations={[0, 0.85, 1]}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height, zIndex: 11 }}
    />
  );
}
