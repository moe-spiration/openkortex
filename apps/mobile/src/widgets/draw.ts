import type { WidgetInfo, WidgetRepresentation } from "react-native-android-widget";
import { checkinModel, todayModel, type WidgetCache } from "./data";
import { applyEntryPending, settingsFor, WIDGET_CAPTURE, WIDGET_CHECKIN, WIDGET_ENTRIES, WIDGET_TODAY, type EntryPending, type WidgetSettings } from "./model";
import { renderWidget, type WidgetData } from "./render";

/** Changes drawn before the server answered (the widget shows them at once). */
export interface Pending {
  /** Tasks ticked, reminders done, radar changes seen. */
  doneIds?: string[];
  /** Reminder id -> new remind_at. */
  snoozed?: Record<string, string>;
  energy?: number;
  entries?: EntryPending;
}

/** Loads exactly what one widget shows. */
export async function dataFor(name: string, look: WidgetSettings, cache: WidgetCache, pending: Pending = {}): Promise<WidgetData> {
  if (name === WIDGET_TODAY) return { today: todayModel(await cache.today(), pending.doneIds, pending.snoozed) };
  if (name === WIDGET_ENTRIES) {
    const cards = await cache.entries(look.source);
    return { entries: cards && pending.entries ? applyEntryPending(cards, pending.entries) : cards };
  }
  if (name === WIDGET_CHECKIN) return { checkin: checkinModel(await cache.checkin(), pending.energy) };
  return {};
}

/** A placed widget, drawn with its own settings and fresh (or cached) data. */
export async function drawWidget(info: WidgetInfo, cache: WidgetCache, pending: Pending = {}): Promise<WidgetRepresentation> {
  const [prefs, style] = await Promise.all([cache.prefs(), cache.style()]);
  const look = settingsFor(prefs, info.widgetId);
  const data = info.widgetName === WIDGET_CAPTURE ? {} : await dataFor(info.widgetName, look, cache, pending);
  return renderWidget(info.widgetName, style, info, look, data);
}
