import { msg, t, tx } from "../i18n";
import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from "react";
import { ScratchpadSheet } from "./ScratchpadSheet";
import { Animated, Easing, Image, Platform, Pressable, TextInput, View, type ViewStyle } from "react-native";
import * as Clipboard from "expo-clipboard";
import { usePathname, useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import RAnimated, { FadeIn, makeMutable, runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { LevelHalo, LevelWave } from "../capture/LevelWave";
import { pttMayStart } from "../capture/ptt";
import { PTT_DISCARD, PTT_NO_RECTS, PTT_NONE, PTT_SAVE, pttDropTarget } from "../capture/pttDrop";
import { IMG, NOTE_TAGS } from "../data/mock";
import { buzz, tick } from "../lib/haptics";
import { lensOf } from "../lib/library";
import { routeOf } from "../lib/answers";
import { PHOTO_MODES, useApp, type CaptureKind } from "../state/AppState";
import { useData } from "../state/Data";
import { alpha, mix } from "../theme/color";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { FONT, RADIUS, RUHE_TYPE } from "../theme/tokens";
import { useChrome } from "./Chrome";
import { useGesturePlay } from "./ruhe/gestures";
import { Icon, type IconName } from "./Icon";
import { Btn, glass, Photo, ring, SlideUp, T, Wave, Help } from "./primitives";
import { RUHE_BAR, TABBAR, useBarBottom } from "./Shell";
import { RGlass, RIconButton, RSheet, RSheetChip, RText } from "./ruhe";
import { SwipeSheet } from "./SwipeSheet";
import { useKeyboardInset } from "./useKeyboard";

/* Capture: ring-fan orb (tap = voice, hold = fan with voice / note / photo), push-to-talk card, quick note, camera. */

const FAN: { k: CaptureKind; label: string; icon: IconName; tx: number; ty: number }[] = [
  { k: "voice", label: msg("Voice"), icon: "mic", tx: -96, ty: -36 },
  { k: "note", label: msg("Note"), icon: "note", tx: 0, ty: -96 },
  { k: "photo", label: msg("Photo"), icon: "camera", tx: 96, ty: -36 },
];

const FAN_ANCHOR_BOTTOM = 52;
/** Distance of an item's circle centre above the fan anchor (circle 56 + gap 6 + label 20, circle centre 28 from the top). */
const FAN_ITEM_H = 82;
const HOLD_MS = 380;
const HIT_RADIUS = 46;

/*
 * Push-to-talk drop state, shared between the orb (gesture) and the voice card (buttons). The targets are the
 * card's own buttons, no floating bubbles: the card measures them into `pttRects` (window coordinates), the
 * gesture hit-tests the finger against them on the UI thread and writes `pttTgt`, and the buttons animate
 * from it. One orb and one card exist at a time, so module-level shared values are enough.
 */
const pttTgt = makeMutable<number>(PTT_NONE);
const pttActive = makeMutable<number>(0);
const pttRects = makeMutable<number[]>(PTT_NO_RECTS);

/** Pages of the Heute family: the accent capture button (tap = sheet, hold = push-to-talk). */
const ACCENT_PAGES = ["/", "/journal", "/life", "/tasks", "/inbox"];

/**
 * Context button of the Ruhe look (section 9 table): accent sparkles on a detail page (ask about it), accent mic on Heute and its pages, a neutral glass plus on the
 * Einträge list (new note), a glass mic on Agent (speak to it); none on the other library lenses, search, the ask
 * composer (it has its own mic) and settings, and none while the capture sheet is open (it has its own send button).
 */
export function fabVariant(path: string, a: { cap: CaptureKind | null; searchOpen: boolean; scope: string; chip: string; view: string; sheet: unknown }): "accent" | "plus" | "agent" | "ask" | null {
  if (a.cap === "note") return null;
  // A detail page (entry, dossier, life area) is open: ask about it.
  if (a.sheet) return "ask";
  if (ACCENT_PAGES.includes(path)) return "accent";
  if (path === "/agent") return "agent";
  if (path === "/entries") return !a.searchOpen && lensOf(a.scope, a.chip) === "types" && a.view !== "grid" ? "plus" : null;
  return null;
}

/**
 * The 60px orb with a radial gradient; red while recording, flat while the fan is open.
 * Tap = fan (voice / note / photo / link). Hold = push-to-talk: recording starts and the voice card shows;
 * sliding onto its "Verwerfen" or "In Inbox" button highlights that button with a haptic tick, releasing there
 * runs it, releasing elsewhere saves. With the fan open, sliding onto an option and releasing picks it.
 */
export function Orb({ rootRef }: { rootRef: RefObject<ComponentRef<typeof View> | null> }) {
  const th = useTheme();
  const ruhe = useRuhe();
  const ruheRef = useRef(ruhe);
  ruheRef.current = ruhe;
  const [orbPlay, fireOrb] = useGesturePlay();
  const { width, height } = useChrome();
  const app = useApp();
  const path = usePathname();
  const router = useRouter();
  const data = useData();
  const barBottom = useBarBottom();
  const origin = useRef({ x: 0, y: 0 });
  const live = useRef(app);
  live.current = app;
  const geo = useRef({ width, height });
  geo.current = { width, height };

  const press = useSharedValue(0);
  const tgt = pttTgt;
  const active = pttActive;
  const rects = pttRects;
  // Whether a hold may start (see pttMayStart). Mirrored into a shared value so the gesture itself is never disabled mid-hold.
  const mayStart = useSharedValue(1);
  useEffect(() => {
    mayStart.value = pttMayStart(app.fan, app.cap) ? 1 : 0;
  }, [app.fan, app.cap, mayStart]);

  // The fan hit test works in window coordinates: measure the orb whenever the fan opens.
  useEffect(() => {
    if (app.fan) rootRef.current?.measureInWindow((x, y) => (origin.current = { x, y }));
  }, [app.fan, rootRef]);

  const hitTest = (mx: number, my: number): CaptureKind | null => {
    const { width: w, height: h } = geo.current;
    const px = mx - origin.current.x;
    const py = my - origin.current.y;
    let best: CaptureKind | null = null;
    let bestD = HIT_RADIUS;
    FAN.forEach((f) => {
      const cx = w / 2 + f.tx;
      const cy = h - FAN_ANCHOR_BOTTOM - FAN_ITEM_H + 28 + f.ty;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) {
        bestD = d;
        best = f.k;
      }
    });
    return best;
  };

  const startPtt = () => {
    buzz();
    live.current.openCap("voice");
  };
  const endPtt = (target: number) => {
    const a = live.current;
    if (target === PTT_DISCARD) a.discardVoice();
    else a.saveVoice();
  };
  const onTap = () => {
    const a = live.current;
    fireOrb();
    // Ruhe: a tap opens the glass capture sheet right away (no fan); holding still records.
    if (ruheRef.current && a.cap !== "voice") {
      if (a.cap === "note") a.closeCap();
      else a.openCap("note");
      return;
    }
    if (a.fan) {
      a.setFan(false);
      a.setHot(null);
    } else if (a.cap === "voice") a.saveVoice();
    else {
      a.setFan(true);
      a.setHot(null);
    }
  };
  const fanMove = (x: number, y: number) => {
    const a = live.current;
    const k = hitTest(x, y);
    if (k !== a.hot) {
      a.setHot(k);
      if (k) buzz();
    }
  };
  const fanEnd = () => {
    const a = live.current;
    if (a.hot) a.openCap(a.hot);
    else {
      a.setFan(false);
      a.setHot(null);
    }
  };

  const ptt = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      if (!mayStart.value) return;
      active.value = 1;
      tgt.value = PTT_NONE;
      runOnJS(startPtt)();
    })
    .onUpdate((e) => {
      if (!active.value) return;
      const n = pttDropTarget(e.absoluteX, e.absoluteY, rects.value);
      if (n !== tgt.value) {
        tgt.value = n;
        if (n) runOnJS(buzz)();
      }
    })
    .onFinalize(() => {
      if (!active.value) return;
      const n = tgt.value;
      active.value = 0;
      tgt.value = PTT_NONE;
      runOnJS(endPtt)(n);
    });
  const fanPan = Gesture.Pan()
    .enabled(app.fan)
    .minDistance(6)
    .onUpdate((e) => runOnJS(fanMove)(e.absoluteX, e.absoluteY))
    .onEnd(() => runOnJS(fanEnd)());
  const tap = Gesture.Tap()
    .maxDuration(HOLD_MS)
    .onBegin(() => {
      press.value = withTiming(1, { duration: 80 });
    })
    .onFinalize((_e, ok) => {
      press.value = withTiming(0, { duration: 120 });
      if (ok) runOnJS(onTap)();
    });
  const gesture = Gesture.Race(ptt, fanPan, tap);

  const orbScale = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.06 }] }));

  const rec = app.cap === "voice";
  const open = app.fan;
  if (ruhe) {
    // Ruhe context button (android-richtlinien section 9): what it is follows the page.
    const variant = rec ? "accent" : fabVariant(path, app);
    if (!variant) return null;
    const S = RUHE_BAR.fab;
    const pos: ViewStyle = { position: "absolute", right: RUHE_BAR.side, bottom: barBottom, width: S, height: S, zIndex: 17 };
    if (variant === "plus" || variant === "agent") {
      const agent = variant === "agent";
      return (
        <RAnimated.View key={variant} entering={FadeIn.duration(180)} style={pos}>
          <RGlass variant="knob" radius={S / 2} style={{ width: S, height: S }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={agent ? t("Speak to the agent") : t("New note")}
              onPress={() => {
                tick();
                fireOrb();
                if (agent) {
                  router.navigate("/ask");
                  if (!app.askRec) app.toggleAskRec();
                } else router.push("/editor");
              }}
              style={({ pressed }) => ({ width: S, height: S, borderRadius: S / 2, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.97 : 1 }] })}
            >
              <Icon name={agent ? "mic" : "plus"} size={22} strokeWidth={1.5} play={orbPlay} color={th.t1} />
            </Pressable>
          </RGlass>
        </RAnimated.View>
      );
    }
    if (variant === "ask") {
      const sh = app.sheet;
      const title = sh ? (sh.kind === "entry" ? data.entryById(sh.id)?.title : data.areas.find((x) => x.key === sh.id)?.name) : undefined;
      return (
        <RAnimated.View key="ask" entering={FadeIn.duration(180)} style={pos}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Ask about it")}
            onPress={() => {
              if (!sh) return;
              tick();
              fireOrb();
              app.closeSheet();
              router.navigate("/ask");
              app.ask(t("Summarize {title} for me", { title: title ?? "" }), sh.kind === "entry" && data.auth === "live" ? sh.id : undefined);
            }}
            style={({ pressed }) => ({ width: S, height: S, borderRadius: S / 2, alignItems: "center", justifyContent: "center", backgroundColor: th.accentFill, boxShadow: "0 12px 40px -12px rgba(0, 0, 0, 0.6)", transform: [{ scale: pressed ? 0.97 : 1 }] }) as ViewStyle}
          >
            <Icon name="sparkles" size={22} strokeWidth={1.5} play={orbPlay} color={th.onAccent} />
          </Pressable>
        </RAnimated.View>
      );
    }
    // Accent: tap opens the glass capture sheet, hold is push-to-talk. Recording: crit fill, stop, level ring.
    return (
      <RAnimated.View key="accent" entering={FadeIn.duration(180)} ref={rootRef} style={pos}>
        <GestureDetector gesture={gesture}>
          <RAnimated.View
            accessibilityRole="button"
            accessibilityLabel={rec ? t("Save voice memo") : t("Capture: tap to write, hold to speak")}
            style={[
              {
                width: S,
                height: S,
                borderRadius: S / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: rec ? th.crit : th.accentFill,
                boxShadow: `0 12px 40px -12px ${rec ? alpha(th.crit, 0.7) : "rgba(0, 0, 0, 0.6)"}`,
                ...(Platform.OS === "web" ? { touchAction: "none", userSelect: "none", cursor: "pointer" } : null),
              } as ViewStyle,
              orbScale,
            ]}
          >
            {rec && app.voiceRecorder && <LevelHalo recorder={app.voiceRecorder} size={S} color={th.crit} />}
            <Icon name={rec ? "stop" : "mic"} size={22} strokeWidth={1.5} play={orbPlay} color={rec ? "#FFFFFF" : th.onAccent} />
          </RAnimated.View>
        </GestureDetector>
      </RAnimated.View>
    );
  }
  const icon: IconName = open ? "x" : rec ? "stop" : "mic";
  const c1 = rec ? "#F87171" : mix(th.accentAi, 55, "#FFFFFF");
  const c2 = rec ? th.statusUrgent : th.accentAiSolid;
  const glow = rec ? th.statusUrgent : th.accentAi;
  return (
    <View ref={rootRef} style={{ position: "absolute", left: "50%", marginLeft: -30, bottom: TABBAR.bottom + 17, width: 60, height: 60, zIndex: 14 }}>
      <GestureDetector gesture={gesture}>
        <RAnimated.View
          accessibilityRole="button"
          accessibilityLabel={rec ? t("Save voice memo") : t("Capture: tap for voice, note, photo or link, hold to speak")}
          accessibilityState={{ expanded: open }}
          style={[
            {
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: open ? th.bgSurfaceFlat : "transparent",
              boxShadow: open ? `0 0 0 1px ${th.borderSubtle}, 0 0 0 4px ${th.bgMainWindow}` : `0 10px 24px -8px ${glow}, 0 0 0 4px ${th.bgMainWindow}`,
              ...(Platform.OS === "web" ? { touchAction: "none", userSelect: "none", cursor: "pointer" } : null),
            } as ViewStyle,
            orbScale,
          ]}
        >
          {rec && app.voiceRecorder && <LevelHalo recorder={app.voiceRecorder} size={60} color={th.statusUrgent} />}
          {!open && (
            <Svg width={60} height={60} style={{ position: "absolute" }}>
              <Defs>
                <RadialGradient id="orb" cx="32%" cy="28%" r="70%" fx="32%" fy="28%">
                  <Stop offset="0" stopColor={c1} />
                  <Stop offset="0.62" stopColor={c2} />
                  <Stop offset="1" stopColor={c2} />
                </RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={60} height={60} rx={30} fill="url(#orb)" />
            </Svg>
          )}
          <Icon name={icon} size={24} strokeWidth={2} color={open ? th.textPrimary : "#FFFFFF"} />
        </RAnimated.View>
      </GestureDetector>
    </View>
  );
}

