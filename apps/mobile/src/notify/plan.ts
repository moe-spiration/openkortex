// Pure rules of the local reminder notifications (no expo-notifications import, so vitest can run them).

import { t } from "../i18n";

export type DueKind = "reminder" | "radar";

/** One entry of GET /api/reminders/due. `id` is the item id (reminder) or `radar:<item id>:<change time>`. */
export interface DueItem {
  id: string;
  title: string;
  remind_at: string;
  kind: DueKind;
  url?: string;
}

/** Android channel of the reminders ("Reminders" / "Erinnerungen"). */
export const REMINDER_CHANNEL = "reminders";

/** Scheduled-notification identifier of one item (one pending reminder per item; snooze replaces it). */
export const notificationId = (id: string) => `reminder:${id}`;

/** The entry to open for a due id: the item id itself, or the item behind a radar change. */
export function itemIdOf(id: string): string {
  const m = /^radar:([^:]+):/.exec(id);
  return m ? m[1]! : id;
}

/** True when the instant lies after `now` (a past or invalid reminder is never scheduled, the due sync shows it). */
export function isFuture(iso: string | null | undefined, now: Date = new Date()): boolean {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) && ms > now.getTime();
}

export function contentOf(item: Pick<DueItem, "title" | "kind">): { title: string; body: string } {
  const title = item.title.trim() || t("Untitled");
  return item.kind === "radar" ? { title, body: t("The watched page has changed") } : { title, body: t("Reminder") };
}

/** id -> the remind_at that was already announced (scheduled locally or shown), so nothing is announced twice. */
export type Announced = Record<string, string>;

/** Due items not announced yet (key: id + remind_at, so a snoozed reminder announces again) and the new map. */
export function planDue(due: readonly DueItem[], announced: Announced): { show: DueItem[]; announced: Announced } {
  const next: Announced = { ...announced };
  const show: DueItem[] = [];
  for (const d of due) {
    if (next[d.id] === d.remind_at) continue;
    next[d.id] = d.remind_at;
    show.push(d);
  }
  return { show, announced: next };
}

/** Keeps the map small: drops entries older than `days` (by their remind_at). */
export function pruneAnnounced(announced: Announced, now: Date = new Date(), days = 14): Announced {
  const cutoff = now.getTime() - days * 86_400_000;
  return Object.fromEntries(Object.entries(announced).filter(([, at]) => !(Date.parse(at) < cutoff)));
}

/** Deep link a notification or widget opens: the entry sheet, or a capture view ("voice" | "note" | "photo"). */
export const entryLink = (id: string) => `kortex://open?entry=${encodeURIComponent(itemIdOf(id))}`;
export const captureLink = (kind: "voice" | "note" | "photo") => `kortex://open?capture=${kind}`;
