import type { ActionId, MenuAction, MenuSection } from "@kortex/ui";
import { t } from "@/i18n";
import { snoozePresets } from "./reminders";

/*
 * "Erinnern" in the item context menu (S11). The shared @kortex/ui menu has no reminder action, so the
 * entries are web-local flat actions whose id carries the choice: `remind:<ISO instant>` or `remind:clear`.
 * The ids are cast to ActionId; ContextMenu hands them to onAction unchanged. Icons reuse existing keys.
 */

const PREFIX = "remind:";
const CLEAR = `${PREFIX}clear`;

/** Menu section with the snooze presets of the S11 snooze UI, plus "Erinnerung entfernen" when one is set. */
export function remindSection(hasReminder: boolean, now: Date, day: string): MenuSection {
  const out: MenuAction[] = snoozePresets(now, day).map((p) => ({
    id: `${PREFIX}${p.iso}` as ActionId,
    label: t("Remind: {when}", { when: p.label }),
    icon: "undo",
  }));
  if (hasReminder) out.push({ id: CLEAR as ActionId, label: t("Remove reminder"), icon: "check" });
  return out;
}

/** The reminder an action id stands for: an ISO instant, `null` to clear, `undefined` when it is no reminder action. */
export function parseRemindAction(id: string): string | null | undefined {
  if (id === CLEAR) return null;
  if (!id.startsWith(PREFIX)) return undefined;
  const iso = id.slice(PREFIX.length);
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}
