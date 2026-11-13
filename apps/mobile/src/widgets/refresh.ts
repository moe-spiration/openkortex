import { Platform } from "react-native";
import { WIDGET_CAPTURE, WIDGET_TODAY } from "./model";

/** Redraws every placed widget (app start, foreground, background task). Loaded lazily: web has no widget module. */
export async function refreshWidgets(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const [{ requestWidgetUpdate }, { renderWidget, storedAccent }, { loadTodayData, todayModel }] = await Promise.all([
      import("react-native-android-widget"),
      import("./render"),
      import("./data"),
    ]);
    // Also runs in the background task (no React tree): draw in the language stored on the device.
    const { restoreDeviceLocale } = await import("../i18n/device");
    await restoreDeviceLocale();
    const accent = await storedAccent();
    const data = await loadTodayData();
    for (const widgetName of [WIDGET_CAPTURE, WIDGET_TODAY]) {
      await requestWidgetUpdate({
        widgetName,
        renderWidget: (info) => renderWidget(widgetName, accent, info, { model: todayModel(data, info.height), error: data.error }),
      });
    }
  } catch {
    /* no widget placed, or offline */
  }
}
