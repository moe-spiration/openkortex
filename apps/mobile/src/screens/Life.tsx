import { feature, t } from "../i18n";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";
import { loadGriplyAreas, type GriplyArea } from "../api/kortex";
import { kortexUrl } from "../api/config";
import { Icon } from "../ui/Icon";
import { useData } from "../state/Data";
import { useApp } from "../state/AppState";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Eyebrow, Help, Photo, ring, T } from "../ui/primitives";
import { lifeTopic } from "../theme/lifeTopic";
import { ScreenScroll } from "../ui/Screen";
import { useEntryActions } from "../ui/entryActions";

/*
 * Life (like the web since the Griply decision): the areas as pages for vision, ideas and images. No scores:
 * goals, habits and tasks live in Griply; with the Griply connection each card shows its first goals (read only). A tap opens the area's page (10_Notes/Life Areas, tag #life/<key>),
 * created with the vision on first use; in the demo it opens the area sheet.
 */

/** Opens an area's page (created with the vision on first use); the demo opens the area sheet. Shared with Home. */
export function useOpenLifeArea() {
  const { openArea, openEntry, say } = useApp();
  const { auth, lifePage } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const open = (key: string) => {
    if (auth !== "live") return openArea(key);
    if (busy) return;
    setBusy(key);
    void lifePage(key).then((r) => {
      setBusy(null);
      if ("error" in r) say(t("Page not opened: {error}", { error: r.error }));
      else openEntry(r.id);
    });
  };
  return { open, busy };
}

/** Griply's goals per area (read only, like "Ziele in Griply" on the web area page); null while loading or in the demo. */
function useGriply(areas: { key: string; name: string }[], live: boolean) {
  const [state, setState] = useState<{ state: string; areas: Record<string, GriplyArea | null> } | null>(null);
  const keys = areas.map((a) => `${a.key}:${a.name}`).join("|");
  useEffect(() => {
    if (!live || !keys || !feature("griply")) return;
    let off = false;
    void loadGriplyAreas(areas.map((a) => ({ key: a.key, name: a.name })))
      .then((r) => !off && setState(r))
      .catch(() => !off && setState({ state: "error", areas: {} }));
    return () => {
      off = true;
    };
  }, [live, keys]);
  return state;
}

export function Life() {
  const th = useTheme();
  const { openMenu } = useApp();
  const act = useEntryActions();
  const { areas, auth } = useData();
  const { open, busy } = useOpenLifeArea();
  const griply = useGriply(areas, auth === "live");
  return (
    <ScreenScroll gap={16}>
      <View>
        <Eyebrow>Life</Eyebrow>
        <T type="h1" style={{ marginTop: 2 }}>
          {t("Your life areas")}
        </T>
        <Help style={{ marginTop: 4 }}>{feature("griply") ? t("One page per area for vision, ideas and images. Goals and habits stay in Griply.") : t("One page per area for vision, ideas and images.")}</Help>
        {griply && griply.state !== "connected" && (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${kortexUrl()}/settings?section=connectors`)} style={{ marginTop: 6, minHeight: 36, justifyContent: "center" }}>
            <T size={12.5} lh={18} ls={0} color={th.tags.ai.fg}>
              {t("Connect Griply (on the web) to see the goals of each area here.")}
            </T>
          </Pressable>
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {areas.map((a) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityLabel={t("Open page {name}", { name: a.name })}
            onPress={() => open(a.key)}
            onLongPress={() => openMenu(act.areaMenu(a))}
            style={[{ width: "48.2%", flexGrow: 1, gap: 6, paddingBottom: 12, borderRadius: RADIUS.card, overflow: "hidden", backgroundColor: th.bgSurfaceFlat }, ring(th.borderSubtle)]}
          >
            <View style={{ height: 104, overflow: "hidden" }}>
              <Photo source={lifeTopic(a.key) ? { pack: lifeTopic(a.key)! } : a.img} />
              {busy === a.key && (
                <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: th.bgScrim }}>
                  <ActivityIndicator color={th.onAccentAi} />
                </View>
              )}
            </View>
            {/* V2-11C/E: colour only in the dot. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 24 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: th.tags[a.tone].dot }} />
              <T size={14} lh={20} weight={600} numberOfLines={1} style={{ flex: 1 }}>
                {a.name}
              </T>
            </View>
            <T size={12.5} lh={18} ls={0} numberOfLines={2} color={th.textSecondary} style={{ paddingHorizontal: 12, minHeight: 36 }}>
              {a.vision.trim() || t("No vision yet")}
            </T>
            {(griply?.areas[a.key]?.goals ?? []).slice(0, 2).map((g) => (
              <View key={g.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 }}>
                <Icon name="target" size={12} color={th.textMuted} />
                <T size={12} lh={16} ls={0} numberOfLines={1} style={{ flex: 1 }}>
                  {g.name}
                </T>
                {g.progress !== undefined && (
                  <T num size={11.5} lh={16} ls={0} color={th.textMuted}>
                    {`${Math.round(g.progress)} %`}
                  </T>
                )}
              </View>
            ))}
          </Pressable>
        ))}
      </View>
    </ScreenScroll>
  );
}
