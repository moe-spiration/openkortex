import { t } from "../i18n";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { T } from "./primitives";

/*
 * The agent tab holds two views like the web /agent page and the approved preview, where asking and jobs live in
 * one place: "Jobs" (start a job in the background, what waits, runs and is done, standing orders) and "Ask" (the
 * chat across the vault). Same pill switch as the journal's Tag | Woche.
 */
export function AgentSwitch({ cur }: { cur: "jobs" | "ask" }) {
  const th = useTheme();
  const router = useRouter();
  const tabs = [
    { k: "jobs" as const, label: t("Jobs"), path: "/agent" },
    { k: "ask" as const, label: t("Ask"), path: "/ask" },
  ];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", padding: 3, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }}>
      {tabs.map((x) => (
        <Pressable
          key={x.k}
          accessibilityRole="tab"
          accessibilityState={{ selected: cur === x.k }}
          onPress={() => cur !== x.k && router.replace(x.path as never)}
          style={{ minHeight: 34, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: cur === x.k ? th.bgSurfaceFlat : "transparent" }}
        >
          <T size={13} lh={18} ls={0} weight={cur === x.k ? 500 : 400} color={cur === x.k ? th.textPrimary : th.textSecondary}>
            {x.label}
          </T>
        </Pressable>
      ))}
    </View>
  );
}
