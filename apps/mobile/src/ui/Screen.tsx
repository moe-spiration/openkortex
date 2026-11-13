import type { ReactNode } from "react";
import { Animated, Platform, RefreshControl, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { useIsFocused } from "expo-router";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import { useChrome } from "./Chrome";
import { HEADER_H } from "./Shell";

/**
 * Scroll area below the global header (prototype: `top:96px; bottom:0; padding: .. 18px 120px`). Pull to refresh when live.
 * With `scrollY` the offset is mirrored into that Animated.Value (for rows that pin under the header, e.g. the Einträge controls).
 */
/** How close (px) to the bottom `onNearEnd` fires, so the next page is there before the user gets to it. */
const NEAR_END_PX = 900;

export function ScreenScroll({ children, padTop = 10, gap, contentStyle, scrollY, onNearEnd }: { children: ReactNode; padTop?: number; gap?: number; contentStyle?: StyleProp<ViewStyle>; scrollY?: Animated.Value; onNearEnd?: () => void }) {
  const { top } = useChrome();
  const th = useTheme();
  const d = useData();
  // Tab scenes are transparent (the shell paints the background); a scene that is not in front must not
  // shine through the one that is, nor take its touches. Hidden, not unmounted, so scroll positions stay.
  const focused = useIsFocused();
  const Scroller = scrollY ? Animated.ScrollView : ScrollView;
  const nearEnd = onNearEnd
    ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        if (contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_END_PX) onNearEnd();
      }
    : undefined;
  return (
    <Scroller
      pointerEvents={focused ? "auto" : "none"}
      // Starts at the very top so content runs under the transparent header (no solid band behind it).
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 1, opacity: focused ? 1 : 0 }}
      contentContainerStyle={[{ paddingTop: top + HEADER_H + padTop, paddingHorizontal: 18, paddingBottom: 120, gap }, contentStyle]}
      scrollIndicatorInsets={{ top: top + HEADER_H }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...(scrollY
        ? { scrollEventThrottle: 16, onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== "web", listener: nearEnd }) }
        : nearEnd
          ? { scrollEventThrottle: 100, onScroll: nearEnd }
          : null)}
      refreshControl={d.auth === "live" ? <RefreshControl progressViewOffset={top + HEADER_H} refreshing={d.loading} onRefresh={d.refresh} tintColor={th.textMuted} colors={[th.textSecondary]} /> : undefined}
    >
      {children}
    </Scroller>
  );
}
