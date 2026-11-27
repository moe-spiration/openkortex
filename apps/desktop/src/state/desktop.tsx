import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bridge, type AskAnswer, type DevicesInUse, type HudMode } from "@/bridge";
import { QC_ACTIONS, QC_ASK, QC_TARGETS, type NativeWin } from "@/data";
import { msg, t } from "@/i18n";
import { clockStore, fmtClock } from "./clock";
import { levelStore } from "./levels";
import { initialMeeting, meetingReducer, type MeetingLive } from "./meeting";

/*
 * Client state of the desktop app (Desktop.dc.html's component state). The meeting (clock, levels,
 * transcript, coaching, session, upload) comes only from bridge events: the Rust core natively,
 * the mock bridge in the browser preview. Everything else is UI state. In the native app every
 * window runs its own provider; cross-window changes travel as events.
 */

/** idle = no recording; live = recording; gen = ending (last chunks, protocol queued); done. */
export type Phase = "idle" | "live" | "gen" | "done";
export type WinState = "open" | "min";

/**
 * Phase after `meeting:state` (audit D-09): a recording stopped elsewhere (tray, hotkey, auto-stop)
 * waits for a result only when one follows (`uploading`), else it is done right away.
 */
export function phaseAfterState(p: Phase, recording: boolean, uploading?: boolean, discarded?: boolean): Phase {
  if (recording) return "live";
  // Thrown away: nothing follows, the HUD is ready for the next recording.
  if (discarded) return "idle";
  if (p !== "live" && p !== "gen") return p;
  if (uploading === false) return "done";
  return p === "live" ? "gen" : p;
}

export { fmtClock };

interface QcState {
  text: string;
  sel: number;
  answer: AskAnswer | null;
  asking: boolean;
  error: string | null;
  rec: boolean;
  sec: number;
}
const QC_EMPTY: QcState = { text: "", sel: 0, answer: null, asking: false, error: null, rec: false, sec: 0 };

export interface DesktopState {
  mode: HudMode;
  winst: WinState;
  phase: Phase;
  meeting: MeetingLive;
  /** Account connected (live transcript and coaching need it). */
  connected: boolean;
  /** Indexes of coaching cards turned into tasks. */
  tasksMade: number[];
  noteText: string;
  qcText: string;
  qcSel: number;
  /** Launcher "Fragen": the answer, while it loads, or why it failed. */
  qcAnswer: AskAnswer | null;
  qcAsking: boolean;
  qcError: string | null;
  qcRec: boolean;
  qcSec: number;
  toast: string;
  tray: boolean;
  win: NativeWin | null;
  mic: number;
  out: number;
  mics: string[];
  outs: string[];
  testing: boolean;
  /** HUD and overlays hidden from screen capture (Rust is authoritative, all windows follow). */
  stealth: boolean;
  /** "Mit Windows starten"; null until the core answered. */
  autostart: boolean | null;
  /** Devices of the running (or last) recording; the microphone may differ from the Windows default. */
  devices: DevicesInUse | null;
  /** What "Windows-Standardgerät" is right now (Audio-Setup). */
  defaultInput: string | null;
  defaultOutput: string | null;
  /** Self-test running (Audio-Setup button). */
  selftesting: boolean;
  /**
   * The web app's own microphone recording in the main window (Orbit-Bar dictation): live, just
   * saved, or none. The pill stands for it while the main window is minimized.
   */
  webRec: "off" | "live" | "saved";
  /** Date.now() when the web recording started (pill clock). */
  webRecStart: number;
}

