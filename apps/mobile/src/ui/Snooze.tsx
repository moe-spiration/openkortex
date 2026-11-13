import { intlLocale, t } from "../i18n";
import { useLocale } from "../i18n/device";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { remindOptions } from "../lib/remind";
import { useApp } from "../state/AppState";
import { useData } from "../state/Data";
import { useTheme } from "../theme/ThemeProvider";
import { Btn, Micro, T } from "./primitives";

/*
 * Reminder (snooze) of an entry (S11): "This evening", "Tomorrow", "Next week" set knowledge_items.remind_at
 * of the item, "Done" clears it. Local phone time. Goes through Data.setReminder so the Home list "Heute fällig" follows.
 */

const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function Snooze({ id, remindAt }: { id: string; remindAt: string | null }) {
  const th = useTheme();
  const { say } = useApp();
  const d = useData();
  const [at, setAt] = useState<string | null>(remindAt);
  const locale = useLocale();
  // The option labels are texts: rebuilt when the language changes.
  const options = useMemo(() => remindOptions(), [locale]);

  async function set(iso: string | null) {
    const before = at;
    setAt(iso);
    const err = await d.setReminder(id, iso);
    if (err) {
      setAt(before);
      say(t("Reminder not saved: {message}", { message: err }));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Micro>{t("Reminder")}</Micro>
      {!!at && (
        <T size={13.5} lh={20} color={Date.parse(at) <= Date.now() ? th.statusUrgentText : th.textSecondary}>
          {Date.parse(at) <= Date.now() ? t("Due since {when}", { when: when(at) }) : t("On {when}", { when: when(at) })}
        </T>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => (
          <Btn key={o.key} sm minHeight={36} onPress={() => void set(o.iso)}>
            {o.label}
          </Btn>
        ))}
        {!!at && (
          <Btn sm minHeight={36} variant="ghost" icon="check" onPress={() => void set(null)}>
            {t("Done")}
          </Btn>
        )}
      </View>
    </View>
  );
}
