import { feature, t } from "../../i18n";
import { ActivityIndicator, Linking, View } from "react-native";
import { kortexUrl } from "../../api/config";
import type { GriplyArea } from "../../api/kortex";
import { useApp } from "../../state/AppState";
import { useData } from "../../state/Data";
import { lifeTopic } from "../../theme/lifeTopic";
import { useTheme } from "../../theme/ThemeProvider";
import { RUHE_SPACE } from "../../theme/tokens";
import { useEntryActions } from "../../ui/entryActions";
import { Icon } from "../../ui/Icon";
import { Photo } from "../../ui/primitives";
import { ScreenScroll } from "../../ui/Screen";
import { RPress, RText, RuheLocBar, SyncLine } from "../../ui/ruhe";

/*
 * Life, Ruhe (android-richtlinien.md 4 "Raster-Karte", 8 A): eyebrow "Life", title "Deine Lebensbereiche", one quiet
 * line on what the pages are for, then the areas as raster cards in two columns: image 104 r12, the area's dot and
 * name, the vision in two lines t3 and, with Griply, its first two goals with their progress. No scores, no tints.
 */

const SURF = RUHE_SPACE.surface;
const PAD = RUHE_SPACE.page;
type Area = ReturnType<typeof useData>["areas"][number];

export function LifeRuhe({ griply, open, busy }: { griply: { state: string; areas: Record<string, GriplyArea | null> } | null; open: (key: string) => void; busy: string | null }) {
  const th = useTheme();
  const { openMenu } = useApp();
  const act = useEntryActions();
  const { areas } = useData();
  const rows: Area[][] = [];
  for (let i = 0; i < areas.length; i += 2) rows.push(areas.slice(i, i + 2));

  return (
    <ScreenScroll flush padTop={0}>
      <RuheLocBar eyebrow={t("Life")} title={t("Your life areas")} />
      <RText step="rowSub" color={th.t3} style={{ paddingHorizontal: PAD, marginTop: -4 }}>
        {feature("griply") ? t("One page per area for vision, ideas and images. Goals and habits stay in Griply.") : t("One page per area for vision, ideas and images.")}
      </RText>
      {griply && griply.state !== "connected" && (
        <RPress accessibilityRole="link" flat onPress={() => void Linking.openURL(`${kortexUrl()}/settings?section=connectors`)} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: PAD }}>
          <RText step="rowSub" color={th.accentInk}>
            {t("Connect Griply (on the web) to see the goals of each area here.")}
          </RText>
        </RPress>
      )}
      {griply?.state === "error" && <SyncLine error text={t("Griply could not be reached.")} />}

      <View style={{ gap: 18, paddingHorizontal: SURF, paddingTop: 16 }}>
        {rows.map((row) => (
          <View key={row.map((x) => x.key).join("|")} style={{ flexDirection: "row", gap: 12 }}>
            {row.map((a) => (
              <RPress key={a.key} accessibilityLabel={t("Open page {name}", { name: a.name })} onPress={() => open(a.key)} onLongPress={() => openMenu(act.areaMenu(a))} style={{ flex: 1, minWidth: 0 }}>
                <View style={{ height: 104, borderRadius: 12, overflow: "hidden", backgroundColor: th.lum2 }}>
                  <Photo source={lifeTopic(a.key) ? { pack: lifeTopic(a.key)! } : a.img} />
                  {busy === a.key && (
                    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: th.bgScrim }}>
                      <ActivityIndicator color="#FFFFFF" />
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: th.tags[a.tone].dot }} />
                  <RText step="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
                    {a.name}
                  </RText>
                </View>
                <RText step="rowSub" color={a.vision.trim() ? th.t3 : th.t4} numberOfLines={2} style={{ marginTop: 2 }}>
                  {a.vision.trim() || t("No vision yet")}
                </RText>
                {(griply?.areas[a.key]?.goals ?? []).slice(0, 2).map((g) => (
                  <View key={g.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <Icon name="target" size={12} color={th.t4} />
                    <RText step="meta" color={th.t2} numberOfLines={1} style={{ flex: 1 }}>
                      {g.name}
                    </RText>
                    {g.progress !== undefined && (
                      <RText step="meta" tnum color={th.t4}>
                        {`${Math.round(g.progress)} %`}
                      </RText>
                    )}
                  </View>
                ))}
              </RPress>
            ))}
            {row.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
      <View style={{ height: 8 }} />
    </ScreenScroll>
  );
}
