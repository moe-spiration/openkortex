import { msg, t } from "../i18n";
import type { ComponentRef, RefObject } from "react";
import { Platform, Pressable, TextInput, View, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { usePathname, useRouter } from "expo-router";
import { useData } from "../state/Data";
import { initialOf } from "../lib/greeting";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS, FONT } from "../theme/tokens";
import { useChrome } from "./Chrome";
import { Icon, type IconName } from "./Icon";
import { Badge, glass, SlideUp, T } from "./primitives";

/* Global header (avatar, smart search, inbox), tab bar and toast of the mobile app. */

export const HEADER_H = 52;

export function Header({ blurTarget }: { blurTarget?: RefObject<ComponentRef<typeof View> | null> }) {
  const th = useTheme();
  const { top } = useChrome();
  const router = useRouter();
  const { q, setQ, inboxCount } = useApp();
  const { name } = useData();
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
          onChangeText={(v) => {
            setQ(v);
            router.navigate("/entries");
          }}
          onFocus={() => router.navigate("/entries")}
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

/** Tab bar; the capture orb in the middle is a separate overlay (see Capture.tsx) so it can sit above the fan. */
export function TabBar() {
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
              router.navigate(tab.path as never);
            }}
            // Sidebar row style (.kx-row): monochrome icon, secondary label, the active one primary on the accent soft fill.
            style={{ width: 60, height: 52, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: RADIUS.row, backgroundColor: cur ? th.accentAiSoft : "transparent" }}
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
  const th = useTheme();
  const { toast, toastAction, say } = useApp();
  const { top } = useChrome();
  if (!toast) return null;
  return (
    <SlideUp style={{ position: "absolute", left: 16, right: 16, top: top + 58, zIndex: 20 }}>
      <View
        accessibilityRole="alert"
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
      </View>
    </SlideUp>
  );
}
