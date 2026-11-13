"use client";

import { msg, t, tx } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus } from "lucide-react";
import type { MeetingCardData } from "@/lib/shell/status-core";
import { useShell } from "@/lib/shell/store";
import { useShellStatus } from "@/lib/shell/status";
import { noteById } from "@/lib/workspace-data";
import { Ico } from "@/components/shell/icons";
import { Wave } from "@/components/shell/Wave";
import { clipMoment, fmtElapsed, useElapsed, useLiveSession } from "./live-store";

/*
 * Floating meeting card (WebApp.dc.html <section class="floating-meeting-card">).
 * Live (W1): a desktop recording is running → running clock, transcript end (3 lines, no
 * scrollbars), newest coaching card and the "Clip" field (marks a moment for the protocol).
 * Otherwise the newest meeting item of the last 3 hours with its summary, as before (WP-K).
 * The web app records no audio: the channel waves only show in the mock.
 */

const COACH_LABEL = { fact: msg("Fact check"), question: msg("Follow-up question"), action: msg("Action item") } as const;

export function MeetingCard({
  meeting: m,
  onMinimize,
  onHide,
}: {
  meeting: MeetingCardData;
  onMinimize: () => void;
  onHide: () => void;
}) {
  const { openNote, showToast } = useShell();
  const { live: liveData } = useShellStatus();
  const router = useRouter();
  const session = useLiveSession(m.live);
  const elapsed = useElapsed(m.live ? (session?.started_at ?? m.startedAt) : null);
  const [clipText, setClipText] = useState("");
  const [clipping, setClipping] = useState(false);
  const open = () => (noteById(m.noteId) || !liveData ? openNote(m.noteId) : router.push(`/notes/${m.noteId}`));
  const clock = elapsed != null ? fmtElapsed(elapsed) : m.clock;
  const tail = session?.tail.slice(-3) ?? [];
  const card = session?.cards[0];

  const clip = async () => {
    if (clipping) return;
    setClipping(true);
    const err = await clipMoment(m.noteId, clipText);
    setClipping(false);
    if (err) showToast(t("Clip: {error}", { error: err }));
    else {
      showToast(clipText.trim() ? t("Clip saved · {time}", { time: clock }) : t("Moment marked · {time}", { time: clock }));
      setClipText("");
    }
  };

  const status = !liveData ? t("Live") : m.live ? t("Live") : m.processing ? tx("meeting", "In progress") : t("Meeting");
  return (
    <section
      className="floating-meeting-card tc-float kx-in"
      aria-label={m.live ? t("Live meeting") : t("Meeting")}
      style={{ position: "absolute", right: 20, bottom: 86, width: 352, zIndex: 7, padding: 14, borderRadius: 16, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}
    >
      <div className="kxh-row" style={{ minWidth: 0 }}>
        {(!liveData || m.live || m.processing) && <span className="kx-live-dot" aria-hidden />}
        <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))", fontWeight: 500 }}>{status}</span>
        <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>
          {clock}
        </span>
        <span className="kx-truncate" style={{ flex: 1, fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>
          {m.title}
        </span>
        <button type="button" className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm" aria-label={t("Minimize meeting card")} onClick={onMinimize}>
          <Ico name="minimize" />
        </button>
        <button type="button" className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm" aria-label={t("Close meeting card")} onClick={onHide}>
          <Ico name="x" />
        </button>
      </div>
      {m.people.length > 0 && (
        <div className="kxh-wrap">
          {m.people.map((p) => (
            <span key={p.name} className="kx-propchip" style={{ paddingLeft: 4 }}>
              <span className={"kx-avatar kx-avatar--20" + (p.tone ? ` kx-avatar--${p.tone}` : "")}>{p.initial}</span>
              {p.name}
            </span>
          ))}
        </div>
      )}
      {!liveData && (
        <div style={{ display: "grid", gap: 8 }}>
          <Wave tone="mic" n={40} h={20} label="Ch 0  Mic" labelW="84px" meta="-14 dB" />
          <Wave tone="out" n={40} h={20} level={0.75} label="Ch 1  WASAPI" labelW="84px" meta="-19 dB" />
        </div>
      )}
      {m.live && (
        <div aria-live="polite" style={{ display: "grid", gap: 6, minWidth: 0 }}>
          {tail.length === 0 ? (
            <span style={{ fontSize: "calc(12.5px * var(--kx-fs, 1))", color: "var(--text-muted)" }}>{t("The transcript starts as soon as someone speaks.")}</span>
          ) : (
            tail.map((l, i) => (
              <div key={`${l.sec}-${l.channel}-${i}`} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, fontSize: "calc(12.5px * var(--kx-fs, 1))", lineHeight: 1.4 }}>
                <span className="kx-num" style={{ fontSize: "calc(11px * var(--kx-fs, 1))", color: "var(--text-muted)", paddingTop: 1 }}>
                  {l.ts.replace(/^00:/, "")}
                </span>
                <span style={{ color: i === tail.length - 1 ? "var(--text-primary)" : "var(--text-secondary)", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  <strong style={{ fontWeight: 600 }}>{l.who}:</strong> {l.text}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      {(card || m.coaching || m.processing) && (
        <div style={{ display: "grid", gap: 4, paddingTop: 10, boxShadow: "inset 0 1px 0 0 var(--border-subtle)", fontSize: "calc(13px * var(--kx-fs, 1))", lineHeight: 1.4 }}>
          <div className="kxh-row" style={{ gap: 6, fontSize: "calc(12px * var(--kx-fs, 1))", fontWeight: 500, color: "var(--text-secondary)" }}>
            <Ico name="sparkles" size="sm" />
            {card ? t("Live coaching · {kind}", { kind: t(COACH_LABEL[card.kind]) }) : !liveData ? t("Live coaching") : m.processing ? t("Minutes") : t("Summary")}
          </div>
          <span style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {card?.text || m.coaching || t("The transcript is being processed: summary and action items will follow.")}
          </span>
        </div>
      )}
      {m.live && (
        <form
          className="kx-control"
          style={{ height: 36 }}
          onSubmit={(e) => {
            e.preventDefault();
            void clip();
          }}
        >
          <span className="kx-num" style={{ fontSize: "calc(11.5px * var(--kx-fs, 1))", color: "var(--tag-ai-fg)" }}>
            [{clock}]
          </span>
          <input
            className="kx-input"
            aria-label={t("Mark moment")}
            placeholder={t("Mark moment, Enter saves")}
            value={clipText}
            maxLength={500}
            onChange={(e) => setClipText(e.target.value)}
            style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}
          />
          <button type="submit" className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm" aria-label={t("Save clip")} title={t("Save clip")} disabled={clipping}>
            <BookmarkPlus aria-hidden className="kx-ico" />
          </button>
        </form>
      )}
      <div className="kxh-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={open}>
          <Ico name="panel" />
          {m.live ? t("Open live note") : t("Open minutes")}
        </button>
        <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={() => showToast(m.live ? t("The live HUD runs in the Windows desktop app (Ctrl+Shift+H)") : t("Live HUD starts in the Windows desktop app"))}>
          <Ico name="sparkles" />
          Live HUD
        </button>
      </div>
    </section>
  );
}
