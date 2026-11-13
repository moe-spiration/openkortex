"use client";

import { t } from "@/i18n";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast as sonner } from "sonner";
import { useTracked, useTrackedStore, type TrackedStore } from "@/lib/tracked-store";
import { INBOX_ACTIVE, type InboxJob } from "@/lib/workspace-data";
import { isActive, type CaptureJob } from "./capture-core";
import { INITIAL_MSGS, fmtSec, type CopilotMsg } from "./copilot";
import { createMicGate } from "./voice-core";
import {
  desktopRecorderAvailable,
  initDesktopBridge,
  onDesktopEvent,
  reportWebRecording,
  startDesktopMeeting,
  stopDesktopMeeting,
} from "./desktop-bridge";
import { purposeFor, type CaptureTarget, type RecPurpose } from "./orbit";
import { NEW_NOTE_HREF, writeNewNotePrefill, type NewNotePrefill } from "./new-note";
import {
  DEFAULT_PREFS,
  applyDocumentPrefs,
  loadPrefs,
  systemTheme,
  savePrefs,
  type SectionId,
  type LibLens,
  type ShellPrefs,
  type Tab,
  type Theme,
} from "./prefs";

/*
 * Client state of the workspace shell. Preferences persist to localStorage; everything else
 * (overlays, copilot, captures, drawer) is session state, like in the prototype.
 */

export type CaptureMode = "capture" | "ask";

/** Live voice recorder (lib/shell/voice.ts); without one, recording is the prototype mock. */
export interface VoiceRecorder {
  start: () => void;
  stop: (save: boolean, sec: number, purpose: RecPurpose) => void;
}

/** A finished transcription, handed to the Orbit-Bar, which routes it by intent (W9). */
export interface VoiceTranscript {
  id: number;
  text: string;
  purpose: RecPurpose;
  title: string;
}

/** Mock transcripts (no recorder): one per purpose, so both flows can be tried without a server. */
const MOCK_TRANSCRIPT: Record<RecPurpose, string> = {
  dictation: "Idea: onboarding email with three examples from your own vault",
  voiceQuestion: "What did I note about pricing and retention?",
};
export type MeetingState = "full" | "min" | "hidden";

interface ShellState {
  prefs: ShellPrefs;
  hydrated: boolean;
  /** Picks a theme explicitly (titlebar toggle, settings "Hell"/"Dunkel"); stops following the system. */
  setTheme: (t: Theme) => void;
  /** Settings "System": the theme follows prefers-color-scheme until a theme is picked again. */
  setFollowSystem: (on: boolean) => void;
  setAccent: (a: string) => void;
  toggleRail: () => void;
  /** Tactile Craft titlebar toggle (Ctrl+\): hides or shows the whole sidebar (desktop; the mobile drawer is separate). */
  toggleSidebar: () => void;
  setSidebarClosed: (closed: boolean) => void;
  /**
   * Opens the new-note editor (route /notes/new) with an optional prefill. Every "new note" entry point uses it:
   * titlebar "Neu", sidebar "Neue Notiz", Ctrl/Alt+N, "+" in the tab strip, the Orbit-Bar. The prefill travels in
   * sessionStorage (lib/shell/new-note.ts, key NEW_NOTE_PREFILL_KEY).
   */
  openNewNote: (prefill?: NewNotePrefill) => void;
  toggleSection: (s: SectionId) => void;
  setLibLens: (l: LibLens) => void;
  setFavOrder: (ids: string[]) => void;
  toggleTree: (id: string, open?: boolean) => void;
  setTabs: (fn: (tabs: Tab[]) => Tab[]) => void;

  palette: boolean;
  setPalette: (v: boolean) => void;
  keys: boolean;
  setKeys: (v: boolean) => void;
  /** First-run setup ("Erststart"): 0 = closed, 1..5 = step. */
  onboarding: number;
  setOnboarding: (step: number) => void;

  /** Note drawer: half-side (48%) or pinned split (50%). */
  drawer: { id: string | null; pinned: boolean; lastId: string };
  openNote: (id: string) => void;
  closeDrawer: () => void;
  setSplit: (on: boolean) => void;

