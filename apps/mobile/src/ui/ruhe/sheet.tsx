import { t } from "../../i18n";
import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { RUHE_RADIUS, RUHE_SPACE } from "../../theme/tokens";
import { useChrome } from "../Chrome";
import { Icon, type IconName } from "../Icon";
import { SwipeSheet } from "../SwipeSheet";
import { useKeyboardInset } from "../useKeyboard";
import { GlassFill, glassEdge, scrimOf } from "./glass";
import { RText } from "./kit";

/*
 * The Ruhe glass sheet (android-richtlinien section 10): floating 8 from the edges and 8 above the system
 * navigation (over the keyboard kb + 8), radius 36 on all four corners, glass recipe "sheet", padding 10 18 22,
 * grip 36 x 5 (t4 at 50 %) with 14 below, optional target line (icon 14 + 12.5 t3, 10 below). Closes with a swipe
 * down (> 120 dp or fast), a tap on the scrim (lum0 at 45 %) or Android back (the caller's route handles it).
 * In 260 ms eo from 24 below, out 180 ms eio (SwipeSheet).
 */
export function RSheet({
  onClose,
  target,
  children,
  scroll = false,
  maxHeight,
  z = 30,
  label,
  contentStyle,
  aboveBar,
}: {
  /** Menus end above the tab bar instead of covering it (section 6: never glass on glass). */
  aboveBar?: boolean;
  onClose: () => void;
  /** Target line under the grip ("Inbox · Auto-Ablage"). */
  target?: { icon: IconName; text: string };
  children: ReactNode;
  /** Scrollable content (menus, long sheets); a plain sheet drags as a whole. */
  scroll?: boolean;
  /** Max height as a share of the window (menus .7, peeks .6). */
  maxHeight?: `${number}%`;
  /** zIndex of the scrim; the sheet sits one above. */
  z?: number;
  label?: string;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const th = useTheme();
  const kb = useKeyboardInset();
  const { bottom } = useChrome();
  const r = RUHE_RADIUS.sheet;
  return (
    <>
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: z }}>
        <Pressable accessibilityLabel={t("Close")} onPress={onClose} style={{ flex: 1, backgroundColor: scrimOf(th) }} />
      </Animated.View>
      <SwipeSheet
        scroll={scroll}
        onClose={onClose}
        grabHeight={34}
        backdrop={<GlassFill variant="sheet" radius={r} />}
        style={[
          {
            position: "absolute",
            left: RUHE_SPACE.sheetInset,
            right: RUHE_SPACE.sheetInset,
            bottom: kb ? kb + RUHE_SPACE.sheetInset : aboveBar ? RUHE_SPACE.barBottom + bottom + RUHE_SPACE.barHeight + 8 : RUHE_SPACE.sheetInset + bottom,
            maxHeight,
            zIndex: z + 1,
            borderRadius: r,
            boxShadow: glassEdge(th),
          } as ViewStyle,
        ]}
        contentContainerStyle={[{ paddingTop: 10, paddingHorizontal: 18, paddingBottom: 22 }, contentStyle]}
      >
        <View accessibilityLabel={label ?? t("Drag down to close")} style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: th.t4, opacity: 0.5, alignSelf: "center", marginBottom: 14 }} />
        {target && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <Icon name={target.icon} size={14} color={th.t3} />
            <RText step="rowSub" color={th.t3} numberOfLines={1} style={{ flex: 1 }}>
              {target.text}
            </RText>
          </View>
        )}
        {children}
      </SwipeSheet>
    </>
  );
}

/** Action chip of a sheet: 28 high, radius 8, icon 12 + 12.5; lum2 (dark) / lum3 (light); "ask" in accentSoft + accentInk. */
export function RSheetChip({ icon, label, onPress, accent }: { icon: IconName; label: string; onPress: () => void; accent?: boolean }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={({ pressed }) => ({ height: 28, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: RUHE_RADIUS.r8, backgroundColor: accent ? th.accentSoft : pressed ? th.lum4 : th.name === "dark" ? th.lum2 : th.lum3 })}
    >
      <Icon name={icon} size={12} color={accent ? th.accentInk : th.t2} />
      <RText step="rowSub" color={accent ? th.accentInk : th.t2}>
        {label}
      </RText>
    </Pressable>
  );
}
