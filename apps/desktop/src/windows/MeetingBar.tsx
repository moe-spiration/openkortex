import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BookmarkPlus,
  Check,
  ChevronRight,
  EyeOff,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Sparkles,
  SquareCheckBig,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { bridge, isTauri } from "@/bridge";
import { dragWindow } from "@/components/drag";
import { Wave } from "@/components/Wave";
import { t, tn } from "@/i18n";
import { Clock, fmtClock, useClockSec } from "@/state/clock";
import { useDesktop } from "@/state/desktop";
import { levelStore } from "@/state/levels";
import { COACH_TITLE, actionCount, coachObject, nextCard, type LiveLine } from "@/state/meeting";

/*
 * Meeting bar (Ruhe D2, mockup `hud` / runde-2/17-meeting-hud.png): the HUD and the pill are ONE part.
 * Collapsed (HUD mode "pill") it is the 560 × 48 bar: rec dot, time, title, one wave for both channels,
 * "mark moment", coaching, expand and the one red action "Beenden". Expanded ("hud") the panel hangs 8 px
 * below it: live transcript, one coaching card, the chips ("2 Aufgaben erkannt", "Akte Jonas") and
 * "Nur für Dich sichtbar" (the stealth switch). Clip, discard, hide and the web dictation pill live here too,
 * quietly: the clip as a bar button (a note field opens on demand), discard and hide as small icons in the
 * panel head. Natively the window takes exactly the content's height (no transparent area over other apps).
 *
 * Class names the self-test probe reads stay: .kxd-hud (data-phase, data-mode, data-mic-db), .kx-wv,
 * .kxd-hud-line, .kxd-hud-tip and the language-independent data-hud-action of the buttons.
 */

export const BAR_W = 560;

/** Placement in the browser preview: centred at the top below the preview bar; natively the window sits there. */
export const MEETING_BAR_PLACEMENT: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: 70,
  transform: "translateX(-50%)",
  zIndex: 30,
};

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

/** How long the discard question waits before it folds back (no accidental second click later). */
const CONFIRM_MS = 8000;

/** Natively: the window is as tall as the bar (and its panel); measured, not guessed (window.rs). */
function useFitWindow(fit: boolean, el: React.RefObject<HTMLElement | null>) {
  const apply = useCallback(() => {
    const node = el.current;
    if (!node) return;
    const h = Math.ceil(node.getBoundingClientRect().height);
    if (h > 0) void getCurrentWindow().setSize(new LogicalSize(BAR_W, h)).catch(() => undefined);
  }, [el]);
  useLayoutEffect(() => {
    if (!fit || !isTauri() || !el.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el.current);
    // The core sizes the window when it switches the mode (window.rs): measure again right after.
    const off = bridge().listen("hud:mode", () => requestAnimationFrame(apply));
    return () => {
      ro.disconnect();
      off();
    };
  }, [fit, el, apply]);
}

/** Seconds since `start`, ticking once per second while `live` (web dictation clock). */
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

export function MeetingBar({ placement = MEETING_BAR_PLACEMENT, fitWindow = false }: { placement?: CSSProperties; fitWindow?: boolean }) {
  const d = useDesktop();
  const root = useRef<HTMLElement>(null);
  useFitWindow(fitWindow, root);
  const [noteOpen, setNoteOpen] = useState(false);
  const note = useRef<HTMLInputElement>(null);
  // Ctrl+Shift+N: open the panel with the note field.
  useEffect(
    () =>
      bridge().listen("shortcut:note", () => {
        setNoteOpen(true);
        requestAnimationFrame(() => note.current?.focus());
      }),
    [],
  );
  // Microphone dB for the self-test probe, straight from the level store (no re-render per level).
  useEffect(() => levelStore.subscribe((l) => root.current?.setAttribute("data-mic-db", String(Math.round(l.a)))), []);

  const webRec = d.phase !== "live" && d.webRec !== "off";
  const expanded = d.mode === "hud" && !webRec;
  return (
    <section
      ref={root}
      className="kxd-hud kxd-mb"
      aria-label="Live Coaching HUD"
      data-phase={d.phase}
      data-mode={d.mode}
      data-expanded={expanded ? "" : undefined}
      style={{ width: BAR_W, ...placement }}
    >
      {webRec ? <WebRecBar /> : <Bar onMark={() => setNoteOpen(true)} noteRef={note} />}
      {expanded && <Panel noteOpen={noteOpen} setNoteOpen={setNoteOpen} noteRef={note} />}
    </section>
  );
}

