/*
 * Browser notifications for due reminders and radar changes. The open tab asks GET /api/reminders/due every
 * few minutes; this module decides which items are new. An item counts as announced by `id` + `remind_at`
 * (a snoozed reminder keeps its id but gets a new time, so it can ring again). The announced map survives
 * reloads and is shared by all tabs through localStorage, so nothing is announced twice.
 */

import { t, tn } from "@/i18n";

export interface DueItem {
  id: string;
  title: string;
  remind_at: string;
  kind: "reminder" | "radar";
  url?: string;
}

export type Announced = Record<string, string>;

export const POLL_MS = 5 * 60_000;
export const ANNOUNCED_KEY = "kortex:reminders-announced";

/** Items not yet announced, and the announced map for the next round (entries no longer due are dropped). */
export function announce(items: readonly DueItem[], announced: Announced): { fresh: DueItem[]; next: Announced } {
  const fresh = items.filter((i) => announced[i.id] !== i.remind_at);
  const next: Announced = {};
  for (const i of items) next[i.id] = i.remind_at;
  return { fresh, next };
}

/** Title and body of the notification (one item) or of the summary (several). */
export function describe(fresh: readonly DueItem[]): { title: string; body: string } {
  if (fresh.length === 1) {
    const i = fresh[0]!;
    return i.kind === "radar"
      ? { title: t("Page has changed"), body: i.title }
      : { title: t("Reminder"), body: i.title };
  }
  const radar = fresh.filter((i) => i.kind === "radar").length;
  const rem = fresh.length - radar;
  const reminders = tn(rem, "{n} reminder", "{n} reminders");
  const changes = tn(radar, "{n} page change", "{n} page changes");
  const body = rem && radar ? t("{a} and {b}", { a: reminders, b: changes }) : rem ? reminders : radar ? changes : "";
  return { title: t("{n} new notices", { n: fresh.length }), body };
}