export interface DesktopActions {
  setMode: (m: HudMode) => void;
  setWinst: (w: WinState) => void;
  minimize: () => void;
  say: (m: string) => void;
  setNoteText: (t: string) => void;
  /** Clip: marks a moment (with optional text) in the live session. */
  takeNote: (t: string) => void;
  makeTask: (cardIndex: number) => void;
  refreshCoaching: () => void;
  openItem: (itemId: string | null) => void;
  retryUpload: () => void;
  endCall: () => void;
  /** Throws the running recording away (after the HUD's confirmation): no file, no minutes. */
  discardRecording: () => void;
  restart: () => void;
  toggleRecording: () => void;
  /** Pill stop during a web recording: the web app stops and saves it. */
  stopWebRec: () => void;
  setQcText: (t: string) => void;
  setQcSel: (i: number) => void;
  /**
   * 0..3 capture as note / inbox / task / scratchpad (QC_TARGETS; `title` e.g. for a selection), QC_ASK asks.
   * Natively the launcher closes once the capture is saved; the promise rejects when it was not.
   */
  runQc: (i: number, opts?: { title?: string }) => Promise<void>;
  /** Resets the launcher (new Alt+Space): empty field, first action, no answer. */
  resetQc: () => void;
  /** Esc: hides the launcher (natively it gives the focus back to the previous app). */
  closeLauncher: () => void;
  qcOrb: () => void;
  startVoiceNote: () => void;
  toggleTray: (open?: boolean) => void;
  openWin: (w: NativeWin) => void;
  closeWin: () => void;
  setStealth: (on: boolean) => void;
  /** "Konto verbinden": Einstellungen → Connectors of the web app in the main window (deep link back). */
  openConnect: () => void;
  setAutostart: (on: boolean) => void;
  nextMic: () => void;
  nextOut: () => void;
  testRec: () => void;
  /** Self-test of the whole meeting chain (test signal, local stub API; `online` = real web app). */
  runSelftest: (online?: boolean) => void;
}

const Ctx = createContext<(DesktopState & DesktopActions) | null>(null);

/** First entry of both device lists: Rust picks the Windows default device. English source, shown with `t(DEFAULT_DEVICE)`. */
export const DEFAULT_DEVICE = msg("Windows default device");

interface DeviceState {
  mic: number;
  out: number;
  mics: string[];
  outs: string[];
}

/**
 * Device lists from list_audio_devices with the remembered choice selected. Index 0 is always the
 * system default (what Rust uses without a choice); a remembered device that is unplugged now is
 * kept in the list so the choice stays visible.
 */
export function devicesFrom(
  s: DeviceState,
  d: { inputs: string[]; outputs: string[]; input?: string | null; output?: string | null },
): DeviceState {
  const list = (names: string[], chosen?: string | null) => {
    const all = [DEFAULT_DEVICE, ...names.filter((n) => n !== DEFAULT_DEVICE)];
    if (chosen && !all.includes(chosen)) all.push(chosen);
    return { all, index: chosen ? all.indexOf(chosen) : 0 };
  };
  const mics = list(d.inputs, d.input);
  const outs = list(d.outputs, d.output);
  return { ...s, mics: mics.all, mic: mics.index, outs: outs.all, out: outs.index };
}

/** Entry 0 is the Windows default: name the device behind it. */
export function deviceLabel(name: string | undefined, index: number, current: string | null): string {
  if (index !== 0 || !current) return name ?? "";
  return `${name ?? ""}: ${current}`;
}

