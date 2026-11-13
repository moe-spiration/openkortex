import { memo, useEffect, useRef, type CSSProperties } from "react";
import { bridge } from "@/bridge";
import type { CoachCard } from "@/bridge/contract";
import { DIco, type DIconId } from "@/components/icons";
import { dragWindow } from "@/components/drag";
import { t, tn } from "@/i18n";
import { Wave } from "@/components/Wave";
import { COACH_EYEBROW, transcriberLabel, type LiveLine } from "@/state/meeting";
import { useDesktop } from "@/state/desktop";
import { levelStore } from "@/state/levels";
import { Clock } from "@/state/clock";

/** Absolute placement in the desktop preview; the native HUD window renders at 0,0 instead. */
export const HUD_PLACEMENT: CSSProperties = {
  position: "absolute",
  right: 48,
  top: 150,
  zIndex: 30,
};

/** HUD size (window 400 × 684, src-tauri/src/window.rs). */
export const HUD_W = 400;
export const HUD_H = 684;

const CARD_ICON: Record<CoachCard["kind"], { icon: DIconId; color: string }> = {
  fact: { icon: "shield", color: "var(--status-synced)" },
  question: { icon: "msg", color: "var(--accent-ai)" },
  action: { icon: "task", color: "var(--status-processing)" },
};

/** One transcript line; memoised so the 1 s clock does not re-render the whole transcript. */
const Line = memo(function Line({ l, last }: { l: LiveLine; last: boolean }) {
  if (l.kind === "clip")
    return (
      <div className="kxd-hud-line kxd-hud-line--clip">
        <span className="kxd-hud-ava" aria-hidden>
          <DIco name="clip" sm />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="kxd-hud-who">
            <span>Clip</span>
            <span className="kx-num">{l.ts}</span>
          </div>
          <div className="kxd-hud-text">{l.text}</div>
        </div>
      </div>
    );
  return (
    <div className="kxd-hud-line">
      <span className={"kx-avatar kx-avatar--20" + (l.channel === 1 ? " kx-avatar--strategy" : "")} aria-hidden>
        {l.who.charAt(0)}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="kxd-hud-who">
          <span>{l.who}</span>
          <span className="kx-num">{l.ts}</span>
        </div>
        <div className="kxd-hud-text" style={{ color: last ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {l.text}
        </div>
      </div>
    </div>
  );
});

/** Transcript: fills the free height and always shows the newest lines (no scrollbar). */
function Transcript() {
  const d = useDesktop();
  const m = d.meeting;
  const partial = m.partial.map((text, ch) => (text ? { ch, t: text } : null)).filter(Boolean) as { ch: number; t: string }[];
  if (m.lines.length === 0 && partial.length === 0 && !d.connected && m.session.state === "none")
    return (
      <div className="kxd-hud-transcript" aria-label={t("Transcript")}>
        <ConnectHint text={t("Transcript, coaching and minutes need a connected Kortex account. Until then the recording stays on this PC only.")} />
      </div>
    );
  const empty =
    m.transcript.state === "error"
        ? t("Transcription disturbed: {message}. The recording continues and is transcribed afterwards at the end.", { message: m.transcript.message ?? t("unknown error") })
        : t("Listening. The first lines appear after about 15 seconds of conversation.");
  return (
    <div className="kxd-hud-transcript" aria-live="polite" aria-label={t("Transcript")}>
      {m.lines.length === 0 && partial.length === 0 ? (
        <p className="kxd-hud-empty">{empty}</p>
      ) : (
        <div className="kxd-hud-lines">
          {m.lines.map((l, i) => (
            <Line key={l.id} l={l} last={i === m.lines.length - 1 && partial.length === 0} />
          ))}
          {partial.map((p) => (
            <div key={`p${p.ch}`} className="kxd-hud-line">
              <span className={"kx-avatar kx-avatar--20" + (p.ch === 1 ? " kx-avatar--strategy" : "")} aria-hidden>
                {p.ch === 0 ? "I" : "G"}
              </span>
              <div className="kxd-hud-text" style={{ color: "var(--text-primary)" }}>
                {p.t}
                <span className="kx-caret" />
              </div>
            </div>
          ))}
        </div>
      )}
      {m.transcript.state === "error" && m.lines.length > 0 && (
        <div className="kxd-hud-warn" role="status">
          {t("Transcription disturbed: {message}", { message: m.transcript.message ?? "" })}
        </div>
      )}
    </div>
  );
}

/** No account connected: say so and offer the one-click connect (web app → kortex://connect). */
export function ConnectHint({ text }: { text: string }) {
  const d = useDesktop();
  return (
    <div className="kxd-hud-empty" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, justifyItems: "start" }}>
      <span>{text}</span>
      <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={d.openConnect}>
        <DIco name="link" sm />
        {t("Connect account")}
      </button>
    </div>
  );
}