function FanItem({ f, i, hot }: { f: (typeof FAN)[number]; i: number; hot: boolean }) {
  const th = useTheme();
  const { openCap } = useApp();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 220, delay: i * 40, easing: Easing.bezier(0.2, 1.3, 0.4, 1), useNativeDriver: Platform.OS !== "web" }).start();
  }, [v, i]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: -32,
        bottom: 0,
        width: 64,
        alignItems: "center",
        gap: 6,
        opacity: v,
        transform: [
          { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, f.tx] }) },
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, f.ty] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
        ],
      }}
    >
      <Pressable accessibilityRole="menuitem" accessibilityLabel={t(f.label)} onPress={() => openCap(f.k)} style={{ alignItems: "center", gap: 6 }}>
        <View
          style={[
            { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: hot ? th.accentAiSolid : th.bgSurfaceFlat, transform: [{ scale: hot ? 1.12 : 1 }], boxShadow: `0 0 0 1px ${th.borderSubtle}, 0 10px 24px -10px rgba(0,0,0,0.55)` } as ViewStyle,
          ]}
        >
          <Icon name={f.icon} size={22} color={hot ? "#FFFFFF" : th.textPrimary} />
        </View>
        <T size={12} lh={18} ls={0} color={th.textSecondary}>
          {t(f.label)}
        </T>
      </Pressable>
    </Animated.View>
  );
}

