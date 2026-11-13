import { useEffect, useState, type CSSProperties } from "react";
import { dragWindow } from "@/components/drag";
import { DIco } from "@/components/icons";
import { Wave } from "@/components/Wave";
import { t, tn } from "@/i18n";
import { useDesktop } from "@/state/desktop";
import { HUD_PLACEMENT } from "./Hud";
import { Clock, fmtClock } from "@/state/clock";

/** 1 × 20 px separator between the pill groups (V2-07c). */
const Divider = () => (
  <span
    aria-hidden
    style={{ flex: "none", width: 1, height: 20, background: "var(--border-subtle)" }}
  />
);

const button: CSSProperties = { height: 36, minHeight: 36, width: 36, minWidth: 36, flex: "none" };

/**
 * Recording pill (Desktop.dc.html "Zustand: Pille" plus the 0.6.0 user request): a small floating,
 * transparent capsule in the stealth HUD window. The core shows it by itself while a recording runs and
 * the main window is minimized or in the tray (window.rs `sync_pill`).
 * Red dot, running time and both channel levels (`audio:levels`); a click there opens Kortex. Then the
 * coaching count (with an account), "Aufklappen" to the full HUD and "Aufnahme beenden" right in the pill.
 * Never wider than its 440 × 64 window (H1: no scrollbars).
 */
export function Pill({ placement = HUD_PLACEMENT }: { placement?: CSSProperties }) {
  const d = useDesktop();
  // A dictation in the main window's Orbit-Bar (no native meeting): its own small pill.
  if (d.phase !== "live" && d.webRec !== "off") return <WebRecPill placement={placement} />;
  return <MeetingPill placement={placement} />;
}

/** Seconds since `start`, ticking once per second while `live`. */
function useSince(start: number, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, start]);
  return Math.max(0, Math.floor((now - start) / 1000));
}

/**
 * Pill for the web app's own microphone recording (0.6.4, device test 0.6.3): the main window is
 * minimized while the Orbit-Bar records. Clock, "Kortex öffnen" and "Aufnahme beenden" (the web app
 * stops and saves it); then "Gespeichert" until the core takes the pill away.
 */
export function WebRecPill({ placement = HUD_PLACEMENT }: { placement?: CSSProperties }) {
  const d = useDesktop();
  const live = d.webRec === "live";
  const sec = useSince(d.webRecStart, live);
  return (
    <div
      className="floating-meeting-card tc-float kxd-pill kx-float-pill kx-in"
      data-webrec={d.webRec}
      onMouseDown={dragWindow}
      title={t("Drag to move")}
      style={{
        cursor: "grab",
        ...placement,
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 48,
        padding: "0 6px 0 8px",
        borderRadius: "var(--radius-pill)",
      }}
    >
      <button type="button" className="kxb kxd-pill-open" aria-label={t("Open Kortex")} title={t("Open Kortex")} onClick={() => d.setWinst("open")}>
        {live && <span className="kx-live-dot" aria-hidden />}
        <span className="kx-num" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", flex: "none" }}>
          {live ? fmtClock(sec) : t("Saved")}
        </span>
      </button>
      <Divider />
      <span className="kx-help" style={{ flex: "none" }}>
        {live ? t("Orbit bar is recording") : t("Being transcribed")}
      </span>
      <span className="kxh-grow" />
      {live && (
        <button
          type="button"
          className="kx-btn kx-btn--danger kx-btn--icon kx-btn--round"
          aria-label={t("Stop recording")}
          title={t("Stop recording")}
          style={{ ...button, color: "var(--crit)" }}
          onClick={d.stopWebRec}
        >
          <DIco name="stop" />
        </button>
      )}
    </div>
  );
}

function MeetingPill({ placement }: { placement: CSSProperties }) {
  const d = useDesktop();
  const recording = d.phase === "live";
  const cards = d.meeting.cards.length;
  return (
    <div
      className="floating-meeting-card tc-float kxd-pill kx-float-pill kx-in"
      onMouseDown={dragWindow}
      title={t("Drag to move")}
      style={{
        cursor: "grab",
        ...placement,
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 48,
        padding: "0 6px 0 8px",
        borderRadius: "var(--radius-pill)",
      }}
    >
      <button
        type="button"
        className="kxb kxd-pill-open"
        aria-label={t("Open Kortex")}
        title={t("Open Kortex")}
        onClick={() => d.setWinst("open")}
      >
        {recording && <span className="kx-live-dot" aria-hidden />}
        <span className="kx-num" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", flex: "none" }}>
          {recording ? <Clock /> : d.phase === "gen" ? t("Minutes …") : d.phase === "done" ? t("Saved") : t("Ready")}
        </span>
        {/* V2-07a: both channels in one 28 px block, centred on the clock. */}
        <span
          aria-hidden
          style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, height: 28, flex: "none" }}
        >
          <Wave tone="mic" n={14} h={12} channel={0} live={recording} bare />
          <Wave tone="out" n={14} h={12} channel={1} live={recording} bare />
        </span>
      </button>
      <Divider />
      {d.connected ? (
        <span className="kxh-row" title={t("Live coaching")} style={{ gap: 6, fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--text-secondary)", flex: "none" }}>
          <DIco name="sparkles" sm style={{ color: "var(--accent-ai)" }} />
          <span className="kx-badge kx-badge--accent" aria-label={tn(cards, "{n} prompt", "{n} prompts")}>
            {cards}
          </span>
        </span>
      ) : (
        <span className="kx-help" title={t("No transcript without an account")} style={{ flex: "none" }}>
          {t("local only")}
        </span>
      )}
      {recording && !d.meeting.levels.mic && (
        <span className="kx-help" title={t("The microphone delivers only silence")} style={{ flex: "none", color: "var(--status-urgent-text)" }}>
          {t("Mic muted")}
        </span>
      )}
      <span className="kxh-grow" />
      <button
        type="button"
        className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--round"
        aria-label={t("Expand HUD")}
        title={t("Expand HUD")}
        data-hud-action="hud"
        style={button}
        onClick={() => d.setMode("hud")}
      >
        <DIco name="expand" />
      </button>
      {recording && (
        <button
          type="button"
          className="kx-btn kx-btn--danger kx-btn--icon kx-btn--round"
          aria-label={t("Stop recording")}
          title={t("Stop recording")}
          style={{ ...button, color: "var(--crit)" }}
          onClick={d.toggleRecording}
        >
          <DIco name="stop" />
        </button>
      )}
    </div>
  );
}