/** Round 30 px button of the bar. */
function RoundButton(p: { label: string; action?: string; onClick: () => void; children: React.ReactNode; on?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={"kxd-mb-ibtn" + (p.on ? " is-on" : "")}
      aria-label={p.label}
      title={p.label}
      data-hud-action={p.action}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  );
}

function Bar({ onMark, noteRef }: { onMark: () => void; noteRef: React.RefObject<HTMLInputElement | null> }) {
  const d = useDesktop();
  const m = d.meeting;
  const live = d.phase === "live";
  const expanded = d.mode === "hud";
  const title = m.session.title ?? (d.phase === "idle" ? t("No meeting active") : t("Meeting"));
  return (
    // The bar moves the frameless window (buttons excepted, components/drag.ts).
    <div className="kxd-mb-bar" onMouseDown={dragWindow} title={t("Drag to move")}>
      {live ? (
        <span className="kxd-mb-dot" aria-hidden />
      ) : d.phase === "gen" ? (
        <LoaderCircle {...ICON} className="kxd-mb-state kxd-spin" />
      ) : d.phase === "done" && m.result?.state !== "error" ? (
        <Check {...ICON} className="kxd-mb-state" />
      ) : (
        <span className="kxd-mb-dot is-idle" aria-hidden />
      )}
      <span className="kxd-mb-time kx-num">
        {live ? <Clock /> : d.phase === "gen" ? t("Minutes …") : d.phase === "done" ? (m.result?.state === "error" ? t("Not saved") : t("Saved")) : t("Ready")}
      </span>
      <span className="kxd-mb-title kx-truncate">{title}</span>
      {live && !m.levels.mic && <span className="kxd-mb-warn">{t("Mic muted")}</span>}
      <span className="kxd-mb-wave" aria-hidden>
        {live && <Wave tone="ai" n={22} h={20} channel="both" bare />}
      </span>
      {live && (
        <RoundButton
          label={t("Mark the moment")}
          onClick={() => {
            d.takeNote("");
            onMark();
            if (!expanded) d.setMode("hud");
            requestAnimationFrame(() => noteRef.current?.focus());
          }}
        >
          <BookmarkPlus {...ICON} />
        </RoundButton>
      )}
      {live && (
        <RoundButton
          label={t("Coaching now")}
          disabled={m.session.state !== "live" || m.coach.state === "loading"}
          on={m.coach.state === "loading"}
          onClick={() => {
            d.refreshCoaching();
            if (!expanded) d.setMode("hud");
          }}
        >
          <Sparkles {...ICON} className={m.coach.state === "loading" ? "kxd-pulse" : undefined} />
        </RoundButton>
      )}
      {expanded ? (
        <RoundButton label={t("Collapse to the bar")} action="pill" onClick={() => d.setMode("pill")}>
          <Minimize2 {...ICON} />
        </RoundButton>
      ) : (
        <RoundButton label={t("Show transcript and coaching")} action="hud" onClick={() => d.setMode("hud")}>
          <Maximize2 {...ICON} />
        </RoundButton>
      )}
      <BarAction />
    </div>
  );
}

/** The one action on the right: "Beenden" (red) while recording, else what the phase offers. */
function BarAction() {
  const d = useDesktop();
  const m = d.meeting;
  if (d.phase === "live")
    return (
      <button type="button" className="kxd-mb-end" onClick={d.endCall} title={t("End call and generate minutes")}>
        {t("End")}
      </button>
    );
  if (d.phase === "idle")
    return (
      <button type="button" className="kxd-mb-act" onClick={d.toggleRecording}>
        {t("Start recording")}
      </button>
    );
  if (d.phase === "done" && m.result?.state === "error" && m.result.file)
    return (
      <button type="button" className="kxd-mb-act" onClick={d.retryUpload}>
        {t("Upload again")}
      </button>
    );
  if (d.phase === "done" && m.result?.state === "done")
    return (
      <button type="button" className="kxd-mb-act" onClick={() => d.openItem(m.result?.itemId ?? null)}>
        {t("Open")}
      </button>
    );
  return null;
}

/**
 * The web app's own microphone recording (Orbit-Bar dictation) while the main window is minimized: the same
 * bar with its clock, "Orbit-Leiste nimmt auf" and "Beenden" (the web app stops and saves it).
 */
