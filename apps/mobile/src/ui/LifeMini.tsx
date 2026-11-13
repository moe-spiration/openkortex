import { t } from "../i18n";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useOpenLifeArea } from "../screens/Life";
import { useData } from "../state/Data";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "./Icon";
import { Micro, T } from "./primitives";

/*
 * "Life" on Home (like the web Home's Life box): each area as a chip that opens its page. No scores or bars:
 * goals and habits live in Griply. "Overview" opens the Life screen with the area cards and their visions.
 */
export function LifeMini() {
  const th = useTheme();
  const router = useRouter();
  const { areas } = useData();
  const { open, busy } = useOpenLifeArea();
  if (!areas.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Micro style={{ flex: 1 }}>Life</Micro>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.navigate("/life")} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <T size={12.5} lh={18} ls={0} color={th.tags.ai.fg}>
            {t("Overview")}
          </T>
          <Icon name="chev" size={12} color={th.tags.ai.fg} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
        {areas.map((a) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityLabel={t("Open page {name}", { name: a.name })}
            onPress={() => open(a.key)}
            style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: alpha(th.bgSurfaceFlat, 0.72) }}
          >
            {busy === a.key ? <ActivityIndicator size="small" color={th.textSecondary} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: th.tags[a.tone].dot }} />}
            <T size={14} lh={20} weight={500} numberOfLines={1}>
              {a.name}
            </T>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