  cmode: CaptureMode;
  setCmode: (m: CaptureMode) => void;
  /** Orbit-Bar: the user chose the mode (segment, Tab, "?"); auto-detection leaves it alone. */
  pinned: boolean;
  setPinned: (v: boolean) => void;
  /** Orbit-Bar chip in Festhalten: where captures go (K6). Session state. */
  captureTarget: CaptureTarget;
  setCaptureTarget: (t: CaptureTarget) => void;
  copilot: boolean;
  setCopilot: (v: boolean) => void;
  /** Footbar prompt text (shared so note actions can prefill it). */
  prompt: string;
  setPrompt: (v: string) => void;
  /** KI fragen: switches the footbar to Ask with a prompt about the given note title. */
  askAbout: (title: string) => void;
  msgs: CopilotMsg[];
  pushMsgs: (m: CopilotMsg[]) => void;
  /** Captures of this session (newest first), see useCapture() in ./capture.ts. */
  captures: CaptureJob[];
  /** Adds a local-only inbox row (mock flows). Live captures go through useCapture(). */
  addCapture: (job: InboxJob) => void;
  /** Creates the job when the id is new, else merges the patch. */
  upsertCapture: (id: string, patch: Partial<CaptureJob>) => void;
  dismissCapture: (id: string) => void;
  /** Captures waiting in the inbox (sidebar badge count). */
  inboxActive: number;
  /**
   * Recording in progress (tap = toggle, ptt = push-to-talk while the orb is held). `purpose` is
   * fixed when it starts: Diktat in Festhalten, Sprachfrage in Fragen.
   */
  rec: { mode: "tap" | "ptt"; startedAt: number; purpose: RecPurpose } | null;
  startRec: (mode: "tap" | "ptt") => void;
  /** Microphone stream while recording (live wave level); null when there is none. */
  recStream: MediaStream | null;
  setRecStream: (s: MediaStream | null) => void;
  /** Latest transcript for the Orbit-Bar to route; it clears it with takeTranscript. */
  transcript: VoiceTranscript | null;
  deliverTranscript: (t: Omit<VoiceTranscript, "id">) => void;
  takeTranscript: (id: number) => void;
  stopRec: (save: boolean) => void;
  /** Ends a recording that could not start (no microphone), without saving. */
  cancelRec: () => void;
  /**
   * "Meeting aufnehmen" (Orbit-Bar /meeting, titlebar menu): in the Windows app the native meeting
   * recording (microphone and system sound, HUD pill on minimize; lib/shell/desktop-bridge.ts),
   * in the browser the web's own microphone recording.
   */
  startMeeting: () => void;
  /** Ends the native meeting recording (Orbit-Bar chip). */
  stopMeeting: () => void;
  setRecorder: (r: VoiceRecorder | null) => void;
  modelOpen: boolean;
  setModelOpen: (v: boolean) => void;
  meeting: MeetingState;
  setMeeting: (m: MeetingState) => void;

  /** Shows a toast; the optional button (e.g. "Prüfen" after an automatic placement) keeps it up for 6 s. */
  showToast: (m: string, action?: ToastAction) => void;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

// One state object for the whole shell, handed out through a tracked store (lib/tracked-store.ts): each useShell()
// caller re-renders only when a field it read changes (typing in the Orbit-Bar used to re-render every consumer), and
// the actions are stable.
const Ctx = createContext<TrackedStore<ShellState> | null>(null);

/** A local-only inbox row (mock flows, no server item). */
function localJob(job: InboxJob): CaptureJob {
  return {
    ...job,
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: null,
    status: "inbox",
    createdAt: Date.now(),
  };
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<ShellPrefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);

  // Read persisted prefs after mount (the pre-paint script already applied theme/rail/accent to <html>).
  useEffect(() => {
    setPrefs(loadPrefs());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    savePrefs(prefs);
    applyDocumentPrefs(prefs);
  }, [prefs, hydrated]);
  // Theme "System": follow prefers-color-scheme while it is on.
  useEffect(() => {
    if (!hydrated || !prefs.followSystem) return;
    const sync = () => setPrefs((s) => (s.theme === systemTheme() ? s : { ...s, theme: systemTheme() }));
    sync();
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    mq?.addEventListener("change", sync);
    return () => mq?.removeEventListener("change", sync);
  }, [hydrated, prefs.followSystem]);