function WebRecBar() {
  const d = useDesktop();
  const live = d.webRec === "live";
  const sec = useSince(d.webRecStart, live);
  return (
    <div className="kxd-mb-bar" onMouseDown={dragWindow} title={t("Drag to move")} data-webrec={d.webRec}>
      {live ? <span className="kxd-mb-dot" aria-hidden /> : <Check {...ICON} className="kxd-mb-state" />}
      <span className="kxd-mb-time kx-num">{live ? fmtClock(sec) : t("Saved")}</span>
      <span className="kxd-mb-title kx-truncate">{live ? t("Orbit bar is recording") : t("Being transcribed")}</span>
      <span className="kxd-mb-wave" />
      <RoundButton label={t("Open Kortex")} onClick={() => d.setWinst("open")}>
        <Maximize2 {...ICON} />
      </RoundButton>
      {live && (
        <button type="button" className="kxd-mb-end" onClick={d.stopWebRec} title={t("Stop recording")}>
          {t("End")}
        </button>
      )}
    </div>
  );
}

function Panel({ noteOpen, setNoteOpen, noteRef }: { noteOpen: boolean; setNoteOpen: (v: boolean) => void; noteRef: React.RefObject<HTMLInputElement | null> }) {
  const d = useDesktop();
  const live = d.phase === "live";
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirm]);
  useEffect(() => {
    if (!live) setConfirm(false);
  }, [live]);
  return (
    <div className="kxd-mb-panel">
      <div className="kxd-mb-head">
        <span className="kxd-mb-label">{live ? t("Live transcript") : d.phase === "idle" ? t("Meeting") : t("Minutes")}</span>
        <span className="kxh-grow" />
        {live && (
          <button type="button" className="kxd-mb-tbtn" aria-label={t("Discard recording")} title={t("Discard recording")} data-hud-action="ask-discard" onClick={() => setConfirm(true)}>
            <Trash2 {...ICON} size={13} />
          </button>
        )}
        <button type="button" className="kxd-mb-tbtn" aria-label={t("Hide HUD")} title={t("Hide HUD")} data-hud-action="off" onClick={() => d.setMode("off")}>
          <EyeOff {...ICON} size={13} />
        </button>
      </div>
      {live && <LivePanel noteOpen={noteOpen} setNoteOpen={setNoteOpen} noteRef={noteRef} />}
      {d.phase === "idle" && <IdlePanel />}
      {d.phase === "gen" && (
        <p className="kxd-mb-text" role="status">
          {t("Transcribing the last sentences and closing the live session, then Kortex summarizes and extracts action items.")}
        </p>
      )}
      {d.phase === "done" && <DonePanel />}
      {confirm ? <DiscardQuestion onKeep={() => setConfirm(false)} /> : <Footer />}
    </div>
  );
}

/** One transcript line, "Name  text", the speaker muted; memoised so the clock does not re-render it. */
const Line = memo(function Line({ l }: { l: LiveLine }) {
  if (l.kind === "clip")
    return (
      <div className="kxd-hud-line kxd-hud-line--clip">
        <BookmarkPlus {...ICON} size={12} className="kxd-mb-clipicon" />
        <span className="kxd-mb-who kx-num">{l.ts}</span> {l.text}
      </div>
    );
  return (
    <div className="kxd-hud-line">
      <span className="kxd-mb-who">{l.who}</span> {l.text}
    </div>
  );
});

