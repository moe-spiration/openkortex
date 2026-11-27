import { msg, t } from "../i18n";
import { useEffect, useState, type ComponentRef, type RefObject } from "react";
import { Platform, Pressable, TextInput, View, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { usePathname, useRouter } from "expo-router";
import { useData } from "../state/Data";
import { initialOf } from "../lib/greeting";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { RADIUS, FONT, RUHE_SPACE } from "../theme/tokens";
import RAnimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { RGlass, RText, useMotion } from "./ruhe";
import { useChrome } from "./Chrome";
import { Icon, type IconName } from "./Icon";
import { tick } from "../lib/haptics";
import { Badge, glass, PRESS_IN, SlideUp, T } from "./primitives";

/* Global header (avatar, smart search, inbox), tab bar and toast of the mobile app. */

export const HEADER_H = 52;

export function Header({ blurTarget }: { blurTarget?: RefObject<ComponentRef<typeof View> | null> }) {
  const ruhe = useRuhe();
  // Ruhe (2026-11-27, android-richtlinien section 8): no global strip. Each page has its own Ortsleiste
  // (RuheLocBar / DetailHeader) that scrolls with the content; the status bar stays transparent.
  return ruhe ? null : <ClassicHeader blurTarget={blurTarget} />;
}

/** Height of the global header the screens sit under: 0 in Ruhe (no strip), HEADER_H in vivid. */
export function useHeaderH(): number {
  return useRuhe() ? 0 : HEADER_H;
}

function ClassicHeader({ blurTarget }: { blurTarget?: RefObject<ComponentRef<typeof View> | null> }) {
  const th = useTheme();
  const { top } = useChrome();
  const router = useRouter();
  const { q, setQ, inboxCount } = useApp();
  const { name } = useData();
  const path = usePathname();
  return (
    <>
    {/* Glass strip behind status bar and header: content scrolls underneath, blurred and lightly tinted. */}
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: top + HEADER_H, zIndex: 7, overflow: "hidden", boxShadow: `inset 0 -1px 0 0 ${th.borderSubtle}` } as ViewStyle}>
      <BlurView intensity={40} tint={th.name === "dark" ? "dark" : "light"} blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: alpha(th.bgMainWindow, 0.55) }} />
    </View>
    <View style={{ position: "absolute", left: 0, right: 0, top, height: HEADER_H, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, zIndex: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Profile and settings")} onPress={() => router.navigate("/settings")} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: th.bgSurfaceMuted }}>
        <T size={15} lh={20} weight={500}>
          {initialOf(name)}
        </T>
      </Pressable>
      <View
        style={[
          { flex: 1, minWidth: 0, height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 6, borderRadius: RADIUS.control, backgroundColor: alpha(th.bgSurfaceMuted, 0.9) },
        ]}
      >
        <Icon name="sparkles" color={th.accentAi} />
        <TextInput
          accessibilityLabel={t("Smart search")}
          placeholder={t("Search or ask your vault")}
          placeholderTextColor={th.textMuted}
          value={q}
          // Navigate once, not on every keystroke: typing stays light while the list filters.
          onChangeText={(v) => {
            setQ(v);
            if (path !== "/entries") router.navigate("/entries");
          }}
          onFocus={() => {
            if (path !== "/entries") router.navigate("/entries");
          }}
          style={[{ flex: 1, minWidth: 0, height: 44, padding: 0, fontFamily: FONT.sans400, fontSize: 14, color: th.textPrimary, letterSpacing: 0 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null]}
        />
        {!!q && (
          <Pressable accessibilityRole="button" accessibilityLabel={t("Clear search")} onPress={() => setQ("")} style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} color={th.textMuted} />
          </Pressable>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Inbox, ${inboxCount}`}
        onPress={() => router.navigate("/inbox")}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: alpha(th.bgSurfaceMuted, 0.9) }}
      >
        <Icon name="inbox" color={inboxCount > 0 ? th.tags.ai.fg : th.textPrimary} />
        <Badge accent style={{ position: "absolute", right: -3, top: -3, boxShadow: `0 0 0 2px ${th.bgMainWindow}` } as ViewStyle}>
          {inboxCount}
        </Badge>
      </Pressable>
    </View>
    </>
  );
}

/**
 * Labels as in the web sidebar (one or two words): Home, Agent, Journal and the Entries list (the web Bibliothek).
 * English sources, shown with `t(tab.label)`.
 */
const TABS: { path: string; label: string; icon: IconName | null; also?: string[] }[] = [
  { path: "/", label: "Home", icon: "home" },
  // 2026-11-12, like the web sidebar and the approved preview: the agent (jobs and asking in one place) and the
  // journal are main rows. Life opens from Home (like the web Home's Life box), Inbox and search from the header.
  { path: "/agent", label: "Agent", icon: "sparkles", also: ["/ask"] },
  { path: "/capture", label: msg("Capture"), icon: null },
  { path: "/journal", label: msg("Journal"), icon: "sun" },
  { path: "/entries", label: msg("Entries"), icon: "list" },
];

export const TABBAR = { bottom: 18, height: 64 } as const;

/** Ruhe: four tabs in a floating glass pill; capture is the round button to its right (see Capture.tsx `Orb`). */
const RUHE_TABS: { key: string; path: string; label: string; icon: IconName; also?: string[] }[] = [
  { key: "home", path: "/", label: msg("Today"), icon: "home", also: ["/journal", "/life", "/tasks", "/inbox"] },
  { key: "entries", path: "/entries", label: msg("Entries"), icon: "library" },
  { key: "search", path: "/entries", label: msg("Search"), icon: "search" },
  { key: "agent", path: "/agent", label: "Agent", icon: "sparkles", also: ["/ask"] },
];

/** Ruhe tab bar geometry (mockup `.tabbar` / `.fab`): pill 58 high, 16 from the left, room for the 58 px button on the right. */
export const RUHE_BAR = { bottom: RUHE_SPACE.barBottom, height: RUHE_SPACE.barHeight, side: RUHE_SPACE.surface, fab: RUHE_SPACE.barFab } as const;

/** Distance of the tab bar and the context button from the bottom edge: 28 above the system navigation (section 9). */
export function useBarBottom(): number {
  return RUHE_BAR.bottom + useChrome().bottom;
}

const TAB_W = 62;

/**
 * Ruhe tab bar (android-richtlinien section 9): a floating glass pill (real blur on Android 12+), four items
 * 62 x 48 spaced around, icon 19 over a 10.5 label. The active pill glides in 180 ms (eo).
 */
function RuheTabBar() {
  const th = useTheme();
  const router = useRouter();
  const path = usePathname();
  const bottom = useBarBottom();
  const m = useMotion();
  const { closeSheet, setFan, searchOpen, setSearchOpen } = useApp();
  const [w, setW] = useState(0);
  const cur = RUHE_TABS.findIndex((tab) => {
    const onPath = path === tab.path || !!tab.also?.includes(path);
    return tab.key === "search" ? onPath && searchOpen : tab.key === "entries" ? onPath && !searchOpen : onPath;
  });
  // space-around: each item gets a quarter of the free width, half of it on either side.
  const free = Math.max(0, w - 12 - RUHE_TABS.length * TAB_W);
  const xOf = (i: number) => 6 + free / (2 * RUHE_TABS.length) + i * (TAB_W + free / RUHE_TABS.length);
  const x = useSharedValue(0);
  const shown = useSharedValue(0);
  const dur = m.d2;
  const ease = m.eo;
  useEffect(() => {
    if (w === 0 || cur < 0) {
      shown.value = 0;
      return;
    }
    const to = xOf(cur);
    x.value = shown.value === 0 || m.reduced ? to : withTiming(to, { duration: dur, easing: ease });
    shown.value = 1;
  }, [cur, w, m.reduced, dur, ease, x, shown]);
  const pill = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateX: x.value }] }));
  // Icon gestures: each tab's tap count (Agent twinkles, Inbox settles, ...).
  const [plays, setPlays] = useState<Record<string, number>>({});
  return (
    <RGlass
      variant="bar"
      radius={RUHE_BAR.height / 2}
      style={{ position: "absolute", left: RUHE_BAR.side, right: RUHE_BAR.side + RUHE_BAR.fab + RUHE_SPACE.barGap, bottom, height: RUHE_BAR.height, zIndex: 12 }}
    >
      <View
        accessibilityRole="tablist"
        accessibilityLabel={t("Main navigation")}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={{ flex: 1, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-around" }}
      >
        <RAnimated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 5, width: TAB_W, height: 48, borderRadius: 24, backgroundColor: th.name === "dark" ? th.lum3 : alpha(th.t1, 0.07) }, pill]} />
        {RUHE_TABS.map((tab, i) => {
          const on = i === cur;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t(tab.label)}
              onPress={() => {
                setPlays((p) => ({ ...p, [tab.key]: (p[tab.key] ?? 0) + 1 }));
                closeSheet();
                setFan(false);
                setSearchOpen(tab.key === "search");
                if (on && path === tab.path) return;
                tick();
                if (path !== tab.path) router.navigate(tab.path as never);
              }}
              style={({ pressed }) => ({ width: TAB_W, height: 48, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 24, backgroundColor: pressed && !on ? alpha(th.t1, 0.05) : "transparent" })}
            >
              <Icon name={tab.icon} size={19} play={plays[tab.key] ?? 0} color={on ? th.t1 : th.t3} />
              <RText step="tabLabel" numberOfLines={1} color={on ? th.t1 : th.ts}>
                {t(tab.label)}
              </RText>
            </Pressable>
          );
        })}
      </View>
    </RGlass>
  );
}

/** Tab bar; the capture orb in the middle is a separate overlay (see Capture.tsx) so it can sit above the fan. */
export function TabBar() {
  return useRuhe() ? <RuheTabBar /> : <ClassicTabBar />;
}

function ClassicTabBar() {
  const th = useTheme();
  const router = useRouter();
  const path = usePathname();
  const { closeSheet, setFan } = useApp();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t("Main navigation")}
      style={[
        {
          position: "absolute",
          left: 16,
          right: 16,
          bottom: TABBAR.bottom,
          height: TABBAR.height,
          paddingHorizontal: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          borderRadius: RADIUS.card,
          zIndex: 12,
          boxShadow: th.shadowFloating,
        } as ViewStyle,
        glass(th),
      ]}
    >
      {TABS.map((tab) => {
        if (!tab.icon) return <View key={tab.path} style={{ width: 60, height: 52 }} />;
        const cur = path === tab.path || !!tab.also?.includes(path);
        return (
          <Pressable
            key={tab.path}
            accessibilityRole="button"
            accessibilityState={{ selected: cur }}
            accessibilityLabel={t(tab.label)}
            onPress={() => {
              closeSheet();
              setFan(false);
              if (path === tab.path) return;
              tick();
              router.navigate(tab.path as never);
            }}
            // Sidebar row style (.kx-row): monochrome icon, secondary label, the active one primary on the accent soft fill.
            style={({ pressed }) => ({
              width: 60,
              height: 52,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderRadius: RADIUS.row,
              backgroundColor: cur ? th.accentAiSoft : pressed ? alpha(th.textPrimary, 0.06) : "transparent",
              transform: pressed ? PRESS_IN : undefined,
            })}
          >
            <Icon name={tab.icon} size={20} color={cur ? th.textPrimary : th.textMuted} />
            <T type="meta" weight={500} numberOfLines={1} color={cur ? th.textPrimary : th.textSecondary}>
              {t(tab.label)}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toast() {
  return useRuhe() ? <RuheToast /> : <ClassicToast />;
}

/**
 * Ruhe toast (section 16): an inverted pill (t1 fill, lum1 text 13/18) centred above the tab bar, 38 high, an
 * optional action chip on the right. No glass, no icon. Enters with the spring curve in 260 ms; a tap dismisses.
 */
function RuheToast() {
  const th = useTheme();
  const { toast, toastAction, say } = useApp();
  const bottom = useBarBottom() + RUHE_BAR.height + 12;
  const m = useMotion();
  const v = useSharedValue(0);
  const dur = m.d3;
  const ease = m.spring;
  const off = m.offset(24);
  useEffect(() => {
    v.value = 0;
    if (toast) v.value = withTiming(1, { duration: dur, easing: ease });
  }, [toast, dur, ease, v]);
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, v.value), transform: [{ translateY: (1 - v.value) * off }] }));
  if (!toast) return null;
  return (
    <RAnimated.View pointerEvents="box-none" style={[{ position: "absolute", left: 16, right: 16, bottom, zIndex: 20, alignItems: "center" }, style]}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onPress={() => say("")}
        style={{ maxWidth: "100%", minHeight: 38, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5, paddingLeft: 14, paddingRight: toastAction ? 6 : 14, borderRadius: 19, backgroundColor: th.t1 }}
      >
        <RText step="rowSub" color={th.lum1} numberOfLines={2} style={{ fontSize: 13, lineHeight: 18, flexShrink: 1 }}>
          {toast}
        </RText>
        {toastAction && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              toastAction.run();
              say("");
            }}
            style={({ pressed }) => ({ height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: "center", backgroundColor: alpha(th.lum1, pressed ? 0.24 : 0.16) })}
          >
            <RText step="rowSub" weight={500} color={th.lum1} style={{ fontSize: 13, lineHeight: 18 }}>
              {toastAction.label}
            </RText>
          </Pressable>
        )}
      </Pressable>
    </RAnimated.View>
  );
}

function ClassicToast() {
  const th = useTheme();
  const { toast, toastAction, say } = useApp();
  const { top } = useChrome();
  if (!toast) return null;
  return (
    <SlideUp style={{ position: "absolute", left: 16, right: 16, top: top + 58, zIndex: 20 }}>
      {/* A tap dismisses the toast right away instead of waiting for its timer. */}
      <Pressable
        accessibilityRole="alert"
        onPress={() => say("")}
        style={[{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingLeft: 12, paddingRight: 10, borderRadius: RADIUS.xl, boxShadow: th.shadowFloating } as ViewStyle, glass(th)]}
      >
        <Icon name="check" color={th.statusSynced} />
        <T type="body" style={{ flex: 1 }}>
          {toast}
        </T>
        {toastAction && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              toastAction.run();
              say("");
            }}
            style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 8 }}
          >
            <T size={13} lh={18} weight={600} color={th.accentAi}>
              {toastAction.label}
            </T>
          </Pressable>
        )}
      </Pressable>
    </SlideUp>
  );
}
