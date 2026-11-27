import { useRef, type ComponentRef } from "react";
import { BlurTargetView } from "expo-blur";
import { View } from "react-native";
import { Tabs, usePathname } from "expo-router";
import { CaptureOverlays, Orb } from "../../src/ui/Capture";
import { ActionMenu } from "../../src/ui/ActionMenu";
import { DetailSheet } from "../../src/ui/DetailSheet";
import { RemindersLayer } from "../../src/ui/RemindersSheet";
import { Header, TabBar, Toast } from "../../src/ui/Shell";
import { EdgeFade, GlassTargetProvider } from "../../src/ui/ruhe";
import { useRuhe } from "../../src/theme/ThemeProvider";

/*
 * The app shell: header (vivid only), tab bar with the context button and every overlay of the prototype's "App" mode.
 * The glass surfaces (tab bar, button, sheets) sit outside the BlurTargetView they blur (expo-blur on Android 12+).
 * Tabs cross-fade (150 ms, native driver) instead of cutting hard.
 */
export default function TabsLayout() {
  const root = useRef<ComponentRef<typeof View>>(null);
  const path = usePathname();
  // The header glass blurs whatever the screens render (expo-blur needs an explicit target on Android).
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  const ruhe = useRuhe();
  return (
    <GlassTargetProvider target={blurTarget}>
    <View ref={root} style={{ flex: 1 }}>
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
      <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" }, animation: "fade" }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="entries" />
        <Tabs.Screen name="ask" />
        <Tabs.Screen name="life" />
        <Tabs.Screen name="inbox" />
        <Tabs.Screen name="settings" />
        <Tabs.Screen name="agent" />
        <Tabs.Screen name="journal" />
        <Tabs.Screen name="tasks" />
      </Tabs>
      </BlurTargetView>
      {/* Ruhe: the canvas runs out under the floating tab bar (no header strip, no line). */}
      {ruhe && <EdgeFade />}
      {path !== "/settings" && <Header blurTarget={blurTarget} />}
      <DetailSheet />
      <TabBar />
      <Orb rootRef={root} />
      <CaptureOverlays />
      <RemindersLayer />
      <ActionMenu />
      <Toast />
    </View>
    </GlassTargetProvider>
  );
}