export function CaptureOverlays() {
  const th = useTheme();
  const ruhe = useRuhe();
  const { top, height } = useChrome();
  const a = useApp();
  return (
    <>
      {a.fan && (
        <>
          <Pressable accessibilityElementsHidden onPress={() => { a.setFan(false); a.setHot(null); }} style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 11, backgroundColor: alpha(th.bgAppShell, 0.55) }, Platform.OS === "web" ? ({ backdropFilter: "blur(10px)" } as never) : null]} />
          <View accessibilityRole="menu" accessibilityLabel={tx("menu", "Capture")} style={{ position: "absolute", left: "50%", bottom: FAN_ANCHOR_BOTTOM, width: 0, height: 0, zIndex: 13 }}>
            {FAN.map((f, i) => (
              <FanItem key={f.k} f={f} i={i} hot={a.hot === f.k} />
            ))}
          </View>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 262, zIndex: 13, alignItems: "center" }}>
            <T size={12.5} lh={20} ls={0} weight={500} color={th.textSecondary}>
              {t("Slide onto an option and release")}
            </T>
          </View>
        </>
      )}

      {a.cap === "voice" && ruhe && <RuheVoiceCard />}
      {a.cap === "voice" && !ruhe && (
        <SlideUp style={{ position: "absolute", left: 14, right: 14, bottom: 98, zIndex: 12 }}>
          <View style={[{ padding: 14, borderRadius: RADIUS["2xl"], gap: 10, boxShadow: th.shadowFloating } as ViewStyle, glass(th)]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <LiveDot />
              <T size={14} lh={20} weight={600} style={{ flex: 1 }}>
                {t("Voice memo")}
              </T>
              <T num size={13} lh={20} ls={0}>
                {a.voiceClock}
              </T>
            </View>
            <View style={{ alignItems: "center" }}>
              {a.voiceRecorder ? <LevelWave recorder={a.voiceRecorder} n={44} h={34} /> : <Wave n={44} h={34} />}
            </View>
            <VoiceActions onDiscard={a.discardVoice} onSave={a.saveVoice} live={a.live} />
          </View>
        </SlideUp>
      )}

      {a.cap === "note" && (ruhe ? <RuheQuickNote /> : <QuickNote />)}
      {a.cap === "scratchpad" && <ScratchpadSheet />}

      {a.cap === "photo" && (a.live ? <LivePhoto /> : <PhotoCapture top={top} height={height} />)}
    </>
  );
}