  const patch = useCallback((p: Partial<ShellPrefs> | ((s: ShellPrefs) => Partial<ShellPrefs>)) => {
    setPrefs((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));
  }, []);
  // Stable preference actions (effects may depend on them).
  const prefActions = useMemo(
    () => ({
      setTheme: (theme: Theme) => patch({ theme, followSystem: false }),
      setFollowSystem: (on: boolean) => patch(on ? { followSystem: true, theme: systemTheme() } : { followSystem: false }),
      setAccent: (accent: string) => patch({ accent }),
      toggleRail: () => patch((s) => ({ rail: !s.rail })),
      toggleSidebar: () => patch((s) => ({ sidebarClosed: !s.sidebarClosed })),
      setSidebarClosed: (sidebarClosed: boolean) => patch({ sidebarClosed }),
      toggleSection: (id: SectionId) =>
        patch((s) => ({ sections: { ...s.sections, [id]: !s.sections[id] } })),
      toggleTree: (id: string, open?: boolean) =>
        patch((s) => ({ tree: { ...s.tree, [id]: open ?? !s.tree[id] } })),
      setLibLens: (libLens: LibLens) => patch({ libLens }),
      setFavOrder: (favOrder: string[]) => patch({ favOrder }),
      // Keeps the state object when the tab list is unchanged, so syncing effects settle.
      setTabs: (fn: (tabs: Tab[]) => Tab[]) =>
        setPrefs((s) => {
          const tabs = fn(s.tabs);
          return tabs === s.tabs ? s : { ...s, tabs };
        }),
    }),
    [patch],
  );

