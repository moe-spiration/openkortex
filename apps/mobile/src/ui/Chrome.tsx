import { t } from "../i18n";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Eyebrow, ring, Segmented, T } from "./primitives";

/*
 * The phone shell. On a device the app fills the screen below the system status bar. On wide web
 * viewports it renders inside the prototype's 375x780 phone frame (status row included) so the
 * screens can be compared with design/reference/Mobile.dc.html.
 */

export const PHONE = { w: 375, h: 780, status: 44 } as const;

interface ChromeValue {
  /** Space above the app content (system status bar or the faux status row). */
  top: number;
  /** Height of the app area (the screen on a device, the frame on the web). */
  height: number;
  width: number;
}

const ChromeCtx = createContext<ChromeValue>({ top: PHONE.status, height: PHONE.h, width: PHONE.w });
export const useChrome = (): ChromeValue => useContext(ChromeCtx);

export function PhoneFrame({ children }: { children: ReactNode }) {
  const th = useTheme();
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const framed = Platform.OS === "web" && win.width >= 520;
  const [stamp] = useState(() => "11:19");

  if (!framed) {
    const top = Platform.OS === "web" ? 0 : insets.top;
    return (
      <ChromeCtx.Provider value={{ top, height: win.height, width: win.width }}>
        <View style={{ flex: 1, backgroundColor: th.bgMainWindow }}>{children}</View>
      </ChromeCtx.Provider>
    );
  }

  const h = Math.min(PHONE.h, Math.max(560, win.height - 80));
  return (
    <View style={{ flex: 1, backgroundColor: th.bgAppShell, alignItems: "center" }}>
      <DevModeSwitch />
      <View
        style={[
          {
            position: "absolute",
            top: 66,
            width: PHONE.w,
            height: h,
            borderRadius: 48,
            backgroundColor: th.bgMainWindow,
            overflow: "hidden",
            boxShadow: `0 0 0 10px ${th.bgAppShell}, 0 0 0 11px ${th.borderSubtle}, 0 30px 60px -24px rgba(0, 0, 0, 0.6)`,
          } as never,
        ]}
      >
        <ChromeCtx.Provider value={{ top: PHONE.status, height: h, width: PHONE.w }}>
          {children}
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: PHONE.status, zIndex: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 28, paddingTop: 4 }}>
            <T mono size={13} lh={20} ls={0}>
              {stamp}
            </T>
            <T mono size={13} lh={20} ls={0}>
              5G 82%
            </T>
          </View>
          <View pointerEvents="none" style={{ position: "absolute", left: "50%", top: 14, width: 12, height: 12, marginLeft: -6, borderRadius: 6, zIndex: 9, backgroundColor: th.bgAppShell }} />
        </ChromeCtx.Provider>
      </View>
    </View>
  );
}

/** Web-only preview switch "App | Share-Sheet" (the prototype's mode toggle). */
function DevModeSwitch() {
  const path = usePathname();
  const router = useRouter();
  const mode = path.startsWith("/share") ? "share" : "app";
  return (
    <View style={{ position: "absolute", top: 14, flexDirection: "row", alignItems: "center", gap: 10, zIndex: 40 }}>
      <Eyebrow>Expo · Android</Eyebrow>
      <Segmented
        small
        label={t("Mobile view")}
        value={mode}
        onChange={(m) => router.navigate(m === "share" ? "/share" : "/")}
        items={[
          { key: "app", label: "App" },
          { key: "share", label: t("Share sheet") },
        ]}
      />
    </View>
  );
}

/** Full-width hairline-ring surface used by cards. */
export const cardStyle = (th: ReturnType<typeof useTheme>, radius: number = RADIUS.card) => ({ borderRadius: radius, backgroundColor: th.bgSurfaceFlat, ...ring(th.borderSubtle) });
