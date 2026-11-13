import { useRef, type ComponentRef } from "react";
import { BlurTargetView } from "expo-blur";
import { View } from "react-native";
import { Tabs, usePathname } from "expo-router";
import { CaptureOverlays, Orb } from "../../src/ui/Capture";
import { ActionMenu } from "../../src/ui/ActionMenu";
import { DetailSheet } from "../../src/ui/DetailSheet";
import { RemindersLayer } from "../../src/ui/RemindersSheet";
import { Header, TabBar, Toast } from "../../src/ui/Shell";

/* The app shell: header, tab bar with the capture orb and every overlay of the prototype's "App" mode. */
export default function TabsLayout() {
  const root = useRef<ComponentRef<typeof View>>(null);
  const path = usePathname();
  // The header glass blurs whatever the screens render (expo-blur needs an explicit target on Android).
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  return (
    <View ref={root} style={{ flex: 1 }}>
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
      <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}>
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
      {path !== "/settings" && <Header blurTarget={blurTarget} />}
      <DetailSheet />
      <TabBar />
      <Orb rootRef={root} />
      <CaptureOverlays />
      <RemindersLayer />
      <ActionMenu />
      <Toast />
    </View>
  );
}
