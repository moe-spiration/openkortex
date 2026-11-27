import { monthName, weekdayShort } from "@/lib/date/words";
import { t } from "@/i18n";

/*
 * Bibliothek list in the Ruhe look (gap web-a §3, mock `bibliothek`): rows grouped "Heute 4 / Gestern 4 / Diese Woche 5",
 * then one group per month; the time column says 10:30 (today, yesterday), "Mo" (this week) or "14.10." (older).
 * Pure, so the buckets are unit-tested.
 */

const DAY = 864e5;
const utc = (iso: string) => new Date(iso + "T12:00:00Z").getTime();
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY);

export type Bucket = { key: string; label: string };

/** The group an entry dated `date` falls into, seen from `today` (both ISO days). */
export function dayBucket(date: string, today: string): Bucket {
  const d = daysBetween(date, today);
  if (d <= 0) return { key: "today", label: t("Today") };
  if (d === 1) return { key: "yesterday", label: t("Yesterday") };
  if (d < 7) return { key: "week", label: t("This week") };
  const [y, m] = date.split("-");
  const sameYear = y === today.slice(0, 4);
  const month = monthName(Number(m) - 1);
  return { key: `m:${y}-${m}`, label: sameYear ? month : `${month} ${y}` };
}

/** Right column of a row: the time today and yesterday, the weekday this week, else the day ("14.10."). */
export function rowWhen(date: string, time: string, today: string, locale: string): string {
  const d = daysBetween(date, today);
  if (d <= 1) return time;
  if (d < 7) return weekdayShort(new Date(utc(date)).getUTCDay());
  const [, m, day] = date.split("-");
  return locale.startsWith("de") ? `${day}.${m}.` : `${m}/${day}`;
}

export interface Group<T> {
  key: string;
  label: string;
  items: T[];
}

/** The grid joins today and yesterday into one head ("Heute und gestern 8"), as in the mock `alleRaster`. */
export function gridBucket(date: string, today: string): Bucket {
  const b = dayBucket(date, today);
  return b.key === "today" || b.key === "yesterday" ? { key: "recent", label: t("Today and yesterday") } : b;
}

/**
 * Consecutive entries with the same bucket form one group, so the order of the list (newest or oldest first) stays
 * as it is. A sort by title gets no groups (null): a date head there would only interrupt the alphabet.
 */
export function groupRows<T extends { date: string }>(
  items: readonly T[],
  today: string,
  byDate: boolean,
  bucket: (date: string, today: string) => Bucket = dayBucket,
): Group<T>[] | null {
  if (!byDate) return null;
  const out: Group<T>[] = [];
  for (const it of items) {
    const b = bucket(it.date, today);
    const last = out[out.length - 1];
    if (last && last.key === b.key) last.items.push(it);
    else out.push({ key: b.key, label: b.label, items: [it] });
  }
  return out;
}

/** Entries per bucket over the whole list, so a head shows its full count while the rows still load in batches. */
export function bucketTotals(items: readonly { date: string }[], today: string, bucket: (date: string, today: string) => Bucket = dayBucket): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = bucket(it.date, today).key;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
