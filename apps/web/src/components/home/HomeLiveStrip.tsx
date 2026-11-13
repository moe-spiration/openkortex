"use client";

import { t, tx } from "@/i18n";
import { fmtElapsed, useElapsed, useLiveSession } from "@/components/meeting/live-store";
import { MEETING_EXPAND_EVENT } from "@/lib/shell/meeting-card";
import { useShellStatus } from "@/lib/shell/status";
import { PROFILE } from "@/lib/workspace-data";

/**
 * Feinschliff Live `.live`: the slim strip on top of Home while a meeting is really being recorded (the same shell
 * status and live session the floating meeting card uses). Rec dot, "Live", running clock, title · participants and the
 * newest coaching hint; the strip opens the floating card (MEETING_EXPAND_EVENT, AppShell), "Live-Notiz" the note.
 * Nothing renders without a running recording.
 */
export function HomeLiveStrip({ openNote }: { openNote: (id: string) => void }) {
  const meeting = useShellStatus().meeting;
  const live = !!meeting?.live;
  const session = useLiveSession(live);
  const elapsed = useElapsed(live ? (session?.started_at || meeting?.startedAt) : null);
  if (!meeting || !live) return null;
  const me = PROFILE.name.trim().toLowerCase();
  const others = meeting.people.map((p) => p.name).filter((n) => n.trim().toLowerCase() !== me);
  const coaching = session?.cards[0]?.text || meeting.coaching;
  const clock = elapsed != null ? fmtElapsed(elapsed) : meeting.clock;
  return (
    <section className="fs-home-live" aria-label={tx("home", "Live meeting")}>
      <button
        type="button"
        className="fs-home-live-main"
        title={t("Open meeting card")}
        onClick={() => window.dispatchEvent(new Event(MEETING_EXPAND_EVENT))}
      >
        <span className="fs-home-rec" aria-hidden />
        <span className="fs-home-live-l">{t("Live")}</span>
        <span className="e-num fs-home-live-clock">{clock}</span>
        <span className="fs-home-live-t e-clamp1">
          {meeting.title}
          {others.length > 0 && ` · ${others.join(", ")}`}
        </span>
        {coaching && <span className="fs-home-live-c e-clamp1">{t("Coaching: {text}", { text: coaching })}</span>}
      </button>
      <button type="button" className="e-btn fs-home-live-btn" onClick={() => openNote(meeting.noteId)}>
        {t("Live note")}
      </button>
    </section>
  );
}