function LivePanel({ noteOpen, setNoteOpen, noteRef }: { noteOpen: boolean; setNoteOpen: (v: boolean) => void; noteRef: React.RefObject<HTMLInputElement | null> }) {
  const d = useDesktop();
  const m = d.meeting;
  const partial = m.partial.map((text, ch) => (text ? { ch, text } : null)).filter((p): p is { ch: number; text: string } => p !== null);
  const empty = m.lines.length === 0 && partial.length === 0;
  return (
    <>
      {!d.connected && (
        <p className="kxd-mb-text kxd-mb-alert" role="status">
          {t("Recording is local only: no transcript and no minutes without an account.")}{" "}
          <button type="button" className="kxd-mb-link" onClick={d.openConnect}>
            {t("Connect")}
          </button>
        </p>
      )}
      {!m.levels.mic && (
        <p className="kxd-mb-text kxd-mb-alert" role="alert">
          {t("The microphone “{name}” delivers only silence (muted or the wrong device).", { name: d.devices?.mic ?? t("default device") })}{" "}
          <button type="button" className="kxd-mb-link" onClick={() => d.openWin("audio")}>
            {t("Audio setup")}
          </button>
        </p>
      )}
      <div className="kxd-mb-transcript" aria-live="polite" aria-label={t("Transcript")}>
        {empty ? (
          <p className="kxd-mb-text">
            {m.transcript.state === "error"
              ? t("Transcription disturbed: {message}. The recording continues and is transcribed afterwards at the end.", { message: m.transcript.message ?? t("unknown error") })
              : d.connected
                ? t("Listening. The first lines appear after about 15 seconds of conversation.")
                : t("Transcript, coaching and minutes need a connected Kortex account. Until then the recording stays on this PC only.")}
          </p>
        ) : (
          <>
            {m.lines.slice(-12).map((l) => (
              <Line key={l.id} l={l} />
            ))}
            {partial.map((p) => (
              <div key={`p${p.ch}`} className="kxd-hud-line is-partial">
                {p.text}
                <span className="kx-caret" />
              </div>
            ))}
          </>
        )}
      </div>
      {m.transcript.state === "error" && !empty && (
        <p className="kxd-mb-text kxd-mb-alert" role="status">
          {t("Transcription disturbed: {message}", { message: m.transcript.message ?? "" })}
        </p>
      )}
      <CoachCard />
      {noteOpen && <NoteField inputRef={noteRef} onDone={() => setNoteOpen(false)} />}
    </>
  );
}

