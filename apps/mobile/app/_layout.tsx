import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { useFonts, Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from "@expo-google-fonts/geist";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { restoreDeviceLocale, useLocale } from "../src/i18n/device";
import { AppProvider, useApp } from "../src/state/AppState";
import { DataProvider, useData } from "../src/state/Data";
import { Login } from "../src/screens/Login";
import { NotificationBridge } from "../src/notify/Bridge";
import { PackProvider } from "../src/theme/pack";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { PhoneFrame } from "../src/ui/Chrome";

void SplashScreen.preventAutoHideAsync();

/** Expo Go has no share-intent native module (needs a dev build, see apps/mobile/README.md). */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** A share intent from the Android share sheet opens the share overlay. */
function ShareRouter({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { hasShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (hasShareIntent) router.replace("/share");
  }, [hasShareIntent, router]);
  return <>{children}</>;
}

function Shell() {
  const th = useTheme();
  const { auth } = useData();
  useLocale();
  return (
    <PhoneFrame>
      <StatusBar style={th.name === "dark" ? "light" : "dark"} />
      {auth === "loading" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: th.bgMainWindow }}>
          <ActivityIndicator color={th.textMuted} />
        </View>
      ) : auth === "live" || auth === "demo" ? (
        <>
          <Stack screenOptions={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: th.bgMainWindow } }} />
          {auth === "live" && <NotificationBridge />}
        </>
      ) : (
        <Login />
      )}
    </PhoneFrame>
  );
}

function Themed() {
  const { themePref, accent } = useApp();
  return (
    <ThemeProvider pref={themePref} accent={accent}>
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
  const [loaded, error] = useFonts({ Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, JetBrainsMono_400Regular, JetBrainsMono_500Medium });
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
