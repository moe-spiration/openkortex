"use client";

import { t } from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Sparkles } from "lucide-react";
import type { MeetingCardData } from "@/lib/shell/status-core";
import { useShell } from "@/lib/shell/store";
import { Ico } from "@/components/shell/icons";
import { clipMoment, fmtElapsed, useElapsed, useLiveSession } from "./live-store";

/*
 * Orbit-bar chip of the current meeting (WebApp.dc.html `kx-livechip`, W1 "Chip, Hover"):
 * live dot + running clock; hover or keyboard focus opens a small glass preview after 250 ms
 * (title, last transcript line, newest coaching card, "Clip"); click opens the floating card.
 */

const OPEN_DELAY = 250;
const CLOSE_DELAY = 180;

export function LiveMeetingChip({
  meeting,
  onExpand,
  onHide,
}: {
  meeting: MeetingCardData;
  onExpand: () => void;
  /** "Ausblenden": the chip (and card) go away until a newer meeting comes. */
  onHide: () => void;
}) {
  const session = useLiveSession(meeting.live);
  const elapsed = useElapsed(meeting.live ? (session?.started_at ?? meeting.startedAt) : null);
  const { showToast } = useShell();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const clock = elapsed != null ? fmtElapsed(elapsed) : meeting.clock;
  const last = session?.tail.at(-1);
  const card = session?.cards[0];
  const clip = async () => {
    if (!meeting.live) return;
    const err = await clipMoment(meeting.noteId, "");
    showToast(err ? t("Clip: {error}", { error: err }) : t("Moment marked · {time}", { time: clock }));
  };

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => later(() => setOpen(true), OPEN_DELAY)}
      onMouseLeave={() => later(() => setOpen(false), CLOSE_DELAY)}
      onFocus={() => later(() => setOpen(true), OPEN_DELAY)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) later(() => setOpen(false), CLOSE_DELAY);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="kx-orbit-livechip"
        title={t("{title} · open meeting card", { title: meeting.title })}
        aria-label={meeting.live ? t("Live meeting {title}, open meeting card", { title: meeting.title }) : t("Meeting {title}, open meeting card", { title: meeting.title })}
        aria-expanded={open}
        onClick={() => {
          setOpen(false);
          onExpand();
        }}
      >
        {(meeting.live || meeting.processing) && <span className="kx-live-dot" aria-hidden />}
        <span className="kx-num">{clock}</span>
        <Ico name="chev-u" size={14} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("Preview {title}", { title: meeting.title })}
          className="tc-float kx-in"
          style={{
            position: "absolute",
            right: 0,
            bottom: "calc(100% + 14px)",
            width: 300,
            padding: 12,
            borderRadius: 14,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 8,
            zIndex: 12,
            textAlign: "left",
          }}
        >
          <div className="kxh-row" style={{ gap: 8, minWidth: 0 }}>
            {meeting.live && <span className="kx-live-dot" aria-hidden />}
            <span className="kx-truncate" style={{ flex: 1, fontSize: "calc(13px * var(--kx-fs, 1))", fontWeight: 500 }}>
              {meeting.title}
            </span>
            <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>
              {clock}
            </span>
          </div>
          {last ? (
            <p style={{ margin: 0, fontSize: "calc(12.5px * var(--kx-fs, 1))", lineHeight: 1.45, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              <strong style={{ fontWeight: 600, color: "var(--text-primary)" }}>{last.who}:</strong> {last.text}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: "calc(12.5px * var(--kx-fs, 1))", color: "var(--text-muted)" }}>
              {meeting.live ? t("The transcript starts as soon as someone speaks.") : meeting.coaching || t("Open the minutes for details.")}
            </p>
          )}
          {card && (
            <div className="kxh-row" style={{ gap: 6, alignItems: "flex-start", fontSize: "calc(12.5px * var(--kx-fs, 1))", lineHeight: 1.4 }}>
              <Sparkles aria-hidden className="kx-ico kx-ico--sm" style={{ flex: "none", marginTop: 2, color: "var(--accent-ai)" }} />
              <span style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{card.text}</span>
            </div>
          )}
          <div className="kxh-row" style={{ gap: 6 }}>
            {meeting.live && (
              <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void clip()}>
                <BookmarkPlus aria-hidden className="kx-ico" />
                Clip
              </button>
            )}
            <button
              type="button"
              className="kx-btn kx-btn--ghost kx-btn--sm"
              onClick={() => {
                setOpen(false);
                onExpand();
              }}
            >
              <Ico name="expand" />
              Aufklappen
            </button>
            {!meeting.live && (
              <button
                type="button"
                className="kx-btn kx-btn--ghost kx-btn--sm"
                onClick={() => {
                  setOpen(false);
                  onHide();
                }}
              >
                <Ico name="x" />
                Ausblenden
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
