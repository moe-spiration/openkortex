import { Platform } from "react-native";
import { WIDGET_NAMES } from "./model";

/** Redraws every placed widget (app start, foreground, background task, changes in the app). Loaded lazily: web has no widget module. */
export async function refreshWidgets(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const [{ requestWidgetUpdate }, { createCache }, { drawWidget }, { restoreDeviceLocale }] = await Promise.all([
      import("react-native-android-widget"),
      import("./data"),
      import("./draw"),
      import("../i18n/device"),
    ]);
    // Also runs in the background task (no React tree): draw in the language stored on the device.
    await restoreDeviceLocale();
    // One cache for the round: each part loads once, and only if a placed widget shows it.
    const cache = createCache();
    for (const widgetName of WIDGET_NAMES) {
      await requestWidgetUpdate({ widgetName, renderWidget: (info) => drawWidget(info, cache) }).catch(() => undefined);
    }
  } catch {
    /* no widget placed, or offline */
  }
}
