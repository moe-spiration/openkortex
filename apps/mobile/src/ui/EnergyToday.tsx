import { intlLocale, t, tn } from "../i18n";
import { Pressable, View } from "react-native";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "./Icon";
import { Check, Micro, T } from "./primitives";

const WEEK_DAY = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "narrow", timeZone: "UTC" });

/**
 * "Heute im Überblick" (like the web Home overview and the approved preview): the streak with the energy bars of the
 * last seven days, the energy picker (one tap on 1 to 10 saves the day's check-in, no save button) and "Top 3
 * heute" to tick off. Everything lives in the daily note. Habits are not tracked in Kortex (Griply).
 */
export function EnergyToday({ link }: { link?: { label: string; run: () => void } }) {
  const th = useTheme();
  const a = useApp();
  const tile = { flex: 1, gap: 6, padding: 12, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted } as const;
  return (
    <View style={{ padding: 14, gap: 12, borderRadius: RADIUS.card, backgroundColor: alpha(th.bgSurfaceFlat, 0.72) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Micro style={{ flex: 1 }}>{t("Today at a glance")}</Micro>
        {link && (
          <Pressable accessibilityRole="link" hitSlop={8} onPress={link.run} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <T size={12.5} lh={18} ls={0} color={th.tags.ai.fg}>
              {link.label}
            </T>
            <Icon name="chev" size={12} color={th.tags.ai.fg} />
          </Pressable>
        )}
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={tile}>
          <Micro>Streak</Micro>
          <T num size={22} lh={26} ls={-0.01}>
            {tn(a.streak, "{n} day", "{n} days")}
          </T>
          <View accessibilityLabel={t("Energy of the last {n} days", { n: a.energyHistory.length })} style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 34 }}>
            {a.energyHistory.map((d) => (
              <View key={d.date} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                <View style={{ width: "100%", height: d.energy ? Math.max(5, d.energy * 2.4) : 3, borderRadius: 2, backgroundColor: d.energy ? th.accentCheckin : th.borderSubtle }} />
                <T size={9.5} lh={11} ls={0} color={th.textMuted}>
                  {WEEK_DAY(d.date)}
                </T>
              </View>
            ))}
          </View>
        </View>
        <View style={tile}>
          <Micro>{t("Energy")}</Micro>
          <T num size={22} lh={26} ls={-0.01}>
            {a.energy ? `${a.energy} / 10` : "– / 10"}
          </T>
          <T size={12} lh={16} ls={0} color={th.textMuted}>
            {a.energy ? t("Saved") : t("How are you?")}
          </T>
        </View>
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel={t("Energy 1 to 10")} style={{ flexDirection: "row", gap: 4 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
          const on = a.energy === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t("Energy {n}/10", { n })}
              onPress={() => a.setEnergy(n)}
              style={{ flex: 1, height: 44, borderRadius: RADIUS.control, alignItems: "center", justifyContent: "center", backgroundColor: on ? alpha(th.accentCheckin, 0.22) : n <= a.energy ? alpha(th.accentCheckin, 0.1) : th.bgSurfaceMuted }}
            >
              <T size={13} lh={16} ls={0} weight={500} color={on ? th.accentCheckin : th.textSecondary}>
                {n}
              </T>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 2 }}>
        <Micro>{t("Top 3 today")}</Micro>
        {a.focus.length === 0 && (
          <T size={13} lh={18} ls={0} color={th.textMuted}>
            {t("No open tasks.")}
          </T>
        )}
        {a.focus.map((f) => (
          <Pressable key={f.key} onPress={() => a.toggleFocus(f.key)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Check on={f.done} onPress={() => a.toggleFocus(f.key)} label={f.text} />
            <T type="body" numberOfLines={1} style={{ flex: 1, textDecorationLine: f.done ? "line-through" : "none" }} color={f.done ? th.textMuted : th.textPrimary}>
              {f.text}
            </T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
