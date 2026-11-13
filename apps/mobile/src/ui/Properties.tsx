import { t } from "../i18n";
import { Linking, Pressable, View } from "react-native";
import { fieldLabel, metadataFields, statusLabel, typeDefinition, typeStatuses } from "@kortex/db/type-registry";
import { metaLink, metaValue } from "../data/meta";
import { typeLabel } from "../data/live";
import { useApp } from "../state/AppState";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "./Icon";
import { Help, Micro, T } from "./primitives";
import { typeIconName } from "./typeIcon";

/*
 * Eigenschaften of an entry, built from the type registry (@kortex/db): the type with its icon, the
 * lifecycle status of the type (metadata.status, e.g. Buch: Will ich lesen · Lese ich · Gelesen), a
 * rating 0–10 as five stars (2 per star) and the typed fields that are set (ISBN, IMDb, Aussteller …).
 * Status and rating are edited here; the other fields are read-only on the phone (web: property pills).
 */

/** Fields shown as their own control, not in the field list. */
const OWN = new Set(["status", "rating"]);

/** True when the panel has anything to show for this type / metadata. */
export function hasProperties(type: string | undefined, meta: Record<string, unknown> | undefined): boolean {
  if (!type) return false;
  return typeStatuses(type).length > 0 || metadataFields(type).some((f) => meta?.[f] != null && f !== "rating") || "rating" in (typeDefinition(type)?.metadata?.shape ?? {});
}

export function Properties({ id, type, meta }: { id: string; type: string; meta: Record<string, unknown> }) {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const statuses = typeStatuses(type);
  const ratable = "rating" in (typeDefinition(type)?.metadata?.shape ?? {});
  const status = typeof meta.status === "string" ? meta.status : null;
  const rating = typeof meta.rating === "number" ? meta.rating : null;
  const fields = metadataFields(type).filter((f) => !OWN.has(f) && meta[f] != null && metaValue(meta[f]) !== "");
  const set = (patch: Record<string, unknown>, ok: string) => void d.patchMeta(id, patch).then((err) => a.say(err ?? ok));

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Micro style={{ flex: 1 }}>{t("Properties")}</Micro>
        <Icon name={typeIconName(type)} size={14} color={th.textMuted} />
        <Help>{typeLabel(type)}</Help>
      </View>

      {statuses.length > 0 && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Status" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {statuses.map((s) => {
            const on = status === s;
            return (
              <Pressable
                key={s}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => set({ status: on ? null : s }, on ? t("Status removed") : t("Status: {status}", { status: statusLabel(s) }))}
                style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: RADIUS.control, borderWidth: 1, borderColor: on ? th.accentAi : th.borderSubtle, backgroundColor: on ? th.accentAiSoft : "transparent" }}
              >
                <T size={13} lh={18} weight={on ? 600 : 400} color={on ? th.textPrimary : th.textSecondary}>
                  {statusLabel(s)}
                </T>
              </Pressable>
            );
          })}
        </View>
      )}

      {ratable && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <T size={13} lh={18} color={th.textSecondary} style={{ width: 84 }}>
            {t("Rating")}
          </T>
          {[1, 2, 3, 4, 5].map((n) => {
            const value = n * 2;
            const on = rating != null && rating >= value - 1;
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={t("{n} of 5 stars", { n })}
                hitSlop={4}
                onPress={() => set({ rating: rating === value ? null : value }, rating === value ? t("Rating removed") : t("Rating: {n} of 5", { n }))}
                style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="star" size={20} color={on ? th.accentAi : th.textMuted} />
              </Pressable>
            );
          })}
        </View>
      )}

      {fields.length > 0 && (
        <View style={{ gap: 2 }}>
          {fields.map((f) => {
            const text = metaValue(meta[f]);
            const link = metaLink(f, meta[f]);
            return (
              <Pressable
                key={f}
                disabled={!link}
                accessibilityRole={link ? "link" : undefined}
                onPress={() => link && void Linking.openURL(link)}
                style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 32, paddingVertical: 6 }}
              >
                <T size={13} lh={18} color={th.textSecondary} style={{ width: 84 }}>
                  {fieldLabel(f)}
                </T>
                <T size={13.5} lh={19} color={link ? th.accentAi : th.textPrimary} numberOfLines={4} style={{ flex: 1 }}>
                  {text}
                </T>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