/** One coaching card at a time (the mockup's "Jetzt guter Moment"); more cards behind "1 / 3". */
function CoachCard() {
  const d = useDesktop();
  const { cards, coach, session } = d.meeting;
  const [at, setAt] = useState(0);
  // A new coaching run starts at its first card.
  useEffect(() => setAt(0), [cards]);
  if (!cards.length) {
    if (coach.state === "loading")
      return (
        <div className="kxd-mb-card is-quiet" role="status">
          <Sparkles {...ICON} size={15} className="kxd-mb-cardicon kxd-pulse" />
          <span className="kxd-mb-cardtext">{t("thinking …")}</span>
        </div>
      );
    return null;
  }
  const i = Math.min(at, cards.length - 1);
  const c = cards[i]!;
  const made = d.tasksMade.includes(i);
  return (
    <div className="kxd-hud-tip kxd-mb-card">
      <Sparkles {...ICON} size={15} className="kxd-mb-cardicon" />
      <div className="kxd-mb-cardbody">
        <div className="kxd-mb-cardtitle">{c.title?.trim() || t(COACH_TITLE[c.kind])}</div>
        <div className="kxd-mb-cardtext" title={c.text}>
          {c.text}
        </div>
        <div className="kxd-mb-cardacts">
          {c.kind === "action" ? (
            made ? (
              <span className="kxd-mb-done">
                <Check {...ICON} size={12} />
                {t("Task created")}
              </span>
            ) : (
              <button type="button" className="kxd-mb-link" onClick={() => d.makeTask(i)}>
                {t("Create task")}
              </button>
            )
          ) : (
            <button type="button" className="kxd-mb-link" onClick={() => d.takeNote(c.text)}>
              {t("As clip")}
            </button>
          )}
          {session.state === "live" && (
            <button type="button" className="kxd-mb-link" disabled={coach.state === "loading"} onClick={d.refreshCoaching}>
              {coach.state === "loading" ? t("thinking …") : t("Refresh coaching")}
            </button>
          )}
          {cards.length > 1 && (
            <button type="button" className="kxd-mb-link kxd-mb-pager" aria-label={t("Next prompt")} onClick={() => setAt(nextCard(cards, i))}>
              <span className="kx-num">
                {i + 1} / {cards.length}
              </span>
              <ChevronRight {...ICON} size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Note for the marked moment (bar button or Ctrl+Shift+N); Enter saves, Esc closes. */
function NoteField({ inputRef, onDone }: { inputRef: React.RefObject<HTMLInputElement | null>; onDone: () => void }) {
  const d = useDesktop();
  const sec = useClockSec();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (d.noteText.trim()) d.takeNote(d.noteText);
    onDone();
  };
  return (
    <form className="kxd-mb-note" onSubmit={submit}>
      <span className="kxd-mb-who kx-num">{fmtClock(sec)}</span>
      <input
        ref={inputRef}
        aria-label={t("Clip with timestamp")}
        placeholder={t("Note for this moment, Enter saves")}
        value={d.noteText}
        maxLength={500}
        autoFocus
        onChange={(e) => d.setNoteText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
      />
      <button type="button" className="kxd-mb-tbtn" aria-label={t("Close")} onClick={onDone}>
        <X {...ICON} size={13} />
      </button>
    </form>
  );
}

/** Chips (action items, the object file) and the stealth state, which is also its switch. */
function Footer() {
  const d = useDesktop();
  const cards = d.meeting.cards;
  const actions = actionCount(cards);
  const obj = coachObject(cards);
  return (
    <div className="kxd-mb-foot">
      {d.phase === "live" && actions > 0 && (
        <span className="kxd-mb-chip">
          <SquareCheckBig {...ICON} size={12} />
          {tn(actions, "{n} task detected", "{n} tasks detected")}
        </span>
      )}
      {obj && (
        <button type="button" className="kxd-mb-chip" onClick={() => d.openItem(obj.id)} title={t("Open in the Kortex window")}>
          <UsersRound {...ICON} size={12} />
          {t("File {name}", { name: obj.title.split(" ")[0] ?? obj.title })}
        </button>
      )}
      <span className="kxh-grow" />
      <button
        type="button"
        className="kxd-mb-stealth"
        aria-pressed={d.stealth}
        title={d.stealth ? t("Invisible in screen sharing") : t("Visible in screen sharing")}
        onClick={() => d.setStealth(!d.stealth)}
      >
        {d.stealth ? t("Only visible to you") : t("Visible when sharing")}
      </button>
    </div>
  );
}

function DiscardQuestion({ onKeep }: { onKeep: () => void }) {
  const d = useDesktop();
  return (
    <div className="kxd-mb-confirm" role="alertdialog" aria-label={t("Discard recording?")}>
      <span className="kxd-mb-text">
        <strong>{t("Discard recording?")}</strong>{" "}
        {d.connected ? t("Audio, transcript and the meeting entry are deleted. No minutes are created.") : t("The audio file is deleted. Nothing is saved.")}
      </span>
      <span className="kxd-mb-confirm-row">
        <button type="button" className="kxd-mb-act" data-hud-action="keep" onClick={onKeep} autoFocus>
          {t("Keep recording")}
        </button>
        <button
          type="button"
          className="kxd-mb-danger"
          data-hud-action="discard"
          onClick={() => {
            onKeep();
            d.discardRecording();
          }}
        >
          {t("Discard")}
        </button>
      </span>
    </div>
  );
}

function IdlePanel() {
  const d = useDesktop();
  return (
    <div className="kxd-mb-stack">
      <p className="kxd-mb-text">
        {t("Microphone and system audio are recorded separately, transcribed live and saved as minutes in 20_Meetings/ at the end.")}
      </p>
      {!d.connected && (
        <p className="kxd-mb-text">
          {t("Connect a Kortex account for transcript and coaching:")}{" "}
          <button type="button" className="kxd-mb-link" onClick={d.openConnect}>
            {t("Connect account")}
          </button>
        </p>
      )}
      <p className="kxd-mb-text kxd-mb-keys">
        <kbd className="kx-kbd">Ctrl</kbd>
        <kbd className="kx-kbd">Shift</kbd>
        <kbd className="kx-kbd">R</kbd> {t("Start or stop recording")}
      </p>
    </div>
  );
}

function DonePanel() {
  const d = useDesktop();
  const m = d.meeting;
  const title = m.session.title ?? t("Meeting");
  return (
    <div className="kxd-mb-stack">
      {m.result?.state === "error" ? (
        <p className="kxd-mb-text kxd-mb-alert">
          <strong>{t("Minutes not created")}</strong> {m.result.message}
        </p>
      ) : m.result?.state === "done" ? (
        <p className="kxd-mb-text">
          <strong>{t("Minutes saved in the vault")}</strong>{" "}
          {t("Summary, action items and backlinks appear in the entry within a few seconds (20_Meetings/).")}
          {m.result.segments != null && <span className="kxd-mb-who"> · {title} · {tn(m.result.segments, "{n} line", "{n} lines")}</span>}
        </p>
      ) : (
        <p className="kxd-mb-text">{t("Recording saved locally. With a Kortex account it automatically becomes minutes.")}</p>
      )}
      <span>
        <button type="button" className="kxd-mb-act" onClick={d.restart}>
          {t("Start new recording")}
        </button>
      </span>
    </div>
  );
}