function Coaching() {
  const d = useDesktop();
  const { cards, coach } = d.meeting;
  const loading = coach.state === "loading";
  return (
    <div style={{ padding: "10px 16px 6px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2, flex: "none" }}>
      <div className="kxh-row" style={{ marginBottom: 4 }}>
        <DIco name="sparkles" sm style={{ color: "var(--accent-ai)" }} />
        <span className="kx-label kxh-grow" style={{ color: "var(--tag-ai-fg)" }}>
          Live-Coaching
        </span>
        <span className="kx-help">{loading ? t("thinking …") : cards.length ? `${tn(cards.length, "{n} prompt", "{n} prompts")}${coach.at ? ` · ${coach.at}` : ""}` : t("none yet")}</span>
        <button
          type="button"
          className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm"
          aria-label={t("Refresh coaching")}
          title={t("Refresh coaching")}
          disabled={loading || d.meeting.session.state !== "live"}
          onClick={d.refreshCoaching}
        >
          <DIco name="sync" sm className={loading ? "kxd-spin" : undefined} />
        </button>
      </div>
      {cards.length === 0 ? (
        <p className="kxd-hud-empty" style={{ padding: "2px 0 6px" }}>
          {d.meeting.session.state === "live"
            ? t("Prompts arrive about every minute once new conversation is transcribed.")
            : t("Coaching needs a live session with a Kortex account.")}
        </p>
      ) : (
        cards.map((c, i) => {
          const ic = CARD_ICON[c.kind];
          const made = d.tasksMade.includes(i);
          return (
            <div key={`${c.kind}-${i}`} className="kxd-hud-tip">
              <span className="kx-icontile" style={{ width: 28, height: 28 }}>
                <DIco name={ic.icon} sm style={{ color: ic.color }} />
              </span>
              <div className="kxd-hud-tipbody">
                <div className="kxd-hud-tiphead">
                  <span className="kx-eyebrow kxh-grow">{t(COACH_EYEBROW[c.kind])}</span>
                  {c.kind === "action" ? (
                    made ? (
                      <span className="kxh-row" style={{ gap: 4, fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--tag-health-fg)" }}>
                        <DIco name="check" sm />
                        {t("Task created")}
                      </span>
                    ) : (
                      <button type="button" className="kxb kx-link kxd-hud-tiplink" onClick={() => d.makeTask(i)}>
                        {t("Create task")}
                      </button>
                    )
                  ) : (
                    <button type="button" className="kxb kx-link kxd-hud-tiplink" onClick={() => d.takeNote(c.text)}>
                      {t("As clip")}
                    </button>
                  )}
                </div>
                <span className="kxd-clamp2" title={c.text}>
                  {c.text}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Live-coaching HUD (Desktop.dc.html "Zustand: Live-Coaching-HUD", Tactile Craft v2): stealth badge,
 * both channel meters from `audio:levels`, the live transcript, up to three coaching cards from the
 * meeting_coach route, the clip field and "end call"; then "protocol in progress" and "saved".
 * Fixed layout of 400 × 684 without scrollbars (H1).
 */
export function Hud({ placement = HUD_PLACEMENT }: { placement?: CSSProperties }) {
  const d = useDesktop();
  const m = d.meeting;
  const input = useRef<HTMLInputElement>(null);
  // Ctrl+Shift+N focuses the clip field.
  useEffect(() => bridge().listen("shortcut:note", () => input.current?.focus()), []);
  // Microphone dB for the self-test probe, straight from the level store (no re-render per level).
  const section = useRef<HTMLElement>(null);
  useEffect(() => levelStore.subscribe((l) => section.current?.setAttribute("data-mic-db", String(Math.round(l.a)))), []);
  const title = m.session.title ?? (d.phase === "idle" ? t("No meeting active") : "Meeting");
  const recording = d.phase === "live";
  return (
    <section
      className="floating-meeting-card tc-float kxd-hud kx-in"
      aria-label="Live Coaching HUD"
      data-phase={d.phase}
      data-mode={d.mode}
      ref={section}
      style={{ ...placement, width: HUD_W, height: HUD_H, borderRadius: "var(--radius-2xl)" }}
    >
      {/* The whole head moves the frameless native window (buttons excepted, components/drag.ts). */}
      <header className="kxd-hud-head" onMouseDown={dragWindow} style={{ cursor: "grab" }} title={t("Drag to move")}>
        <span className="kx-grip" aria-hidden>
          <DIco name="grip" />
        </span>
        {recording && <span className="kx-live-dot" aria-hidden />}
        <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-secondary)", flex: "none" }}>
          {recording ? <>REC <Clock /></> : d.phase === "idle" ? t("Ready") : <Clock />}
        </span>
        <span className="kx-truncate kxh-grow" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", fontWeight: 500 }}>
          {title}
        </span>
        <button type="button" className="kx-wincap" aria-label={t("Minimize to pill")} data-hud-action="pill" onClick={() => d.setMode("pill")}>
          <DIco name="min" />
        </button>
        <button type="button" className="kx-wincap" aria-label={t("Hide HUD")} data-hud-action="off" onClick={() => d.setMode("off")}>
          <DIco name="x" />
        </button>
      </header>

      {recording && !d.connected && (
        <div className="kxd-hud-warn" role="status" style={{ margin: "0 16px" }}>
          {t("Recording is local only: no transcript and no minutes without an account.")}{" "}
          <button type="button" className="kxb kx-link" onClick={d.openConnect}>
            {t("Connect")}
          </button>
        </div>
      )}
      <div className="kxd-hud-stealth">
        <DIco name="shield" sm />
        <span className="kx-truncate">{d.stealth ? t("Invisible in screen sharing") : t("Visible in screen sharing")}</span>
        <span className="kx-mono" style={{ opacity: 0.75, marginLeft: "auto", flex: "none" }}>
          {d.meeting.session.state === "live" ? t("Live sync") : d.meeting.session.state === "offline" ? t("Offline") : d.connected ? t("Account connected") : t("Local")}
        </span>
      </div>

      {d.phase === "idle" && (
        <div className="kxd-hud-center">
          <span className="kx-icontile" style={{ width: 44, height: 44, margin: "0 auto" }}>
            <DIco name="mic" />
          </span>
          <span style={{ fontSize: "calc(14px * var(--kx-fs, 1))", fontWeight: 500 }}>{t("No meeting active")}</span>
          <span className="kx-help">
            {t("Microphone and system audio are recorded separately, transcribed live and saved as minutes in 20_Meetings/ at the end.")}
          </span>
          {!d.connected && (
            <span className="kx-help">
              {t("Connect a Kortex account for transcript and coaching:")}{" "}
              <button
                type="button"
                className="kx-link"
                style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}
                onClick={d.openConnect}
              >
                {t("Connect account")}
              </button>
            </span>
          )}
          <button type="button" className="kx-btn kx-btn--primary" style={{ minHeight: 40, margin: "6px auto 0" }} onClick={d.toggleRecording}>
            <DIco name="rec" />
            {t("Start recording")}
          </button>
          <span className="kx-keys" style={{ margin: "0 auto" }}>
            <span className="kx-kbd">Ctrl</span>
            <span className="kx-kbd">Shift</span>
            <span className="kx-kbd">R</span>
          </span>
        </div>
      )}

      {recording && (
        <>
          {/* V2-05c: the meters shrink inside the 400 px HUD; label and dB stay fixed. */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6, padding: "10px 16px", flex: "none" }}>
            <Wave tone="mic" n={40} h={16} channel={0} showDb label={t("Ch 0  Microphone")} labelW="96px" fill />
            <Wave tone="out" n={40} h={16} channel={1} showDb label="Ch 1  System" labelW="96px" fill />
            {d.devices && (
              <span className="kx-mono kx-truncate" style={{ fontSize: "calc(11px * var(--kx-fs, 1))", color: "var(--text-muted)" }} title={d.devices.sys ? t("Microphone: {mic} · System: {system}", { mic: d.devices.mic, system: d.devices.sys }) : t("Microphone: {mic}", { mic: d.devices.mic })}>
                {d.devices.mic}
                {d.devices.sys ? ` · ${d.devices.sys}` : ""}
              </span>
            )}
          </div>
          {!m.levels.mic && (
            <div className="kxd-hud-warn" role="alert" style={{ margin: "0 16px 8px" }}>
              {t("The microphone “{name}” delivers only silence (muted or the wrong device).", { name: d.devices?.mic ?? t("default device") })}{" "}
              <button type="button" className="kxb kx-link" onClick={() => d.openWin("audio")}>
                {t("Audio setup")}
              </button>
            </div>
          )}
          <hr className="kx-hairline" />
          <div className="kxh-row" style={{ padding: "10px 16px 2px", flex: "none" }}>
            <span className="kx-label kxh-grow">{t("Transcript")}</span>
            <span className="kx-mono kx-truncate" style={{ fontSize: "calc(11px * var(--kx-fs, 1))", color: "var(--text-muted)", maxWidth: 200 }}>
              {transcriberLabel(m.transcript.transcriber)}
            </span>
          </div>
          <Transcript />
          <hr className="kx-hairline" />
          <Coaching />
          <hr className="kx-hairline" />
          <div style={{ padding: "10px 16px 14px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, flex: "none" }}>
            <form
              className="kx-control"
              style={{ height: 38 }}
              onSubmit={(e) => {
                e.preventDefault();
                d.takeNote(d.noteText);
              }}
            >
              <span className="kx-num" style={{ fontSize: "calc(11.5px * var(--kx-fs, 1))", color: "var(--tag-ai-fg)", flex: "none" }}>
                [<Clock />]
              </span>
              <input
                ref={input}
                className="kx-input"
                aria-label={t("Clip with timestamp")}
                placeholder={t("Clip: mark the moment, Enter saves")}
                value={d.noteText}
                maxLength={500}
                onChange={(e) => d.setNoteText(e.target.value)}
                style={{ fontSize: "calc(13px * var(--kx-fs, 1))", minWidth: 0 }}
              />
              <button type="submit" className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm" aria-label={t("Save clip")} title={t("Save clip")}>
                <DIco name="clip" sm />
              </button>
            </form>
            <button type="button" className="kx-btn kx-btn--danger kx-btn--block" style={{ minHeight: 40 }} onClick={d.endCall}>
              <DIco name="stop" />
              {t("End call and generate minutes")}
            </button>
          </div>
        </>
      )}

      {d.phase === "gen" && (
        <div className="kxd-hud-center" role="status">
          <span className="kx-spinner" style={{ margin: "0 auto" }} aria-hidden />
          <span style={{ fontSize: "calc(14px * var(--kx-fs, 1))", fontWeight: 500 }}>{t("Minutes are being created")}</span>
          <span className="kx-help">{t("Transcribing the last sentences and closing the live session, then Kortex summarizes and extracts action items.")}</span>
          <div className="kx-progress kx-progress--processing" style={{ marginTop: 6 }}>
            <i style={{ width: "68%" }} />
          </div>
        </div>
      )}

      {d.phase === "done" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, padding: 16, alignContent: "start", flex: 1, minHeight: 0 }}>
          {m.result?.state === "error" ? (
            <>
              <span className="kxh-row" style={{ gap: 6, fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--status-urgent-text)" }}>
                <DIco name="x" sm />
                {t("Minutes not created")}
              </span>
              <span className="kx-help kxd-clamp3">{m.result.message}</span>
              {m.result.file && (
                <button type="button" className="kx-btn kx-btn--secondary kx-btn--block" style={{ minHeight: 40 }} onClick={d.retryUpload}>
                  <DIco name="sync" />
                  {t("Upload again")}
                </button>
              )}
            </>
          ) : m.result?.state === "done" ? (
            <>
              <span className="kxh-row" style={{ gap: 6, fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--tag-health-fg)" }}>
                <DIco name="check" sm />
                {t("Minutes saved in the vault")}
              </span>
              <div className="kx-filerow">
                <DIco name="file" />
                <span className="kx-truncate" style={{ fontSize: "calc(12.5px * var(--kx-fs, 1))" }}>
                  {title}
                </span>
                <span className="kx-num" style={{ fontSize: "calc(11.5px * var(--kx-fs, 1))", color: "var(--text-muted)" }}>
                  {m.result.segments != null ? tn(m.result.segments, "{n} line", "{n} lines") : ""}
                </span>
              </div>
              <span className="kx-help">{t("Summary, action items and backlinks appear in the entry within a few seconds (20_Meetings/).")}</span>
              <button type="button" className="kx-btn kx-btn--primary kx-btn--block" style={{ minHeight: 40 }} onClick={() => d.openItem(m.result?.itemId ?? null)}>
                <DIco name="max" />
                {t("Open in the Kortex window")}
              </button>
            </>
          ) : (
            <span className="kx-help">{t("Recording saved locally. With a Kortex account it automatically becomes minutes.")}</span>
          )}
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--block" style={{ minHeight: 40 }} onClick={d.restart}>
            {t("Start new recording")}
          </button>
        </div>
      )}
    </section>
  );
}