  const openNewNote = useCallback(
    (prefill?: NewNotePrefill) => {
      writeNewNotePrefill(prefill);
      router.push(NEW_NOTE_HREF);
    },
    [router],
  );

  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  const [onboarding, setOnboarding] = useState(0);
  const [drawer, setDrawer] = useState({ id: null as string | null, pinned: false, lastId: "n2" });
  const [cmode, setCmode] = useState<CaptureMode>("capture");
  const [pinned, setPinned] = useState(false);
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>("auto");
  const [copilot, setCopilot] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [msgs, setMsgs] = useState<CopilotMsg[]>(INITIAL_MSGS);
  const [captures, setCaptures] = useState<CaptureJob[]>([]);
  const upsertCapture = useCallback(
    (id: string, patch: Partial<CaptureJob>) =>
      setCaptures((c) =>
        c.some((j) => j.id === id)
          ? c.map((j) => (j.id === id ? { ...j, ...patch } : j))
          : [
              {
                title: "",
                icon: "i-note",
                step: "",
                pct: 0,
                itemId: null,
                status: "sending",
                createdAt: Date.now(),
                ...patch,
                id,
              },
              ...c,
            ],
      ),
    [],
  );
  const dismissCapture = useCallback(
    (id: string) => setCaptures((c) => c.filter((j) => j.id !== id)),
    [],
  );
  const [rec, setRec] = useState<ShellState["rec"]>(null);
  const recorder = useRef<VoiceRecorder | null>(null);
  const setRecorder = useCallback((r: VoiceRecorder | null) => {
    recorder.current = r;
  }, []);
  const [recStream, setRecStream] = useState<MediaStream | null>(null);
  // Mock mode: the live wave still follows the real microphone. N5 #2: the gate stops a stream
  // that arrives after stop, a second start or the unmount.
  const mockMic = useRef<ReturnType<typeof createMicGate<MediaStream>> | null>(null);
  const mockGate = () =>
    (mockMic.current ??= createMicGate(() =>
      navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ audio: true })
        : Promise.reject(new Error("no microphone")),
    ));
  const [transcript, setTranscript] = useState<VoiceTranscript | null>(null);
  const transcriptSeq = useRef(0);
  const deliverTranscript = useCallback(
    (t: Omit<VoiceTranscript, "id">) => setTranscript({ ...t, id: ++transcriptSeq.current }),
    [],
  );
  const takeTranscript = useCallback(
    (id: number) => setTranscript((t) => (t?.id === id ? null : t)),
    [],
  );
  const releaseMockStream = useCallback(() => {
    mockMic.current?.close();
    setRecStream(null);
  }, []);
  useEffect(() => () => mockMic.current?.close(), []);
  const cancelRec = useCallback(() => {
    setRec(null);
    releaseMockStream();
  }, [releaseMockStream]);
  // Windows app: the core shows the HUD pill for the Orbit-Bar's own recording while the window is
  // minimized, and its stop button ends that recording here (desktop-bridge.ts).
  useEffect(() => initDesktopBridge(), []);
  useEffect(() => reportWebRecording(rec !== null), [rec]);
  const stopRecRef = useRef<((save: boolean) => void) | null>(null);
  useEffect(
    () =>
      onDesktopEvent((e) => {
        if (e.type === "stop-web-recording") stopRecRef.current?.(true);
      }),
    [],
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [meeting, setMeeting] = useState<MeetingState>("full");
  // Toasts run on Sonner (components/shell/Overlays.tsx renders the Toaster): several can stack, each with its own
  // timer, and the API stays the same for every caller. An empty message dismisses all (old "showToast('')").
  const showToast = useCallback((m: string, action?: ToastAction) => {
    if (!m) {
      sonner.dismiss();
      return;
    }
    // A toast with a button stays long enough to reach it.
    sonner.success(m, {
      duration: action ? 6000 : 2400,
      action: action ? { label: action.label, onClick: () => action.run() } : undefined,
    });
  }, []);

  const value = useMemo<ShellState>(() => {
    const startRec = (mode: "tap" | "ptt") => {
      // Only ever from a user gesture (orb, Ctrl+Shift+Space, palette): never on focus.
      setModelOpen(false);
      setRec({ mode, startedAt: Date.now(), purpose: purposeFor(cmode) });
      if (recorder.current) {
        recorder.current.start();
        return;
      }
      // Mock: no recorder, but the live wave still follows the real microphone level.
      mockGate().open((stream) => setRecStream(stream));
    };
    return {
      prefs,
      hydrated,
      ...prefActions,
      openNewNote,

      palette,
      setPalette,
      keys,
      setKeys,
      onboarding,
      setOnboarding,

      drawer,
      openNote: (id) => setDrawer((d) => ({ ...d, id, lastId: id })),
      closeDrawer: () => setDrawer((d) => ({ ...d, id: null, pinned: false })),
      setSplit: (on) =>
        setDrawer((d) =>
          on ? { ...d, id: d.id ?? d.lastId, pinned: true } : { ...d, id: null, pinned: false },
        ),

      cmode,
      setCmode,
      pinned,
      setPinned,
      captureTarget,
      setCaptureTarget,
      copilot,
      setCopilot,
      prompt,
      setPrompt,
      askAbout: (title) => {
        setCmode("ask");
        setPinned(true);
        setCopilot(true);
        setPrompt(t("Summarize “{title}” and name open points", { title }));
      },
      msgs,
      pushMsgs: (m) => {
        setMsgs((x) => [...x, ...m]);
        setCopilot(true);
      },
      captures,
      addCapture: (job) => setCaptures((c) => [localJob(job), ...c]),
      upsertCapture,
      dismissCapture,
      inboxActive: INBOX_ACTIVE.length + captures.filter(isActive).length,
      rec,
      startRec,
      stopRec: (save) => {
        if (!rec) return;
        setRec(null);
        const sec = Math.max(1, Math.round((Date.now() - rec.startedAt) / 1000));
        if (recorder.current) {
          recorder.current.stop(save, sec, rec.purpose);
          return;
        }
        releaseMockStream();
        if (!save) {
          showToast(t("Recording discarded"));
          return;
        }
        deliverTranscript({
          text: MOCK_TRANSCRIPT[rec.purpose],
          purpose: rec.purpose,
          title: rec.purpose === "voiceQuestion" ? t("Voice question {duration}", { duration: fmtSec(sec) }) : t("Voice memo {duration}", { duration: fmtSec(sec) }),
        });
      },
      startMeeting: () => {
        if (!desktopRecorderAvailable()) {
          startRec("tap");
          return;
        }
        startDesktopMeeting().then(
          () => showToast(t("Meeting recording is running: microphone and system audio")),
          (e: unknown) => showToast(t("Recording not possible: {error}", { error: e instanceof Error ? e.message : String(e) })),
        );
      },
      stopMeeting: () => {
        stopDesktopMeeting().then(
          (r) => showToast(r.uploading ? t("Meeting ended, minutes are being created") : t("Meeting ended, saved locally")),
          (e: unknown) => showToast(t("Recording: {error}", { error: e instanceof Error ? e.message : String(e) })),
        );
      },
      recStream,
      setRecStream,
      transcript,
      deliverTranscript,
      takeTranscript,
      cancelRec,
      setRecorder,
      modelOpen,
      setModelOpen,
      meeting,
      setMeeting,

      showToast,
    };
  }, [
      prefs,
      hydrated,
      prefActions,
      openNewNote,
      palette,
      keys,
      onboarding,
      drawer,
      cmode,
      pinned,
      captureTarget,
      copilot,
      prompt,
      msgs,
      captures,
      upsertCapture,
      dismissCapture,
      rec,
      cancelRec,
      setRecorder,
      recStream,
      transcript,
      deliverTranscript,
      takeTranscript,
      releaseMockStream,
      modelOpen,
      meeting,
      showToast,
    ],
  );

  stopRecRef.current = value.stopRec;
  const store = useTrackedStore(value);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useShell(): ShellState {
  const store = useContext(Ctx);
  if (!store) throw new Error("useShell must be used inside <ShellProvider>");
  return useTracked(store);
}