export function DesktopProvider({
  children,
  initialMode = "hud",
}: {
  children: ReactNode;
  initialMode?: HudMode;
}) {
  const b = bridge();
  /** This provider runs in the launcher (capture) window. */
  const isLauncher = initialMode === "qc";
  const [mode, setModeRaw] = useState<HudMode>(initialMode);
  const [winst, setWinst] = useState<WinState>("open");
  const [phase, setPhase] = useState<Phase>("idle");
  const [meeting, dispatch] = useReducer(meetingReducer, undefined, initialMeeting);
  const [connected, setConnected] = useState(false);
  const [tasksMade, setTasksMade] = useState<number[]>([]);
  const [noteText, setNoteText] = useState("");
  const [qc, setQc] = useState<QcState>(QC_EMPTY);
  const [toast, setToast] = useState("");
  const [tray, setTray] = useState(false);
  const [win, setWin] = useState<NativeWin | null>(null);
  const [stealth, setStealthRaw] = useState(true);
  const [autostart, setAutostartRaw] = useState<boolean | null>(null);
  const [dev, setDev] = useState<DeviceState>({ mic: 0, out: 0, mics: [DEFAULT_DEVICE], outs: [DEFAULT_DEVICE] });
  const [testing, setTesting] = useState(false);
  const [devices, setDevices] = useState<DevicesInUse | null>(null);
  const [defaults, setDefaults] = useState<{ input: string | null; output: string | null }>({ input: null, output: null });
  const [selftesting, setSelftesting] = useState(false);
  const [webRec, setWebRec] = useState<{ state: DesktopState["webRec"]; start: number }>({ state: "off", start: 0 });
  /** The running recording is the self-test: no "Protokoll im Vault" toast for it. */
  const selftestRef = useRef(false);
  /** The microphone flag React currently shows (the reducer resets it with a new meeting). */
  const micShown = useRef(true);
  useEffect(() => {
    micShown.current = meeting.levels.mic;
  }, [meeting.levels.mic]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qcRecRef = useRef(false);
  qcRecRef.current = qc.rec;
  /** Latest actions, for event listeners registered once. */
  const actionsRef = useRef<DesktopActions | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  /** Audio-Setup: the next recording uses it, desktop.json remembers it ("" = Windows default). */
  const selectDevice = (kind: "input" | "output", name: string) => {
    b.invoke("select_audio_device", { kind, name }).then(
      () => say(phase === "live" ? t("Applies from the next recording") : t("Device saved")),
      (e: unknown) => say(t("Device: {error}", { error: String(e) })),
    );
  };

  useEffect(() => {
    // A window opened mid-meeting catches up with the core's state.
    void b.invoke("get_meeting_state").then((st) => {
      setConnected(!!st.connected);
      if (typeof st.stealth === "boolean") setStealthRaw(st.stealth);
      clockStore.set(st.elapsed);
      setPhase((p) => (st.recording ? "live" : p));
      if (st.devices) setDevices(st.devices);
      if (st.item_id || st.title)
        dispatch({ type: "session", p: { state: st.item_id ? "live" : "connecting", item_id: st.item_id, title: st.title, transcriber: st.transcriber } });
    });
    const off = [
      // Only the clock components re-render per tick (state/clock.ts).
      b.listen("meeting:tick", ({ elapsed }) => clockStore.set(elapsed)),
      // ~30 Hz: meters read the level store (state/levels.ts); React only hears of the dead-microphone flag.
      b.listen("audio:levels", ({ ch0, ch1, mic_signal }) => {
        const mic = mic_signal ?? true;
        levelStore.set({ a: ch0.db, b: ch1.db, mic });
        if (mic !== micShown.current) {
          micShown.current = mic;
          dispatch({ type: "levels", a: ch0.db, b: ch1.db, mic });
        }
      }),
      b.listen("meeting:devices", (dv) => {
        setDevices(dv);
        // The core names the synthetic source in its language: accept both.
        selftestRef.current = dv.mic.startsWith("Selbsttest") || dv.mic.startsWith("Self-test");
        if (dv.note) say(dv.note);
      }),
      // What the HUD really renders, for the self-test (only the window that shows the HUD answers).
      // Only the window showing the HUD or the pill presses its own button.
      // The button is found by its language-independent `data-hud-action` (older cores: by aria-label).
      b.listen("selftest:click", ({ label, action }) => {
        if (!document.querySelector(".kxd-hud, .kxd-pill")) return;
        const btn =
          (action ? document.querySelector<HTMLButtonElement>(`button[data-hud-action="${action}"]`) : null) ??
          Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-label]")).find(
            (el) => el.getAttribute("aria-label") === label,
          );
        btn?.click();
      }),
      b.listen("selftest:probe", () => {
        const hud = document.querySelector(".kxd-hud");
        if (!hud) return;
        const phase = hud.getAttribute("data-phase") ?? "";
        b.emit("selftest:hud", {
          phase,
          meters: hud.querySelectorAll(".kx-wv").length,
          lines: hud.querySelectorAll(".kxd-hud-line:not(.kxd-hud-line--clip)").length,
          cards: hud.querySelectorAll(".kxd-hud-tip").length,
          mic_db: Number(hud.getAttribute("data-mic-db") ?? -60),
          mode: hud.getAttribute("data-mode") ?? "",
        });
      }),
      b.listen("selftest:done", ({ summary }) => {
        selftestRef.current = false;
        setSelftesting(false);
        // Back to "ready": the self-test left no meeting behind.
        setPhase((p) => (p === "live" ? p : "idle"));
        dispatch({ type: "reset" });
        say(summary);
      }),
      // "qc" belongs to the launcher window only (audit D-03).
      b.listen("hud:mode", ({ mode: m }) => {
        if (m !== "qc" || !b.native || isLauncher) setModeRaw(m);
      }),
      b.listen("webrec:state", ({ recording }) =>
        setWebRec((w) => (recording ? { state: "live", start: Date.now() } : { ...w, state: w.state === "live" ? "saved" : "off" })),
      ),
      b.listen("settings:stealth", ({ enabled }) => setStealthRaw(enabled)),
      b.listen("account:changed", ({ connected: c }) => setConnected(c)),
      // Recording started / stopped from another window (tray, hotkey) in the native app.
      b.listen("meeting:state", ({ recording, elapsed, uploading, discarded }) => {
        if (recording || discarded) {
          dispatch({ type: "reset" });
          setTasksMade([]);
        }
        setPhase((p) => phaseAfterState(p, recording, uploading, discarded));
        clockStore.set(elapsed);
      }),
      b.listen("transcript:final", (p) => dispatch({ type: "final", p })),
      b.listen("transcript:partial", (p) => dispatch({ type: "partial", p })),
      b.listen("transcript:status", (p) => dispatch({ type: "transcript", p })),
      b.listen("meeting:live", (p) => {
        dispatch({ type: "session", p });
        // A live session exists only with a connected account (or the self-test's stub).
        if (p.state === "live") setConnected(true);
      }),
      b.listen("coaching:cards", (p) => dispatch({ type: "cards", p })),
      b.listen("coaching:status", (p) => {
        dispatch({ type: "coach", p });
        if (p.state === "error" && p.message) say(`Coaching: ${p.message}`);
      }),
      // Natively Rust toggles the recording itself and every window follows via meeting:state.
      b.listen("shortcut:record", () => {
        if (!b.native) actionsRef.current?.toggleRecording();
      }),
      b.listen("meeting:upload", (u) => {
        dispatch({ type: "upload", p: u });
        if (u.state === "done") {
          setPhase("done");
          if (!selftestRef.current) say(t("Minutes are being created in the vault"));
        } else if (u.state === "error") {
          setPhase("done");
          say(u.message ? t("Upload failed: {message}", { message: u.message }) : t("Upload failed"));
        }
      }),
      // The voice note lives in the launcher window (tray and hotkey only ask for it, audit D-05);
      // pressed again while it records, it stops and saves.
      b.listen("shortcut:voice-note", () => {
        if (b.native && !isLauncher) return;
        if (qcRecRef.current) actionsRef.current?.qcOrb();
        else actionsRef.current?.startVoiceNote();
      }),
      // Forgotten recording stopped by the core (10 min silence or 4 h); meeting:state follows.
      b.listen("meeting:autostop", ({ message }) => say(message)),
      b.listen("voice:upload", (u) => {
        if (u.state === "done") say(t("Voice note in the Inbox"));
        else if (u.state === "error")
          say(u.message ? t("Voice note not uploaded: {message}", { message: u.message }) : t("Voice note not uploaded"));
      }),
    ];
    void b.invoke("list_audio_devices").then((d) => {
      setDev((s) => devicesFrom(s, d));
      setDefaults({ input: d.default_input ?? null, output: d.default_output ?? null });
    });
    void b.invoke("get_autostart").then(setAutostartRaw, () => setAutostartRaw(null));
    return () => off.forEach((f) => f());
  }, [b, say, isLauncher]);

  // Voice-note clock of the quick-capture orb (prototype shares the 1 s interval).
  useEffect(() => {
    if (!qc.rec) return;
    const timer = setInterval(() => setQc((s) => ({ ...s, sec: s.sec + 1 })), 1000);
    return () => clearInterval(timer);
  }, [qc.rec]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const setMode = useCallback(
    (v: HudMode) => {
      setTray(false);
      // Natively "qc" opens the launcher window; the window asking keeps its own view (D-03).
      if (v === "qc" && b.native && !isLauncher) {
        void b.invoke("set_hud_mode", { mode: v });
        return;
      }
      setModeRaw(v);
      setQc((s) => (v === "qc" ? { ...QC_EMPTY, sec: s.sec } : { ...s, rec: false }));
      if (b.native) void b.invoke("set_hud_mode", { mode: v });
    },
    [b, isLauncher],
  );

  const live = phase === "live";

  const start = () => {
    dispatch({ type: "reset" });
    setTasksMade([]);
    setPhase("live");
    clockStore.set(0);
    return b.invoke("start_recording");
  };
  const stop = (msgUploading: string, msgLocal: string) => {
    setPhase("gen");
    b.invoke("stop_recording").then(
      (r) => {
        // With a session or upload the result arrives as meeting:upload; else it is local only.
        if (!r.uploading) setPhase("done");
        say(r.uploading ? msgUploading : msgLocal);
      },
      (e: unknown) => {
        setPhase("done");
        say(t("Recording: {error}", { error: String(e) }));
      },
    );
  };

  const actions: DesktopActions = {
    setMode,
    setWinst: (w) => {
      setWinst(w);
      if (w === "open" && b.native) void b.invoke("show_main");
    },
    minimize: () => {
      setWinst("min");
      if (mode !== "hud" && mode !== "off") setMode("pill");
    },
    say,
    setNoteText,
    takeNote: (raw) => {
      const v = raw.trim();
      const clock = fmtClock(clockStore.get());
      dispatch({ type: "clip", ts: clock, text: v });
      setNoteText("");
      b.invoke("meeting_clip", { text: v }).then(
        () => say(v ? t("Clip saved · {clock}", { clock }) : t("Moment marked · {clock}", { clock })),
        (e: unknown) => say(t("Clip only in the HUD: {error}", { error: String(e) })),
      );
    },
    makeTask: (i) => {
      const card = meeting.cards[i];
      if (!card || tasksMade.includes(i)) return;
      b.invoke("meeting_task", { title: card.text }).then(
        () => {
          setTasksMade((made) => [...made, i]);
          say(t("Task created"));
        },
        (e: unknown) => say(`Task: ${String(e)}`),
      );
    },
    refreshCoaching: () => {
      b.invoke("refresh_coaching").catch((e: unknown) => say(`Coaching: ${String(e)}`));
    },
    openItem: (itemId) => {
      if (!itemId) return say(t("No entry in the vault yet"));
      b.invoke("open_in_main", { itemId }).catch((e: unknown) => say(String(e)));
    },
    retryUpload: () => {
      const file = meeting.result?.file;
      if (!file) return;
      setPhase("gen");
      b.invoke("upload_recording", { file }).catch((e: unknown) => {
        setPhase("done");
        say(String(e));
      });
    },
    endCall: () => stop(t("Recording saved, minutes are being created"), t("Recording saved locally")),
    discardRecording: () => {
      b.invoke("discard_recording").then(
        () => {
          dispatch({ type: "reset" });
          setTasksMade([]);
          setPhase("idle");
          clockStore.set(0);
          say(t("Recording discarded"));
        },
        (e: unknown) => say(t("Recording: {error}", { error: String(e) })),
      );
    },
    restart: () => {
      start().catch((e: unknown) => {
        setPhase("idle");
        say(t("Recording not possible: {error}", { error: String(e) }));
      });
    },
    toggleRecording: () => {
      setTray(false);
      if (live) stop(t("Recording stopped, minutes are being created"), t("Recording stopped, saved locally"));
      else
        start().then(
          () => say(t("Recording started")),
          (e: unknown) => {
            setPhase("idle");
            say(t("Recording not possible: {error}", { error: String(e) }));
          },
        );
    },
    stopWebRec: () => {
      b.invoke("stop_web_recording").catch((e: unknown) => say(t("Recording: {error}", { error: String(e) })));
    },
    setQcText: (text) => setQc((s) => ({ ...s, text, answer: null, error: null })),
    setQcSel: (i) => setQc((s) => ({ ...s, sel: i })),
    runQc: (i, opts) => {
      const text = qc.text.trim();
      if (i === QC_ASK) {
        setQc((s) => ({ ...s, sel: QC_ASK, answer: null, error: null, asking: !!text }));
        if (!text) return Promise.resolve();
        b.invoke("launcher_ask", { question: text }).then(
          (answer) => setQc((s) => (s.text.trim() === text ? { ...s, answer, asking: false } : s)),
          (e: unknown) => setQc((s) => ({ ...s, asking: false, error: String(e) })),
        );
        return Promise.resolve();
      }
      const target = QC_TARGETS[i];
      if (!target) return Promise.resolve();
      const args = { text, target, ...(opts?.title ? { title: opts.title } : {}) };
      if (b.native) {
        if (!text) return Promise.resolve();
        // The launcher stays open until the capture is saved, so a failure is visible right there
        // (QuickCapture shows the rejection); on success it closes and hands the focus back.
        return b.invoke("quick_capture", args).then(() => {
          setQc((s) => ({ ...QC_EMPTY, sec: s.sec }));
          void b.invoke("close_launcher");
        });
      }
      if (text) b.invoke("quick_capture", args).catch((e: unknown) => say(t("Not saved: {error}", { error: String(e) })));
      setMode("hud");
      say(QC_ACTIONS[i]!.done);
      return Promise.resolve();
    },
    resetQc: () => setQc((s) => ({ ...QC_EMPTY, sec: s.sec })),
    closeLauncher: () => {
      // Esc during a voice note: save it instead of leaving the microphone running (audit D-05).
      if (qcRecRef.current) {
        actionsRef.current?.qcOrb();
        return;
      }
      if (b.native) {
        setQc((s) => ({ ...QC_EMPTY, sec: s.sec }));
        void b.invoke("close_launcher");
      } else setMode("off");
    },
    qcOrb: () => {
      if (qcRecRef.current) {
        const s = Math.max(1, qc.sec);
        setQc((x) => ({ ...x, rec: false }));
        const len = "(0:" + String(s).padStart(2, "0") + ")";
        // Only the launcher closes: a running meeting HUD stays (audit D-04).
        if (b.native) {
          setQc((x) => ({ ...QC_EMPTY, sec: x.sec }));
          void b.invoke("close_launcher");
        } else setMode("off");
        b.invoke("stop_voice_note").then(
          (r) =>
            say(
              r.uploading
                ? t("Voice note {length} is being transcribed", { length: len })
                : t("Voice note {length} saved locally, connect an account for the Inbox", { length: len }),
            ),
          (e: unknown) => say(t("Voice note not saved: {error}", { error: String(e) })),
        );
      } else {
        setQc((x) => ({ ...x, rec: true, sec: 0 }));
        void b.invoke("start_voice_note");
      }
    },
    startVoiceNote: () => {
      // Tray (another window): open the launcher and let it record there (audit D-05).
      if (b.native && !isLauncher) {
        setTray(false);
        void b.invoke("set_hud_mode", { mode: "qc" }).then(() => b.emit("shortcut:voice-note", {}));
        return;
      }
      setMode("qc");
      setQc((x) => ({ ...x, rec: true, sec: 0 }));
      void b.invoke("start_voice_note");
    },
    toggleTray: (open) => setTray((shown) => open ?? !shown),
    openWin: (w) => {
      setTray(false);
      // Natively each of these is its own Tauri window (created on demand by the core).
      if (b.native) {
        b.invoke("open_window", { label: w }).catch((e: unknown) => say(String(e)));
        return;
      }
      setWin((cur) => (cur === w ? null : w));
    },
    closeWin: () => {
      if (b.native) b.hideWindow();
      else setWin(null);
    },
    openConnect: () => {
      setTray(false);
      b.invoke("open_connect").catch((e: unknown) => say(t("Connect: {error}", { error: String(e) })));
    },
    setStealth: (on) => {
      setStealthRaw(on);
      b.invoke("set_stealth", { enabled: on }).catch((e: unknown) => {
        setStealthRaw(!on);
        say(t("Stealth mode: {error}", { error: String(e) }));
      });
    },
    setAutostart: (on) => {
      setAutostartRaw(on);
      b.invoke("set_autostart", { enabled: on }).then(setAutostartRaw, (e: unknown) => {
        setAutostartRaw(!on);
        say(`Autostart: ${String(e)}`);
      });
    },
    nextMic: () => {
      const mic = (dev.mic + 1) % dev.mics.length;
      setDev((d) => ({ ...d, mic }));
      selectDevice("input", mic === 0 ? "" : dev.mics[mic]!);
    },
    nextOut: () => {
      const out = (dev.out + 1) % dev.outs.length;
      setDev((d) => ({ ...d, out }));
      selectDevice("output", out === 0 ? "" : dev.outs[out]!);
    },
    runSelftest: (online = false) => {
      if (selftesting) return;
      if (live) return say(t("No self-test possible during a recording"));
      setSelftesting(true);
      say(t("Self-test running: watch the HUD (about 40 seconds)"));
      b.invoke("run_selftest", { online }).then(
        (r) => {
          setSelftesting(false);
          if (!b.native) return;
          const failed = r.steps.filter((s) => !s.ok).map((s) => s.name);
          say(r.ok ? t("Self-test passed ({n} checks)", { n: r.steps.length }) : t("Self-test: {steps} failed", { steps: failed.join(", ") }));
        },
        (e: unknown) => {
          setSelftesting(false);
          say(t("Self-test: {error}", { error: String(e) }));
        },
      );
    },
    testRec: () => {
      if (testing) return;
      setTesting(true);
      b.invoke("test_recording", { seconds: 5 }).then(
        (r) => {
          setTesting(false);
          say(
            r.ok
              ? t("Both channels detected cleanly")
              : !r.mic_ok && !r.system_ok
                ? t("No signal: microphone and system audio")
                : !r.mic_ok
                  ? t("No signal: microphone")
                  : t("No signal: system audio"),
          );
        },
        (e: unknown) => {
          setTesting(false);
          say(t("Test recording failed: {error}", { error: String(e) }));
        },
      );
    },
  };

  const state: DesktopState = {
    mode,
    winst,
    phase,
    meeting,
    connected,
    tasksMade,
    noteText,
    qcText: qc.text,
    qcSel: qc.sel,
    qcAnswer: qc.answer,
    qcAsking: qc.asking,
    qcError: qc.error,
    qcRec: qc.rec,
    qcSec: qc.sec,
    toast,
    tray,
    win,
    ...dev,
    testing,
    stealth,
    autostart,
    devices,
    defaultInput: defaults.input,
    defaultOutput: defaults.output,
    selftesting,
    webRec: webRec.state,
    webRecStart: webRec.start,
  };

  actionsRef.current = actions;
  return <Ctx.Provider value={{ ...state, ...actions }}>{children}</Ctx.Provider>;
}

export function useDesktop() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDesktop must be used inside <DesktopProvider>");
  return v;
}
