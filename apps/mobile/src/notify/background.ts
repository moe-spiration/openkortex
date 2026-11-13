import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { isConfigured } from "../api/kortex";
import { restoreDeviceLocale } from "../i18n/device";
import { refreshWidgets } from "../widgets/refresh";
import { syncDueReminders } from "./notifications";

/*
 * Background fetch (WorkManager via expo-background-task): about every 15+ minutes Android lets us compare
 * /api/reminders/due and refresh the widgets. The task is defined at module level of the JS entry (index.ts).
 */

export const DUE_TASK = "kortex-due-sync";

if (Platform.OS === "android") {
  TaskManager.defineTask(DUE_TASK, async () => {
    try {
      if (isConfigured()) {
        // Headless: notification texts and widgets use the language stored on the device.
        await restoreDeviceLocale();
        await syncDueReminders();
        await refreshWidgets();
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Registers the periodic task once the user is signed in (safe to call again). */
export async function registerDueSync(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(DUE_TASK))) await BackgroundTask.registerTaskAsync(DUE_TASK, { minimumInterval: 15 });
  } catch {
    /* background tasks unavailable (restricted battery mode) */
  }
}