/**
 * Ruhe voice card: a glass sheet (radius 36, 8 from the edges) above the tab bar while the button records; the live
 * dot and clock, the level wave, and the two push-to-talk drop targets.
 */
function RuheVoiceCard() {
  const th = useTheme();
  const a = useApp();
  const bottom = useBarBottom() + RUHE_BAR.height + 12;
  return (
    <SlideUp style={{ position: "absolute", left: 8, right: 8, bottom, zIndex: 12 }}>
      <RGlass variant="sheet" radius={36} style={{ paddingTop: 16, paddingHorizontal: 18, paddingBottom: 18, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <LiveDot />
          <RText step="rowTitle" style={{ flex: 1 }}>
            {t("Voice memo")}
          </RText>
          <RText step="meta" tnum color={th.t2}>
            {a.voiceClock}
          </RText>
        </View>
        <View style={{ alignItems: "center" }}>{a.voiceRecorder ? <LevelWave recorder={a.voiceRecorder} n={44} h={34} /> : <Wave n={44} h={34} />}</View>
        <VoiceActions onDiscard={a.discardVoice} onSave={a.saveVoice} live={a.live} />
      </RGlass>
    </SlideUp>
  );
}

/**
 * Hint and the two voice card buttons. While the orb is held they are the push-to-talk drop targets: they are
 * measured into `pttRects`, and the one under the finger lifts (scale 1.1, ring and fill in red / accent).
 * Tapping them still works as before once the orb is released.
 */
function VoiceActions({ onDiscard, onSave, live }: { onDiscard: () => void; onSave: () => void; live: boolean }) {
  const discardRef = useRef<ComponentRef<typeof View>>(null);
  const saveRef = useRef<ComponentRef<typeof View>>(null);
  const [holding, setHolding] = useState(pttActive.value === 1);

  const measure = useCallback(() => {
    const d = discardRef.current;
    const s = saveRef.current;
    if (!d || !s) return;
    d.measureInWindow((dx, dy, dw, dh) =>
      s.measureInWindow((sx, sy, sw, sh) => {
        pttRects.value = [dx, dy, dw, dh, sx, sy, sw, sh];
      }),
    );
  }, []);

  // The card slides up for 180 ms: measure on layout and again once it has settled.
  useEffect(() => {
    const id = setTimeout(measure, 220);
    return () => {
      clearTimeout(id);
      pttRects.value = PTT_NO_RECTS;
    };
  }, [measure]);

  useAnimatedReaction(
    () => pttActive.value,
    (v, prev) => {
      if (v !== prev) runOnJS(setHolding)(v === 1);
    },
  );

  const hint = holding
    ? t("Release to save · slide onto “Discard” to discard")
    : live
      ? t("Tap the orb to save · Kortex transcribes afterwards")
      : t("Whisper transcribes live · tap the orb to save");
  return (
    <>
      <Help align="center">{hint}</Help>
      <View style={{ flexDirection: "row", gap: 8 }} onLayout={measure}>
        <DropBtn id={PTT_DISCARD} innerRef={discardRef} icon="trash" label={t("Discard")} onPress={onDiscard} />
        <DropBtn id={PTT_SAVE} innerRef={saveRef} icon="inbox" label={t("To Inbox")} primary onPress={onSave} />
      </View>
    </>
  );
}

/** A voice card button that highlights itself while the held finger is over it (see VoiceActions). */
function DropBtn({ id, innerRef, icon, label, primary, onPress }: { id: number; innerRef: RefObject<ComponentRef<typeof View> | null>; icon: IconName; label: string; primary?: boolean; onPress: () => void }) {
  const th = useTheme();
  const reduced = useReducedMotion();
  const bg = primary ? th.accentAiSolid : th.bgSurfaceMuted;
  const fg = primary ? th.onAccentAi : th.textPrimary;
  const tone = id === PTT_DISCARD ? th.statusUrgent : th.accentAiSolid;
  const onFg = id === PTT_DISCARD ? "#FFFFFF" : th.onAccentAi;
  const ringOff = alpha(tone, 0);
  // Computed here, not in the worklet below: mix() is plain JS and calling it on the UI thread crashed the app.
  const ringOn = mix(tone, 70, "#FFFFFF");
  const lift = useAnimatedStyle(() => {
    const on = pttTgt.value === id;
    const ms = reduced ? 0 : 120;
    return {
      transform: [{ scale: reduced ? 1 : withSpring(on ? 1.1 : 1, { damping: 15, stiffness: 260 }) }],
      backgroundColor: withTiming(on ? tone : bg, { duration: ms }),
      borderColor: withTiming(on ? ringOn : ringOff, { duration: ms }),
    };
  });
  // Icon and label cross-fade to the "on" colour (text colour cannot be animated through <Icon>/<T>).
  const onLayer = useAnimatedStyle(() => ({ opacity: withTiming(pttTgt.value === id ? 1 : 0, { duration: reduced ? 0 : 120 }) }));
  const content = (color: string) => (
    <>
      <Icon name={icon} size={16} color={color} />
      <T size={13.5} lh={20} weight={600} color={color}>
        {label}
      </T>
    </>
  );
  return (
    <View ref={innerRef} collapsable={false} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        <RAnimated.View style={[{ minHeight: 44, borderRadius: RADIUS.control, borderWidth: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12 }, lift]}>
          {content(fg)}
          <RAnimated.View pointerEvents="none" style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, onLayer]}>
            {content(onFg)}
          </RAnimated.View>
        </RAnimated.View>
      </Pressable>
    </View>
  );
}

