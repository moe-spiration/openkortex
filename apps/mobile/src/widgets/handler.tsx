import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from "react-native-android-widget";
import { patchItemWatch, setRead, setTaskDone, updateItem } from "../api/kortex";
import { ensureConfigured } from "../api/restore";
import { cancelReminder, scheduleReminder } from "../notify/notifications";
import { itemIdOf } from "../notify/plan";
import { restoreDeviceLocale } from "../i18n/device";
import { createCache, loadPrefs, saveEnergy, savePrefs } from "./data";
import { drawWidget } from "./draw";
import { CLICK, ENTRY_SOURCES, snoozeAt, withoutWidget, withWidget, type EntrySource } from "./model";
import { refreshWidgets } from "./refresh";

/*
 * Headless task of the widgets: Android calls it when a widget is added, resized, every updatePeriodMillis
 * and on the in-widget actions (CLICK): tick a task, clear or put off a reminder, star, mark read, file an inbox
 * entry, log energy. Each is drawn at once (Pending), then saved, then every widget is drawn from the server.
 * Taps that open the app are plain deep links (OPEN_URI kortex://open?...); note, voice and new task open the
 * quick overlay (kortexquick://capture, src/quick).
 */

async function onClick({ widgetInfo: info, clickAction, clickActionData, renderWidget: draw }: WidgetTaskHandlerProps): Promise<void> {
  const data = clickActionData ?? {};
  if (clickAction === CLICK.taskDone && typeof data.id === "string") {
    // Ticked at once, then saved; the next round draws every widget from the server again.
    draw(await drawWidget(info, createCache(), { doneIds: [data.id] }));
    await setTaskDone(data.id, true).catch(() => undefined);
    await refreshWidgets();
    return;
  }
  if (clickAction === CLICK.energy && typeof data.n === "number") {
    const n = Math.min(10, Math.max(1, Math.round(data.n)));
    draw(await drawWidget(info, createCache(), { energy: n }));
    await saveEnergy(n).catch(() => undefined);
    await refreshWidgets();
    return;
  }
  if (clickAction === CLICK.dueDone && typeof data.id === "string") {
    const id = data.id;
    draw(await drawWidget(info, createCache(), { doneIds: [id] }));
    const write = data.kind === "radar" ? patchItemWatch(itemIdOf(id), { seen: true }) : updateItem(id, { remind_at: null }).then(() => cancelReminder(id));
    await write.catch(() => undefined);
    await refreshWidgets();
    return;
  }
  if (clickAction === CLICK.snooze && typeof data.id === "string") {
    const id = data.id;
    const iso = snoozeAt(data.when === "tomorrow" ? "tomorrow" : "hour", new Date());
    draw(await drawWidget(info, createCache(), { snoozed: { [id]: iso } }));
    await updateItem(id, { remind_at: iso })
      .then(() => scheduleReminder(id, typeof data.title === "string" ? data.title : "", iso))
      .catch(() => undefined);
    await refreshWidgets();
    return;
  }
  if ((clickAction === CLICK.fav || clickAction === CLICK.read) && typeof data.id === "string") {
    const id = data.id;
    const on = data.on === true;
    const fav = clickAction === CLICK.fav;
    draw(await drawWidget(info, createCache(), { entries: fav ? { fav: { [id]: on } } : { read: { [id]: on } } }));
    await (fav ? updateItem(id, { is_favorite: on }) : setRead(id, on)).catch(() => undefined);
    await refreshWidgets();
    return;
  }
  if (clickAction === CLICK.file && typeof data.id === "string" && typeof data.target === "string") {
    draw(await drawWidget(info, createCache(), { entries: { filed: [data.id] } }));
    await updateItem(data.id, { folder_path: data.target }).catch(() => undefined);
    await refreshWidgets();
    return;
  }
  if (clickAction === CLICK.source && ENTRY_SOURCES.includes(data.source as EntrySource)) {
    await savePrefs(withWidget(await loadPrefs(), info.widgetId, { source: data.source as EntrySource }));
    draw(await drawWidget(info, createCache()));
    return;
  }
  // CLICK.refresh and anything unknown: draw again from the server.
  draw(await drawWidget(info, createCache()));
}

registerWidgetTaskHandler(async (props) => {
  if (props.widgetAction === "WIDGET_DELETED") {
    await savePrefs(withoutWidget(await loadPrefs(), props.widgetInfo.widgetId)).catch(() => undefined);
    return;
  }
  // Headless: no React tree has set the language, so read the stored choice before any text is drawn.
  await restoreDeviceLocale();
  await ensureConfigured();
  if (props.widgetAction === "WIDGET_CLICK") return onClick(props);
  props.renderWidget(await drawWidget(props.widgetInfo, createCache()));
});
