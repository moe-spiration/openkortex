import { useEffect, useMemo, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, ScrollView, Text, useColorScheme, View } from "react-native";
import { WidgetPreview, type WidgetConfigurationScreenProps } from "react-native-android-widget";
import { t } from "../i18n";
import { restoreDeviceLocale } from "../i18n/device";
import { createTheme } from "../theme/tokens";
import { createCache, loadPrefs, savePrefs, type StoredStyle } from "./data";
import { dataFor } from "./draw";
import { ENTRY_SOURCES, OPACITIES, settingsFor, WIDGET_CAPTURE, WIDGET_ENTRIES, WIDGET_THEMES, withWidget, type EntrySource, type WidgetSettings, type WidgetTheme } from "./model";
import { renderWidget, widgetElement, type WidgetData } from "./render";

/*
 * Settings of one placed widget (hold the widget, then "Settings"/the pencil): transparency, light/dark and,
 * for "Einträge", what it lists. Shows a live preview; "Fertig" saves and redraws the widget.
 */

const THEME_LABEL: Record<WidgetTheme, () => string> = { system: () => t("System"), light: () => t("Light"), dark: () => t("Dark") };
const SOURCE_LABEL: Record<EntrySource, () => string> = { recent: () => t("New"), favorites: () => t("Favorites"), inbox: () => t("Inbox") };

export function WidgetConfig({ widgetInfo, renderWidget: draw, setResult }: WidgetConfigurationScreenProps) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [style, setStyle] = useState<StoredStyle | null>(null);
  const [look, setLook] = useState<WidgetSettings | null>(null);
  const [data, setData] = useState<WidgetData>({});
  const [ready, setReady] = useState(false);
  const cache = useMemo(() => createCache(), []);

  useEffect(() => {
    void (async () => {
      await restoreDeviceLocale();
      const [prefs, st] = await Promise.all([cache.prefs(), cache.style()]);
      const own = settingsFor(prefs, widgetInfo.widgetId);
      setStyle(st);
      setLook(own);
      setReady(true);
    })();
  }, []);
  // The preview shows real data; the entries list reloads when its source changes.
  useEffect(() => {
    if (!look || widgetInfo.widgetName === WIDGET_CAPTURE) return;
    void dataFor(widgetInfo.widgetName, look, cache).then(setData);
  }, [look?.source, ready]);

  const th = createTheme(look?.theme === "light" || look?.theme === "dark" ? look.theme : scheme, style?.accent, style?.look);
  const set = (patch: Partial<WidgetSettings>) => setLook((l) => (l ? { ...l, ...patch } : l));

  const done = async () => {
    if (!look || !style) return setResult("cancel");
    await savePrefs(withWidget(await loadPrefs(), widgetInfo.widgetId, look));
    draw(renderWidget(widgetInfo.widgetName, style, widgetInfo, look, data));
    setResult("ok");
  };

  const chips = <K extends string | number>(values: readonly K[], current: K | undefined, label: (v: K) => string, pick: (v: K) => void) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {values.map((v) => {
        const on = v === current;
        return (
          <Pressable key={String(v)} onPress={() => pick(v)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? th.accentFill : th.lum3, borderWidth: 1, borderColor: on ? th.accentFill : th.hairStrong }}>
            <Text style={{ color: on ? th.onAccent : th.t1, fontSize: 14, fontWeight: "600" }}>{label(v)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const title = (s: string) => <Text style={{ color: th.t3, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 22, marginBottom: 10 }}>{s}</Text>;

  // Preview at the placed size, capped so it fits the screen.
  const w = Math.min(widgetInfo.width || 320, 360);
  const h = Math.min(widgetInfo.height || 160, 360);

  return (
    <View style={{ flex: 1, backgroundColor: th.lum0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48 }}>
        <Text style={{ color: th.t1, fontSize: 22, fontWeight: "700" }}>{t("Widget settings")}</Text>
        <Text style={{ color: th.t3, fontSize: 13, marginTop: 4 }}>{t("Applies to this widget. The default for all widgets is in the app under Settings, Widgets.")}</Text>
        {/* A wallpaper-like backdrop, so transparency is visible in the preview. */}
        <LinearGradient colors={[th.accentFill, th.lum3]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginTop: 20, padding: 16, borderRadius: 20, alignItems: "center" }}>
          {look && style && (
            <WidgetPreview width={w} height={h} renderWidget={() => widgetElement(widgetInfo.widgetName, look.theme === "system" ? scheme : look.theme, style, { width: w, height: h }, look, data)} />
          )}
        </LinearGradient>
        {look && (
          <>
            {title(t("Background"))}
            {chips(OPACITIES, look.opacity, (o) => (o === 0 ? t("Glass") : `${Math.round(o * 100)} %`), (opacity) => set({ opacity }))}
            {title(t("Look"))}
            {chips(WIDGET_THEMES, look.theme, (v) => THEME_LABEL[v](), (theme) => set({ theme }))}
            {widgetInfo.widgetName === WIDGET_ENTRIES && (
              <>
                {title(t("Shows"))}
                {chips(ENTRY_SOURCES, look.source, (v) => SOURCE_LABEL[v](), (source) => set({ source }))}
              </>
            )}
          </>
        )}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 32 }}>
          <Pressable onPress={() => setResult("cancel")} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: th.lum3 }}>
            <Text style={{ color: th.t1, fontSize: 15, fontWeight: "600" }}>{t("Cancel")}</Text>
          </Pressable>
          <Pressable onPress={() => void done()} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: th.accentFill }}>
            <Text style={{ color: th.onAccent, fontSize: 15, fontWeight: "700" }}>{t("Done")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
