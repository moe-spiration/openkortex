import { registerWidgetTaskHandler } from "react-native-android-widget";
import { restoreDeviceLocale } from "../i18n/device";
import { loadTodayData, todayModel } from "./data";
import { WIDGET_TODAY } from "./model";
import { renderWidget, storedAccent } from "./render";

/*
 * Headless task of the widgets: Android calls it when a widget is added, resized and every updatePeriodMillis.
 * Taps are plain deep links (OPEN_URI kortex://open?...), so no click handling is needed here.
 */
registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget: draw }) => {
  if (widgetAction === "WIDGET_DELETED") return;
  // Headless: no React tree has set the language, so read the stored choice before any text is drawn.
  await restoreDeviceLocale();
  const accent = await storedAccent();
  const data = widgetInfo.widgetName === WIDGET_TODAY ? await loadTodayData() : { due: [], tasks: [], error: false };
  draw(renderWidget(widgetInfo.widgetName, accent, widgetInfo, { model: todayModel(data, widgetInfo.height), error: data.error }));
});
