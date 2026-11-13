/*
 * Delta radar (S11): a URL item can be watched (`metadata.watch`). The cron (server/radar) fetches the
 * page, compares its text with the stored snapshot and records a short "Änderungen" summary. Pages
 * that cannot be fetched get `status: "nicht beobachtbar"` plus the reason, never a silent failure.
 * Client-safe types and helpers, shared by web and Android; the diff and the cron live in apps/web server/radar.
 */

import { t } from "@kortex/i18n";
import { lazyLabels } from "./i18n";

export type WatchInterval = "daily" | "weekly";
export const WATCH_INTERVALS: readonly WatchInterval[] = ["daily", "weekly"];
/** Labels in the current language (getters, so the exported shape stays a plain record). */
export const WATCH_INTERVAL_LABEL: Record<WatchInterval, string> = lazyLabels({
  daily: () => t("daily"),
  weekly: () => t("weekly"),
});

/**
 * Stored status value in `metadata.watch.status` (an enum value, NOT a label: it never changes with
 * the language). Show it with `watchBlockedLabel()`.
 */
export const WATCH_BLOCKED = "nicht beobachtbar";
/** Display text of the blocked status in the current language. */
export const watchBlockedLabel = (): string => t("cannot be watched");

export interface WatchDiff {
  /** ISO time the change was found. */
  at: string;
  /** One or two sentences (model, or a line count when no model was available). */
  summary: string;
  /** Up to a handful of new / removed lines, each cut short. */
  added: string[];
  removed: string[];
}

export interface WatchState {
  enabled: boolean;
  interval: WatchInterval;
  /** Hash of the stored snapshot text; null before the first successful check. */
  last_hash?: string | null;
  last_checked_at?: string | null;
  last_diff?: WatchDiff | null;
  /** "ok", or "nicht beobachtbar" when the last fetch was blocked or empty (see `reason`). */
  status?: "ok" | typeof WATCH_BLOCKED;
  reason?: string | null;
  /** Snapshot text of the last check (page text, capped), the baseline of the next diff. */
  snapshot?: string | null;
  /** When the user acknowledged the last change (hides the badge). */
  seen_at?: string | null;
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function parseDiff(v: unknown): WatchDiff | null {
  const d = rec(v);
  const at = str(d.at);
  const summary = str(d.summary);
  if (!at || !summary) return null;
  const lines = (x: unknown) => (Array.isArray(x) ? x.filter((l): l is string => typeof l === "string") : []);
  return { at, summary, added: lines(d.added), removed: lines(d.removed) };
}

/** `metadata.watch` as a typed state; null when the item has none. Tolerant: junk fields are dropped. */
export function parseWatch(metadata: unknown): WatchState | null {
  const raw = rec(rec(metadata).watch);
  if (!Object.keys(raw).length) return null;
  const interval = WATCH_INTERVALS.find((i) => i === raw.interval) ?? "daily";
  return {
    enabled: raw.enabled === true,
    interval,
    last_hash: str(raw.last_hash),
    last_checked_at: str(raw.last_checked_at),
    last_diff: parseDiff(raw.last_diff),
    status: raw.status === WATCH_BLOCKED ? WATCH_BLOCKED : "ok",
    reason: str(raw.reason),
    snapshot: str(raw.snapshot),
    seen_at: str(raw.seen_at),
  };
}

const HOUR = 3_600_000;
/** A little under the interval, so an hourly cron does not drift a day later. */
const INTERVAL_MS: Record<WatchInterval, number> = { daily: 23 * HOUR, weekly: 6 * 24 * HOUR + 23 * HOUR };

/** Is the next check due (never checked, or the interval has passed)? */
export function watchDue(w: WatchState, now: Date): boolean {
  if (!w.enabled) return false;
  if (!w.last_checked_at) return true;
  const last = Date.parse(w.last_checked_at);
  return Number.isNaN(last) || now.getTime() - last >= INTERVAL_MS[w.interval];
}

/** The last change was found after the user last marked it as seen. */
export function hasUnseenChange(w: WatchState | null | undefined): boolean {
  if (!w?.enabled || !w.last_diff) return false;
  return !w.seen_at || Date.parse(w.last_diff.at) > Date.parse(w.seen_at);
}

export interface WatchPatch {
  enabled?: boolean;
  interval?: WatchInterval;
  /** Acknowledge the last change (hides the badge). */
  seen?: boolean;
}

/** `metadata.watch` after a user change. Turning it on resets the check time, so the next cron run picks it up. */
export function applyWatchPatch(prev: WatchState | null, patch: WatchPatch, now: Date): WatchState {
  const next: WatchState = { ...(prev ?? { enabled: false, interval: "daily", status: "ok" }) };
  if (patch.enabled !== undefined) {
    next.enabled = patch.enabled;
    if (patch.enabled) {
      next.status = "ok";
      next.reason = null;
      next.last_checked_at = null;
    }
  }
  if (patch.interval) next.interval = patch.interval;
  if (patch.seen) next.seen_at = now.toISOString();
  return next;
}

// The package builds without DOM/Node libs; WHATWG URL exists in every runtime that imports this.
declare const URL: new (input: string) => { protocol: string };

/** Only http(s) pages with a host can be watched. */
export function isWatchableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