export const sheetBody = (th: ReturnType<typeof useTheme>, kb: number, bottomInset: number): ViewStyle =>
  ({ paddingTop: 12, paddingHorizontal: 18, paddingBottom: kb ? 12 : 26 + bottomInset, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, backgroundColor: th.bgMainWindow, gap: 12, boxShadow: th.shadowFloating }) as ViewStyle;

export function Grip() {
  const th = useTheme();
  return <View accessibilityLabel={t("Drag down to close")} style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: th.borderSubtle, alignSelf: "center" }} />;
}

/** A1 + A5: the quick note sits above the keyboard (edge to edge, no adjustResize) and closes with a swipe down. */
function QuickNote() {
  const th = useTheme();
  const a = useApp();
  const kb = useKeyboardInset();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Pressable accessibilityLabel={t("Close")} onPress={a.closeCap} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 15, backgroundColor: th.bgScrim }} />
      <SwipeSheet scroll={false} onClose={a.closeCap} style={{ position: "absolute", left: 0, right: 0, bottom: kb, zIndex: 16 }} contentContainerStyle={sheetBody(th, kb, insets.bottom)}>
        <Grip />
        <View accessibilityLabel={t("Quick note")} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T type="h3" style={{ flex: 1 }}>
            {t("Quick note")}
          </T>
          <Help>
            <T mono size={12.5} lh={18} ls={0} weight={400} color={th.textMuted}>
              {!a.live && a.noteText.trim() ? "→ " + routeOf(a.noteText) : t("Kortex files it automatically")}
            </T>
          </Help>
        </View>
        <View style={[{ padding: 8, borderRadius: RADIUS.control, backgroundColor: th.bgSurfaceFlat }, ring(th.borderSubtle)]}>
          <TextInput
            accessibilityLabel={t("Thought")}
            multiline
            autoFocus
            placeholder={t("What is on your mind?")}
            placeholderTextColor={th.textMuted}
            value={a.noteText}
            onChangeText={a.setNoteText}
            style={[{ minHeight: 96, maxHeight: 220, padding: 4, paddingTop: 2, fontFamily: FONT.sans400, fontSize: 13.5, lineHeight: 21, color: th.textPrimary, textAlignVertical: "top" }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
          />
        </View>
        {!a.live && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {NOTE_TAGS.map(([label, tone], i) => (
            <Pill30 key={label} label={label} tone={tone} on={a.noteTag[i] ?? false} onPress={() => a.toggleNoteTag(i)} />
          ))}
        </View>
        )}
        <Btn variant="primary" block minHeight={48} icon="inbox" onPress={a.saveNote}>
          {t("Put in Inbox")}
        </Btn>
        <Btn block minHeight={44} icon="note" onPress={() => a.openCap("scratchpad")}>
          {t("To the scratchpad")}
        </Btn>
      </SwipeSheet>
    </>
  );
}

