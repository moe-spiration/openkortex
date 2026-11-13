import { Image, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { PACK_IDS, PACK_LABELS, type PackId } from "@kortex/theme-packs";
import { RADIUS } from "./tokens";
import { PACK_IMAGES } from "./packAssets.gen";
import { usePack } from "./pack";
import { useTheme } from "./ThemeProvider";
import { Help, ring, T } from "../ui/primitives";

/** Pack selection for the settings screen, below the accent colour: one card per pack (home background + two tiles). */
export function PackPickerRow({ label, help }: { label: string; help: string }) {
  const th = useTheme();
  const { pack, mode, setPack } = usePack();
  return (
    <View style={{ paddingVertical: 12, gap: 10 }}>
      <View style={{ gap: 1 }}>
        <T size={14} lh={20}>
          {label}
        </T>
        <Help>{help}</Help>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
        {PACK_IDS.map((id: PackId) => {
          const on = id === pack;
          const img = PACK_IMAGES[id][mode];
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={PACK_LABELS[id]}
              onPress={() => setPack(id)}
              style={[{ width: 132, gap: 6, padding: 6, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }, on ? ({ boxShadow: `inset 0 0 0 2px ${th.accentAi}` } as ViewStyle) : ring(th.borderSubtle)]}
            >
              <Image source={img.home.full} resizeMode="cover" style={{ width: "100%", height: 54, borderRadius: RADIUS.control }} />
              <View style={{ flexDirection: "row", gap: 4 }}>
                {[img.health.tile, img.notes.tile].map((s, i) => (
                  <Image key={i} source={s} resizeMode="cover" style={{ flex: 1, height: 30, borderRadius: RADIUS.control }} />
                ))}
              </View>
              <T size={13} lh={18} weight={600}>
                {PACK_LABELS[id]}
              </T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
