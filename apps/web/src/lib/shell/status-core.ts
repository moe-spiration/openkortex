import { intlLocale, t, tn } from "@/i18n";
import { reviewDue, reviewDueTooltip, type ReviewDue } from "@kortex/db/daily";
import type { LiveMeeting } from "@/lib/mock/types";

/*
 * Live shell texts (WP-K): AI Gardener line, current meeting card and the review-day badge,
 * shaped from the counts server/settings/status.ts reads. Pure, so it is tested without a DB.
 */

export interface MeetingRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  participants: string[];
  summary: string | null;
  coaching: string | null;
  /** Start of a running live session (desktop HUD writes it, W1); null = no live session. */
  live_started_at?: string | null;
}

/** Meeting card / chip data. `live`: a desktop recording is running right now (W1). */
export type MeetingCardData = LiveMeeting & { processing: boolean; live: boolean; startedAt: string | null };

export interface ShellStatusData {
  /** Captures waiting for the queue / being processed right now. */
  queued: number;
  processing: number;
  /** Items that failed in the last 24 h. */
  errors: number;
  /** Items processed in the last 24 h. */
  processed24h: number;
  lastProcessed: { title: string; at: string } | null;
  /** Newest meeting item of the last 3 hours (the "live" meeting card), else null. */
  meeting: MeetingRow | null;
  fetchedAt: string;
}

export type GardenerTone = "synced" | "busy" | "error";

export interface GardenerView {
  label: string;
  detail: string;
  tone: GardenerTone;
}

function timeOf(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit", timeZone });
}

/** Sidebar line "AI Gardener · …" with a tooltip. */
export function gardenerView(s: ShellStatusData, timeZone?: string): GardenerView {
  const active = s.queued + s.processing;
  const parts: string[] = [];
  if (s.processing) parts.push(t("{n} processing", { n: s.processing }));
  if (s.queued) parts.push(t("{n} in the queue", { n: s.queued }));
  if (s.errors) parts.push(tn(s.errors, "{n} error in 24 h", "{n} errors in 24 h"));
  parts.push(t("{n} processed in 24 h", { n: s.processed24h }));
  if (s.lastProcessed) parts.push(t("last “{title}” {time}", { title: s.lastProcessed.title, time: timeOf(s.lastProcessed.at, timeZone) }).trim());
  const detail = parts.join(" · ");
  if (active) return { label: t("AI Gardener · {n} in progress", { n: active }), detail, tone: "busy" };
  if (s.errors) return { label: tn(s.errors, "AI Gardener · {n} error", "AI Gardener · {n} errors"), detail, tone: "error" };
  return { label: t("AI Gardener · vault in sync"), detail, tone: "synced" };
}

const TONES = ["strategy", "auto", "health", "finance", "food"] as const;

/** Meeting card / footbar chip data from the newest meeting item. */
export function meetingView(m: MeetingRow, timeZone?: string): MeetingCardData {
  const people = m.participants
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((name, i) => ({ name, initial: name.charAt(0).toUpperCase(), ...(i ? { tone: TONES[(i - 1) % TONES.length] } : {}) }));
  return {
    title: m.title,
    clock: timeOf(m.created_at, timeZone),
    people,
    coaching: m.coaching ?? m.summary ?? "",
    noteId: m.id,
    processing: !m.live_started_at && (m.status === "inbox" || m.status === "processing"),
    live: !!m.live_started_at,
    startedAt: m.live_started_at ?? null,
  };
}

/** Column default of kortex.user_settings.weekly_digest_day (Friday); mock and fallbacks use it too. */
export const DEFAULT_WEEKLY_DIGEST_DAY = 5;

export interface ReviewBadge extends ReviewDue {
  /** Tooltip with the due date. */
  tooltip: string;
}

/**
 * Badge of the Wochen-Review row (W6/A-07): the weekday the review is due on, computed in the
 * workspace time zone by `@kortex/db/daily` reviewDue. Null while the settings load or for a
 * missing day, so the badge never shows a guessed "So" before the stored "Fr" arrives.
 */
export function reviewBadge(opts: {
  now: Date;
  timeZone?: string | null;
  digestDay: number | null | undefined;
  loading?: boolean;
}): ReviewBadge | null {
  if (opts.loading) return null;
  const due = reviewDue(opts.now, opts.timeZone, opts.digestDay);
  return due ? { ...due, tooltip: reviewDueTooltip(due) } : null;
}

/** Meeting participants from item metadata (meeting adapter: `participants`; older rows: `speakers`/`attendees`). */
export function participantsOf(metadata: unknown): string[] {
  const m = (metadata ?? {}) as Record<string, unknown>;
  for (const key of ["participants", "speakers", "attendees"]) {
    const v = m[key];
    if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : "")).filter(Boolean);
  }
  return [];
}
