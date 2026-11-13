import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { loadDueReminders } from "../api/kortex";
import { t } from "../i18n";
import { contentOf, entryLink, isFuture, notificationId, planDue, pruneAnnounced, REMINDER_CHANNEL, type Announced, type DueItem } from "./plan";

/*
 * Local reminder notifications (Android; the web build is a no-op).
 * A reminder set on the phone is scheduled as a date notification; reminders set on web or desktop arrive
 * through GET /api/reminders/due on app start and in the background task. Every call swallows its errors:
 * a missing permission or module must never break the data flow behind it.
 */

const ENABLED_KEY = "kortex.notify.enabled";
const ANNOUNCED_KEY = "kortex.notify.announced";

const supported = () => Platform.OS === "android";

export async function isNotifyEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) !== "off";
  } catch {
    return true;
  }
}

async function readAnnounced(): Promise<Announced> {
  try {
    return JSON.parse((await AsyncStorage.getItem(ANNOUNCED_KEY)) ?? "{}") as Announced;
  } catch {
    return {};
  }
}
const writeAnnounced = (a: Announced) => AsyncStorage.setItem(ANNOUNCED_KEY, JSON.stringify(pruneAnnounced(a))).catch(() => undefined);

/** Foreground behaviour and the channel; call once at start (idempotent). */
export async function setupNotifications(): Promise<void> {
  if (!supported()) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      // Android shows the channel name in the system settings; setting it again renames it after a language switch.
      name: t("Reminders"),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    });
  } catch {
    /* module unavailable */
  }
}

/** Asks for the Android 13+ permission (only when `ask`); true when notifications may be shown. */
export async function notificationsAllowed(ask = false): Promise<boolean> {
  if (!supported()) return false;
  try {
    let p = await Notifications.getPermissionsAsync();
    if (!p.granted && ask && p.canAskAgain) p = await Notifications.requestPermissionsAsync();
    return p.granted;
  } catch {
    return false;
  }
}

/** Schedules (or re-schedules) the notification of one item at `iso`; a past instant only cancels. */
export async function scheduleReminder(id: string, title: string, iso: string): Promise<void> {
  if (!supported()) return;
  try {
    await cancelReminder(id);
    if (!isFuture(iso) || !(await isNotifyEnabled()) || !(await notificationsAllowed(true))) return;
    await Notifications.scheduleNotificationAsync({
      identifier: notificationId(id),
      content: { ...contentOf({ title, kind: "reminder" }), data: { url: entryLink(id), id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(iso), channelId: REMINDER_CHANNEL },
    });
    // Announced at scheduling time, so the due sync does not show it a second time.
    const a = await readAnnounced();
    await writeAnnounced({ ...a, [id]: iso });
  } catch {
    /* ignore */
  }
}

/** Cancels the pending notification of an item and removes a delivered one (snooze, done, delete, archive). */
export async function cancelReminder(id: string): Promise<void> {
  if (!supported()) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId(id));
    await Notifications.dismissNotificationAsync(notificationId(id)).catch(() => undefined);
    const a = await readAnnounced();
    if (id in a) {
      delete a[id];
      await writeAnnounced(a);
    }
  } catch {
    /* ignore */
  }
}

/** Re-plans the loaded items: future reminders get scheduled, cleared ones cancelled. */
export async function syncLocalReminders(items: readonly { id: string; title: string; remind_at?: string | null }[]): Promise<void> {
  if (!supported()) return;
  const announced = await readAnnounced();
  for (const it of items) {
    if (isFuture(it.remind_at)) {
      if (announced[it.id] !== it.remind_at) await scheduleReminder(it.id, it.title, it.remind_at!);
    } else if (!it.remind_at && it.id in announced) await cancelReminder(it.id);
  }
}

/** Shows what /api/reminders/due reports and was not announced yet. Returns how many were shown. */
export async function syncDueReminders(): Promise<number> {
  if (!supported() || !(await isNotifyEnabled()) || !(await notificationsAllowed(false))) return 0;
  try {
    const due: DueItem[] = await loadDueReminders();
    const plan = planDue(due, await readAnnounced());
    for (const d of plan.show) {
      await Notifications.scheduleNotificationAsync({
        identifier: notificationId(d.id),
        content: { ...contentOf(d), data: { url: entryLink(d.id), id: d.id } },
        trigger: { channelId: REMINDER_CHANNEL },
      });
    }
    await writeAnnounced(plan.announced);
    return plan.show.length;
  } catch {
    return 0;
  }
}

/** Switch of the Einstellungen: off cancels everything pending, on asks for the permission. Returns the new state. */
export async function setNotifyEnabled(on: boolean): Promise<boolean> {
  if (!supported()) return on;
  if (!on) {
    await AsyncStorage.setItem(ENABLED_KEY, "off").catch(() => undefined);
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
    await AsyncStorage.removeItem(ANNOUNCED_KEY).catch(() => undefined);
    return false;
  }
  const ok = await notificationsAllowed(true);
  await AsyncStorage.setItem(ENABLED_KEY, ok ? "on" : "off").catch(() => undefined);
  return ok;
}