/**
 * Ruhe capture (mockup "Erfassen · Glas-Sheet"): a floating glass sheet over the screen, the target line on top
 * (Inbox · auto filing), the thought in large type, quiet chips (link from the clipboard, photo, ask the agent),
 * then "hold to speak" and the round send button. Swipe down or tap outside to close.
 */
function RuheQuickNote() {
  const th = useTheme();
  const a = useApp();
  const [sendPlay, fireSend] = useGesturePlay();
  const router = useRouter();
  const text = a.noteText.trim();
  const pasteLink = () =>
    void Clipboard.getStringAsync()
      .then((clip) => {
        const url = clip.trim().match(/https?:\/\/\S+/)?.[0];
        if (!url) return a.say(t("No link on the clipboard"));
        a.setNoteText(a.noteText.trim() ? `${a.noteText.trim()} ${url}` : url);
      })
      .catch(() => undefined);
  const askAgent = () => {
    if (!text) return a.say(t("Write down a thought first"));
    a.setNoteText("");
    a.closeCap();
    a.ask(text);
    router.navigate("/ask");
  };
  const empty = !text;
  return (
    <RSheet onClose={a.closeCap} z={15} label={t("Quick note")} target={{ icon: "inbox", text: !a.live && text ? `Inbox · ${routeOf(a.noteText)}` : t("Inbox · auto filing") }}>
      {/* The scratchpad moved into the "…" of the target line (section 10: only link, photo, ask as chips). */}
      <View style={{ position: "absolute", right: 8, top: 22 }}>
        <RIconButton icon="more" label={t("More")} onPress={() => a.openMenu({ title: t("Quick note"), items: [{ label: t("Scratchpad"), icon: "note", run: () => a.openCap("scratchpad") }] })} />
      </View>
      <TextInput
        accessibilityLabel={t("Thought")}
        multiline
        autoFocus
        placeholder={t("What is on your mind?")}
        placeholderTextColor={th.t4}
        selectionColor={th.accent}
        cursorColor={th.accent}
        value={a.noteText}
        onChangeText={a.setNoteText}
        style={[{ minHeight: 84, maxHeight: 220, padding: 0, fontFamily: FONT.sans400, fontSize: RUHE_TYPE.input.size, lineHeight: RUHE_TYPE.input.lh, letterSpacing: RUHE_TYPE.input.ls * RUHE_TYPE.input.size, color: th.t1, textAlignVertical: "top" }, Platform.OS === "web" ? ({ outlineStyle: "none", caretColor: th.accent } as never) : null]}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8, marginBottom: 18 }}>
        <RSheetChip icon="link" label={t("Link")} onPress={pasteLink} />
        <RSheetChip icon="camera" label={t("Photo")} onPress={() => a.openCap("photo")} />
        <RSheetChip icon="sparkles" label={t("Ask")} onPress={askAgent} accent />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Speak instead")}
          onPress={() => a.openCap("voice")}
          style={({ pressed }) => ({ flex: 1, height: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, borderRadius: 26, backgroundColor: pressed ? th.lum4 : th.lum3 })}
        >
          <Icon name="audioLines" size={18} color={th.t2} />
          <RText step="buttonSm" weight={400} color={th.t2}>
            {t("Tap to speak")}
          </RText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Put in Inbox")}
          accessibilityState={{ disabled: empty }}
          onPress={() => {
            if (!empty) fireSend();
            a.saveNote();
          }}
          style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: empty ? th.lum3 : th.accentFill, transform: [{ scale: pressed ? 0.97 : 1 }] })}
        >
          <Icon name="arrowUp" size={20} strokeWidth={1.6} play={sendPlay} color={empty ? th.t3 : th.onAccent} />
        </Pressable>
      </View>
    </RSheet>
  );
}

