import { t } from "../i18n";
import { Pressable, View, type ViewStyle } from "react-native";
import { useApp } from "../state/AppState";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Help, T } from "./primitives";
import { SwipeSheet } from "./SwipeSheet";
import { RMenuRow, RSheet, RText } from "./ruhe";

/* Long-press context menu: a short bottom sheet with the row's actions; swipe down or tap outside to close. */

export function ActionMenu() {
  const th = useTheme();
  const { menu, closeMenu } = useApp();
  if (!menu) return null;
  if (th.look === "ruhe")
    // Ruhe: a glass sheet that ends above the tab bar; 48 rows, title 12.5 t3, destructive in crit.
    return (
      <RSheet onClose={closeMenu} scroll aboveBar maxHeight="70%" z={30} contentStyle={{ paddingHorizontal: 14, paddingBottom: 12 }}>
        {!!menu.title && (
          <RText step="rowSub" color={th.t3} numberOfLines={1} style={{ paddingHorizontal: 4, paddingBottom: 4 }}>
            {menu.title}
          </RText>
        )}
        {menu.items.map((it) => (
          <RMenuRow
            key={it.label}
            icon={(it.icon as IconName | undefined) ?? "chev"}
            label={it.label}
            danger={it.danger}
            onPress={() => {
              closeMenu();
              it.run();
            }}
          />
        ))}
      </RSheet>
    );
  return (
    <>
      <Pressable accessibilityLabel={t("Close menu")} onPress={closeMenu} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: th.bgScrim }} />
      <SwipeSheet
        onClose={closeMenu}
        grabHeight={26}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 28, paddingHorizontal: 12 }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "70%", zIndex: 31, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat, boxShadow: th.shadowFloating } as ViewStyle}
      >
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: th.borderSubtle, marginBottom: 10 }} />
        <Help numberOfLines={1} style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
          {menu.title}
        </Help>
        {menu.items.map((it) => (
          <Pressable
            key={it.label}
            accessibilityRole="button"
            onPress={() => {
              closeMenu();
              it.run();
            }}
            style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, borderRadius: RADIUS.row, backgroundColor: pressed ? th.bgHover : "transparent" })}
          >
            {it.icon && <Icon name={it.icon as IconName} size={18} color={it.danger ? th.statusUrgentText : th.textSecondary} />}
            <T size={15} lh={21} color={it.danger ? th.statusUrgentText : th.textPrimary}>
              {it.label}
            </T>
          </Pressable>
        ))}
      </SwipeSheet>
    </>
  );
}
