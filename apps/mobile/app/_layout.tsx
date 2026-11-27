import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { useFonts, Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from "@expo-google-fonts/geist";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { restoreDeviceLocale, useLocale } from "../src/i18n/device";
import { AppProvider, useApp } from "../src/state/AppState";
import { DataProvider, useData } from "../src/state/Data";
import { Login } from "../src/screens/Login";
import { NotificationBridge } from "../src/notify/Bridge";
import { PackProvider } from "../src/theme/pack";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { PhoneFrame } from "../src/ui/Chrome";
import { MotionConfig } from "../src/ui/ruhe/motion";

void SplashScreen.preventAutoHideAsync();

/** Expo Go has no share-intent native module (needs a dev build, see apps/mobile/README.md). */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Editor, link and share screens come in with the platform's own transition instead of a hard cut (native, no JS cost). */
const STACK_ANIMATION = Platform.OS === "android" ? "fade_from_bottom" : Platform.OS === "ios" ? "default" : "none";

/**
 * A share intent from the Android share sheet opens the share overlay. On a cold start the intent arrives
 * while the session is still loading and no navigator is mounted yet: navigating then is dropped and the
 * share was lost. So it waits until the app shell (live or demo) is up, and routes each intent once.
 */
function ShareRouter({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { auth } = useData();
  const { hasShareIntent, shareIntent } = useShareIntentContext();
  const routed = useRef<unknown>(null);
  const ready = auth === "live" || auth === "demo";
  useEffect(() => {
    if (!hasShareIntent) {
      routed.current = null;
      return;
    }
    if (!ready || routed.current === shareIntent) return;
    // One frame later: the Stack mounts in the same commit that flips `auth`.
    const id = setTimeout(() => {
      routed.current = shareIntent;
      router.replace("/share");
    }, 0);
    return () => clearTimeout(id);
  }, [hasShareIntent, shareIntent, ready, router]);
  return <>{children}</>;
}

function Shell() {
  const th = useTheme();
  const { auth } = useData();
  useLocale();
  return (
    <PhoneFrame>
      <StatusBar style={th.name === "dark" ? "light" : "dark"} />
      <MotionConfig />
      {auth === "loading" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: th.bgMainWindow }}>
          <ActivityIndicator color={th.textMuted} />
        </View>
      ) : auth === "live" || auth === "demo" ? (
        <>
          <Stack screenOptions={{ headerShown: false, animation: STACK_ANIMATION, contentStyle: { backgroundColor: th.bgMainWindow } }} />
          {auth === "live" && <NotificationBridge />}
        </>
      ) : (
        <Login />
      )}
    </PhoneFrame>
  );
}

function Themed() {
  const { themePref, accent, look } = useApp();
  return (
    <ThemeProvider pref={themePref} accent={accent} look={look}>
      <ShareIntentProvider options={{ disabled: Platform.OS === "web" || IN_EXPO_GO }}>
        <ShareRouter>
          <PackProvider>
            <Shell />
          </PackProvider>
        </ShareRouter>
      </ShareIntentProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Geist 700 (Ruhe page titles) loads at runtime like the rest: no config plugin, so the native fingerprint stays.
  const [loaded, error] = useFonts({ Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, JetBrainsMono_400Regular, JetBrainsMono_500Medium });
  // The language stored on this device is applied before the first screen renders (the splash stays up meanwhile).
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => {
    void restoreDeviceLocale().finally(() => setLocaleReady(true));
  }, []);
  const fontsReady = loaded || !!error;
  useEffect(() => {
    if (fontsReady && localeReady) void SplashScreen.hideAsync();
  }, [fontsReady, localeReady]);
  if (!fontsReady || !localeReady) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DataProvider>
        <AppProvider>
          <Themed />
        </AppProvider>
      </DataProvider>
    </GestureHandlerRootView>
  );
}