/** A2: live photo capture. Camera or gallery, a preview, the mode as a hint for the vision pass, an optional note. */
function LivePhoto() {
  const th = useTheme();
  const a = useApp();
  const kb = useKeyboardInset();
  const insets = useSafeAreaInsets();
  const p = a.photo;
  const ratio = p && p.width && p.height ? Math.max(0.75, Math.min(1.8, p.width / p.height)) : 4 / 3;
  return (
    <>
      <Pressable accessibilityLabel={t("Close")} onPress={a.closeCap} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 15, backgroundColor: th.bgScrim }} />
      <SwipeSheet scroll={false} onClose={a.closeCap} style={{ position: "absolute", left: 0, right: 0, bottom: kb, zIndex: 16 }} contentContainerStyle={sheetBody(th, kb, insets.bottom)}>
        <Grip />
        <View accessibilityLabel={t("Capture photo")} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T type="h3" style={{ flex: 1 }}>
            {t("Photo")}
          </T>
          <Help>{t("Kortex reads text and sketches")}</Help>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("Kind of photo")} style={{ flexDirection: "row", gap: 6 }}>
          {PHOTO_MODES.map((l, i) => {
            const on = a.camMode === i;
            return (
              <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => a.setCamMode(i)} style={[{ height: 32, paddingHorizontal: 12, borderRadius: RADIUS.pill, justifyContent: "center", backgroundColor: on ? th.bgSurfaceMuted : "transparent" }, ring(on ? th.textMuted : th.borderSubtle)]}>
                <T size={12.5} lh={18} ls={0} color={on ? th.textPrimary : th.textSecondary}>
                  {t(l)}
                </T>
              </Pressable>
            );
          })}
        </View>
        {p ? (
          <>
            <Image accessibilityLabel={t("Preview")} source={{ uri: p.uri }} resizeMode="cover" style={{ width: "100%", aspectRatio: ratio, maxHeight: kb ? 140 : 320, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }} />
            <View style={[{ padding: 8, borderRadius: RADIUS.control, backgroundColor: th.bgSurfaceFlat }, ring(th.borderSubtle)]}>
              <TextInput
                accessibilityLabel={t("Note on the photo")}
                multiline
                placeholder={t("Add a note (optional)")}
                placeholderTextColor={th.textMuted}
                value={a.photoNote}
                onChangeText={a.setPhotoNote}
                style={[{ minHeight: 44, maxHeight: 120, padding: 4, paddingTop: 2, fontFamily: FONT.sans400, fontSize: 13.5, lineHeight: 21, color: th.textPrimary, textAlignVertical: "top" }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn grow minHeight={44} icon="camera" onPress={() => a.pickPhoto("camera")}>
                {t("New")}
              </Btn>
              <Btn grow minHeight={44} icon="grid" onPress={() => a.pickPhoto("library")}>
                {t("Gallery")}
              </Btn>
              <Btn grow minHeight={44} variant="primary" icon="inbox" onPress={a.savePhoto}>
                {t("To Inbox")}
              </Btn>
            </View>
          </>
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn grow minHeight={56} variant="primary" icon="camera" onPress={() => a.pickPhoto("camera")}>
              {t("Camera")}
            </Btn>
            <Btn grow minHeight={56} icon="grid" onPress={() => a.pickPhoto("library")}>
              {t("Gallery")}
            </Btn>
          </View>
        )}
      </SwipeSheet>
    </>
  );
}

