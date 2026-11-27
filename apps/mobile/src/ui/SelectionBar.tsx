import { t } from "../i18n";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { useChrome } from "./Chrome";
import { Icon, type IconName } from "./Icon";
import { glass, ring, T } from "./primitives";
import { useHeaderH } from "./Shell";

/*
 * Bar of the list selection mode (feedback round 2, #4): "n ausgewählt", the bulk actions of the shared model
 * and a close button. With exactly one row selected "Mehr" opens that row's full menu.
 */

export interface BarAction {
  key: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  run: () => void;
}

export function SelectionBar({ count, total, actions, onAll, onClose }: { count: number; total: number; actions: BarAction[]; onAll: () => void; onClose: () => void }) {
  const th = useTheme();
  const { top } = useChrome();
  const headerH = useHeaderH();
  return (
    <View
      accessibilityRole="toolbar"
      style={[{ position: "absolute", left: 12, right: 12, top: top + headerH + 4, zIndex: 40, borderRadius: RADIUS.card, paddingVertical: 8, gap: 6, boxShadow: th.shadowFloating } as ViewStyle, glass(th), ring(th.borderSubtle)]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Clear selection")} onPress={onClose} hitSlop={8} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" size={18} color={th.textPrimary} />
        </Pressable>
        <T size={14} lh={20} weight={600} style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {t("{n} selected", { n: count })}
        </T>
        {count < total && (
          <Pressable accessibilityRole="button" onPress={onAll} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 10 }}>
            <T size={13} lh={18} weight={500} color={th.accentAi}>
              {t("All {n}", { n: total })}
            </T>
          </Pressable>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 8 }}>
        {actions.map((a) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={a.run}
            style={[{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.control, backgroundColor: th.bgSurfaceMuted }]}
          >
            <Icon name={a.icon} size={15} color={a.danger ? th.statusUrgentText : th.textSecondary} />
            <T size={13} lh={18} weight={500} color={a.danger ? th.statusUrgentText : th.textPrimary}>
              {a.label}
            </T>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
