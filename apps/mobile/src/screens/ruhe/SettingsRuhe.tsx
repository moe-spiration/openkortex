import { t } from "../../i18n";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { tick } from "../../lib/haptics";
import { useApp } from "../../state/AppState";
import { PackPickerRow } from "../../theme/PackPicker";
import { useTheme } from "../../theme/ThemeProvider";
import { ACCENTS, RUHE_SPACE } from "../../theme/tokens";
import { Icon } from "../../ui/Icon";
import { DetailHeader, GroupHead, RAvatar, RButton, RButtonRow, RGroup, RGroupRow, RText, RToggle } from "../../ui/ruhe";
import type { SettingsRow } from "../Settings";

/*
 * Einstellungen, Ruhe (android-richtlinien.md 8 B, 7 "Gruppe"): a detail page with the back link, title "Settings",
 * the profile as one outlined group (avatar 52, name, account line, sync state), then every group as a label over an
 * outlined group of rows: label 15, help 12.5 t3, value t3 plus chevron or a toggle. Sign out as the destructive
 * button (never filled red), the version line in t4. The rows and their actions come from Settings (same data).
 */

const PAD = RUHE_SPACE.page;

export function SettingsRuhe({ groups, onBack, name, account, initials, onSignOut, version }: { groups: { title: string; rows: SettingsRow[] }[]; onBack: () => void; name: string; account: string; initials: string; onSignOut: () => void; version: string }) {
  const th = useTheme();
  const a = useApp();
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      <DetailHeader backLabel={t("Back")} onBack={onBack} title={t("Settings")} />

      <RGroup style={{ marginTop: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 14 }}>
          <RAvatar initials={initials} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <RText step="titleCard" numberOfLines={1}>
              {name}
            </RText>
            <RText step="rowSub" color={th.t3} numberOfLines={1}>
              {account}
            </RText>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: th.ok }} />
            <RText step="meta" color={th.t3}>
              {t("In sync")}
            </RText>
          </View>
        </View>
      </RGroup>

      {groups
        .filter((g) => g.rows.length)
        .map((g) => (
          <View key={g.title}>
            <GroupHead label={g.title} />
            <RGroup>
              {g.rows.map((r, i) => {
                const first = i === 0;
                const line = first ? null : { borderTopWidth: 1, borderTopColor: th.hair };
                if (r.kind === "accent") {
                  return (
                    <View key={r.label} style={[{ paddingVertical: 12, paddingHorizontal: 14, gap: 10 }, line]}>
                      <View>
                        <RText step="body" weight={400}>
                          {r.label}
                        </RText>
                        <RText step="rowSub" color={th.t3}>
                          {r.help}
                        </RText>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6 }}>
                        {ACCENTS.map((sw) => {
                          const on = a.accent === sw.key;
                          return (
                            <Pressable
                              key={sw.key}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: on }}
                              accessibilityLabel={t(sw.label)}
                              hitSlop={4}
                              onPress={() => {
                                tick();
                                a.setAccent(sw.key);
                              }}
                              style={{ flex: 1, maxWidth: 32, aspectRatio: 1, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: sw.accent, boxShadow: on ? `0 0 0 2px ${th.bgMainWindow}, 0 0 0 3.5px ${sw.accent}` : "none" } as ViewStyle}
                            >
                              {on && <Icon name="check" size={14} strokeWidth={2.4} color="#FFFFFF" />}
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                }
                if (r.kind === "pack") {
                  return (
                    <View key={r.label} style={[{ paddingHorizontal: 14 }, line]}>
                      <PackPickerRow label={r.label} help={r.help} />
                    </View>
                  );
                }
                if (r.kind === "toggle") return <RGroupRow key={r.label} first={first} label={r.label} sub={r.help} onPress={r.flip} trailing={<RToggle on={r.on} label={r.label} onPress={r.flip} />} />;
                return <RGroupRow key={r.label} first={first} label={r.label} sub={r.help} value={r.value} onPress={r.pick} trailing={<Icon name="chev" size={15} color={th.t4} />} />;
              })}
            </RGroup>
          </View>
        ))}

      <RButtonRow style={{ marginTop: 24 }}>
        <RButton variant="destructive" grow label={t("Sign out")} onPress={onSignOut} />
      </RButtonRow>
      <RText step="meta" color={th.t4} align="center" style={{ paddingHorizontal: PAD, paddingTop: 14 }}>
        {version}
      </RText>
    </ScrollView>
  );
}
