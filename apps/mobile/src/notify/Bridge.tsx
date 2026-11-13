import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { isNotifyEnabled, notificationsAllowed, setupNotifications, syncDueReminders } from "./notifications";
import { itemIdOf } from "./plan";

/*
 * Mounted once the user is signed in: channel + permission, comparison with /api/reminders/due at start and
 * whenever the app returns to the foreground, the periodic background task, widget refresh, and the tap on a
 * notification (opens the entry through kortex://open?entry=<id>).
 */
export function NotificationBridge() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let off = false;
    const sync = async () => {
      if (off) return;
      await syncDueReminders();
      void import("../widgets/refresh").then((m) => m.refreshWidgets());
    };
    void (async () => {
      await setupNotifications();
      if (await isNotifyEnabled()) {
        await notificationsAllowed(true);
        void import("./background").then((m) => m.registerDueSync());
      }
      await sync();
    })();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void sync();
    });
    return () => {
      off = true;
      sub.remove();
    };
  }, []);

  // Tap while the app runs, and the tap that started it (cold start).
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (Platform.OS !== "android" || !last) return;
    if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = (last.notification.request.content.data as { id?: string } | undefined)?.id;
    if (id) router.push({ pathname: "/open", params: { entry: itemIdOf(id) } });
  }, [last, router]);

  return null;
}