function Pill30({ label, tone, on, onPress }: { label: string; tone: "ai" | "health" | "strategy" | "auto" | "food" | "finance"; on: boolean; onPress: () => void }) {
  const th = useTheme();
  const c = th.tags[tone];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ minHeight: 30, justifyContent: "center" }}>
      {/* V2-11E: tag colour only as the dot; a not-yet-picked suggestion keeps a neutral dashed outline. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 20, paddingHorizontal: on ? 0 : 8, borderRadius: RADIUS.pill, borderWidth: on ? 0 : 1, borderStyle: "dashed", borderColor: alpha(th.textMuted, 0.6) }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.dot }} />
        <T size={12.5} lh={18} ls={0} color={on ? th.textSecondary : th.textMuted}>
          {label}
        </T>
      </View>
    </Pressable>
  );
}

function LiveDot() {
  const th = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: Platform.OS !== "web" }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: 8, height: 8 }}>
      <Animated.View style={{ position: "absolute", inset: 0, borderRadius: 4, backgroundColor: th.statusUrgent, opacity: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 3] }) }] } as never} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: th.statusUrgent }} />
    </View>
  );
}

function PhotoCapture({ top }: { top: number; height: number }) {
  const th = useTheme();
  const a = useApp();
  const modes = [t("Document"), "Whiteboard", t("Photo")];
  return (
    <View accessibilityLabel={t("Capture photo")} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 16, backgroundColor: "#000000" }}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.92 }}>
        <Photo source={IMG.meeting} />
      </View>
      <View
        pointerEvents="none"
        style={
          {
            position: "absolute",
            left: 34,
            right: 34,
            top: 150,
            bottom: 250,
            borderRadius: 18,
            boxShadow: Platform.OS === "web" ? "0 0 0 2px rgba(255,255,255,0.85), 0 0 0 9999px rgba(0,0,0,0.35)" : "0 0 0 2px rgba(255,255,255,0.85)",
          } as ViewStyle
        }
      />
      <View style={{ position: "absolute", left: 14, right: 14, top: top + 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Close camera")} onPress={a.closeCap} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Icon name="x" color="#FFFFFF" />
        </Pressable>
        <T size={14} lh={21} color="#FFFFFF" align="center" style={{ flex: 1, opacity: 0.9 }}>
          {t("Whiteboard detected")}
        </T>
        <View style={{ width: 40 }} />
      </View>
      {a.shot ? (
        <SlideUp style={{ position: "absolute", left: 14, right: 14, bottom: 28 }}>
          <View style={{ padding: 14, borderRadius: RADIUS["2xl"], backgroundColor: th.bgMainWindow, gap: 10, boxShadow: th.shadowFloating } as ViewStyle}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="sparkles" size={14} color={th.tags.ai.fg} />
              <T size={12.5} lh={20} color={th.tags.ai.fg}>
                Gemini Vision
              </T>
            </View>
            <T size={14} lh={21} weight={500}>
              {t("Whiteboard with an architecture sketch: vault, sync service and conflict queue. Fits {meeting}.", { meeting: "Q4 Architektur-Sync" })}
            </T>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn grow minHeight={44} onPress={() => a.setShot(false)}>
                {t("Retake")}
              </Btn>
              <Btn grow minHeight={44} variant="primary" icon="inbox" onPress={a.savePhoto}>
                {t("To Inbox")}
              </Btn>
            </View>
          </View>
        </SlideUp>
      ) : (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 44, alignItems: "center", gap: 14 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {modes.map((l, i) => (
              <Pressable key={l} onPress={() => a.setCamMode(i)} style={{ height: 30, paddingHorizontal: 12, borderRadius: 999, justifyContent: "center", backgroundColor: a.camMode === i ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.35)" }}>
                <T size={12.5} lh={20} color="#FFFFFF">
                  {l}
                </T>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Shutter")} onPress={() => a.setShot(true)} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#FFFFFF", boxShadow: "0 0 0 4px rgba(0,0,0,0.35), 0 0 0 7px rgba(255,255,255,0.85)" } as ViewStyle} />
        </View>
      )}
    </View>
  );
}

