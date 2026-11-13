import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import type { CoverSource } from "../theme/cover";
import { answerFor, clock, INITIAL_ASK, routeOf } from "../lib/answers";
import { mockCheckinStreak } from "../lib/streak";
import type { SortId } from "../lib/search";
import { IMG, INBOX_JOBS, NOTE_TAGS } from "../data/mock";
import { isoDay, parseCheckin, seedCheckin, streakOf, type DailyCheckin, type DailyFocus } from "../data/daily";
import { AUTONOMY, skillOf, undoOf, type AgentProposal, type AgentResult, type AgentStep, type Autonomy } from "../lib/agent";
import { agentExecute, agentUndo, askKortex, api, chatStatus, loadDaily, NothingHeardError, saveDaily, secureStorage, transcribe, type ChatTurn } from "../api/kortex";
import { citedSources } from "../api/chatStream";
import { APP_VERSION } from "../api/config";
import { clientInfo, isRetryable, requestFromShare, type IngestRequest } from "../api/ingest";
import { createQueue, isNetworkError, type QueueJob, type SendResult } from "../capture/queue";
import { useVoice, VOICE_MIME } from "../capture/useVoice";
import { takePeakDb } from "../capture/LevelWave";
import { voiceRejection } from "../capture/level";
import type { AudioRecorder } from "expo-audio";
import { useData } from "./Data";
import { statusCommand, statusSummary } from "../data/status";
import * as ImagePicker from "expo-image-picker";
import { setHapticsEnabled } from "../lib/haptics";
import { intlLocale, msg, t, tn } from "../i18n";
import { useLocale } from "../i18n/device";

/*
 * Session state of the app (Mobile.dc.html `s()`): everything the prototype keeps in component state
 * lives here, so screens and overlays stay stateless. Persistent settings arrive with the sync Etappe.
 */

export type ViewMode = "list" | "grid" | "time";
const AUTONOMY_KEY = "kortex.agent.autonomy";
/** G4: which entries the Einträge tab shows (all, the starred ones, the archive). */
export type EntryScope = "all" | "favorites" | "folders" | "archive";
export type CaptureKind = "voice" | "note" | "photo" | "scratchpad";
export type Sheet = { kind: "entry" | "area"; id: string } | null;
export type Msg = {
  me: boolean;
  text: string;
  ids?: string[];
  /** Live: source titles, parallel to ids. */
  titles?: string[];
  /** A button under the answer (copilot status: "Apply"). */
  action?: { label: string; run: () => void };
  /** Agent: stable key of the answer (confirm and undo find it by this). */
  key?: number;
  /** Agent: the steps it took (search, read, write). */
  steps?: AgentStep[];
  /** Agent "ask": proposed changes and where the confirmation stands. */
  proposal?: AgentProposal & { state: "open" | "running" | "done" | "dismissed" };
  /** Agent: changes made (at once with "self", or after confirming). */
  done?: AgentResult[];
  /** Agent: the changes were taken back. */
  undone?: boolean;
};
export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  run: () => void;
}
export interface Menu {
  title: string;
  items: MenuItem[];
}

/** A live photo picked from the camera or gallery, waiting in the photo sheet. */
export interface PickedPhoto {
  uri: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
}

/** Photo modes of the capture sheet (English sources, shown with `t(mode)`); the pick is sent along as a hint for the vision pass. */
export const PHOTO_MODES = [msg("Document"), "Whiteboard", msg("Photo")] as const;

export interface Capture {
  id: string;
  title: string;
  img: CoverSource;
  step: string;
}

interface AppState {
  // Entries
  q: string;
  setQ: (q: string) => void;
  chip: string;
  setChip: (c: string) => void;
  scope: EntryScope;
  setScope: (s: EntryScope) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  sort: SortId;
  setSort: (s: SortId) => void;
  sortOpen: boolean;
  setSortOpen: (v: boolean) => void;
  // Detail sheet
  sheet: Sheet;
  openEntry: (id: string) => void;
  openArea: (key: string) => void;
  closeSheet: () => void;
  // Daily check-in
  energy: number;
  /** Picks today's energy and saves the check-in at once (like the web: one tap, no save button). */
  setEnergy: (n: number) => void;
  streak: number;
  /** Days (YYYY-MM-DD) with a check-in, for the week dots. */
  checkinDays: string[];
  /** Energy of the last 7 days, oldest first, today last (null: no check-in), for the bars under the streak. */
  energyHistory: { date: string; energy: number | null }[];
  /** "Top 3 heute" of the daily check-in (like the web overview); a tap ticks one off in the daily note. */
  focus: DailyFocus[];
  toggleFocus: (key: string) => void;
  /** Today's journal entry (the daily note's Mind Dump, one thought per line), saved automatically. */
  journalText: string;
  setJournalText: (v: string) => void;
  /** "loading" until today's note is read, then "idle" / "saving" / "saved" / "error". */
  journalState: "loading" | "idle" | "saving" | "saved" | "error";
  // Home extras
  cardsDone: boolean;
  reviewCards: () => void;
  // Ask
  model: number;
  nextModel: () => void;
  msgs: Msg[];
  thinking: boolean;
  askText: string;
  setAskText: (t: string) => void;
  askRec: boolean;
  toggleAskRec: () => void;
  /** With an item id the answer is grounded on that one note (mode "note"). */
  ask: (text: string, itemId?: string) => void;
  resetChat: () => void;
  /** Agent: how far it may go (read only, ask first, on its own); kept per device. */
  autonomy: Autonomy;
  setAutonomy: (a: Autonomy) => void;
  /** Agent: the step it is on while it works ("Gesucht: …"), else null. */
  agentStep: string | null;
  /** Agent: carries out (true) or discards (false) the proposal of the answer with this key. */
  decideProposal: (key: number, run: boolean) => void;
  /** Agent: takes back the changes of the answer with this key. */
  undoAnswer: (key: number) => void;
  /** Captures waiting in the offline queue. */
  pendingCount: number;
  flushQueue: () => Promise<void>;
  /** Puts a capture straight into the offline queue (share sheet while offline). */
  queueCapture: (job: QueueJob) => Promise<void>;
  // Inbox
  inboxP: number[];
  tickInbox: () => void;
  caps: Capture[];
  newInbox: number;
  inboxCount: number;
  activeCount: number;
  // Capture orb
  fan: boolean;
  setFan: (v: boolean) => void;
  hot: CaptureKind | null;
  setHot: (k: CaptureKind | null) => void;
  pressed: boolean;
  setPressed: (v: boolean) => void;
  cap: CaptureKind | null;
  openCap: (k: CaptureKind) => void;
  closeCap: () => void;
  vSec: number;
  voiceClock: string;
  /** The live recorder (null in demo mode), for the real input level meter (A4). */
  voiceRecorder: AudioRecorder | null;
  /** Live mode: the photo sheet picks real images instead of the prototype viewfinder. */
  live: boolean;
  saveVoice: () => void;
  discardVoice: () => void;
  noteText: string;
  setNoteText: (t: string) => void;
  noteTag: boolean[];
  toggleNoteTag: (i: number) => void;
  saveNote: () => void;
  shot: boolean;
  setShot: (v: boolean) => void;
  camMode: number;
  setCamMode: (i: number) => void;
  savePhoto: () => void;
  /** Live photo capture (A2): the picked image, waiting in the photo sheet for "In Inbox". */
  photo: PickedPhoto | null;
  pickPhoto: (from: "camera" | "library") => void;
  photoNote: string;
  setPhotoNote: (t: string) => void;
  // Settings
  sets: boolean[];
  toggleSet: (i: number) => void;
  themePref: number;
  cycleTheme: () => void;
  defModel: number;
  cycleDefModel: () => void;
  accent: string;
  setAccent: (a: string) => void;
  haptics: boolean;
  toggleHaptics: () => void;
  // Toast
  toast: string;
  /** Optional toast button ("Undo"). */
  toastAction: { label: string; run: () => void } | null;
  say: (m: string, action?: { label: string; run: () => void }) => void;
  /** Long-press context menu. */
  menu: Menu | null;
  openMenu: (m: Menu) => void;
  closeMenu: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const data = useData();
  const live = data.auth === "live";
  const voice = useVoice();
  // Texts in the context value are built in the current language; a switch rebuilds it and re-renders every consumer.
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("all");
  const [scope, setScope] = useState<EntryScope>("all");
  const [view, setView] = useState<ViewMode>("list");
  const [sort, setSort] = useState<SortId>("rel");
  const [sortOpen, setSortOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  const [energy, setEnergyRaw] = useState(0);
  const [saved, setSaved] = useState(false);
  // Live check-in: today's daily note (10_Notes/Daily/<date>.md) and the days that have one.
  const [daily, setDaily] = useState<DailyCheckin | null>(null);
  const [dailyDays, setDailyDays] = useState<string[]>([]);
  const [dailyEnergy, setDailyEnergy] = useState<Record<string, number>>({});
  const [mockFocus, setMockFocus] = useState<DailyFocus[] | null>(null);
  const [journalText, setJournalTextRaw] = useState("");
  const [journalState, setJournalState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const dailyRef = useRef<DailyCheckin | null>(null);
  dailyRef.current = daily;
  const journalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!live) return;
    const today = isoDay(new Date());
    let cancelled = false;
    void loadDaily(today)
      .then((r) => {
        if (cancelled) return;
        const seed = seedCheckin(today, data.tasks, streakOf(r.days, today));
        const stored = parseCheckin(today, r.stored, seed);
        setDaily(stored ? { ...stored, streak: seed.streak } : seed);
        setJournalTextRaw((stored?.mindDump ?? []).join("\n"));
        setJournalState("idle");
        setDailyDays(r.days);
        setDailyEnergy(r.energies);
        setSaved(!!stored && stored.energy != null);
      })
      .catch(() => setJournalState("idle"));
    return () => {
      cancelled = true;
    };
    // Tasks only seed the day's top 3 once; later task changes do not rewrite the check-in.
  }, [live]);
  const [cardsDone, setCardsDone] = useState(false);

  const [model, setModel] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([
    { me: true, text: INITIAL_ASK.question },
    { me: false, text: INITIAL_ASK.answer.text, ids: INITIAL_ASK.answer.ids },
  ]);
  const [thinking, setThinking] = useState(false);
  const [autonomy, setAutonomyState] = useState<Autonomy>("ask");
  const [agentStep, setAgentStep] = useState<string | null>(null);
  const answerKey = useRef(0);
  useEffect(() => {
    void secureStorage
      .getItem(AUTONOMY_KEY)
      .then((v) => v && (AUTONOMY as readonly string[]).includes(v) && setAutonomyState(v as Autonomy))
      .catch(() => undefined);
  }, []);
  const [askText, setAskText] = useState("");
  const [askRec, setAskRec] = useState(false);

  const [inboxP, setInboxP] = useState(INBOX_JOBS.map((j) => j.start));
  const [caps, setCaps] = useState<Capture[]>([]);
  const [newInbox, setNewInbox] = useState(0);

  const [fan, setFan] = useState(false);
  const [hot, setHot] = useState<CaptureKind | null>(null);
  const [pressed, setPressed] = useState(false);
  const [cap, setCap] = useState<CaptureKind | null>(null);
  const [vSec, setVSec] = useState(0);
  const [noteText, setNoteText] = useState("");
  const [noteTag, setNoteTag] = useState([false, false, false]);
  const [shot, setShot] = useState(false);
  const [camMode, setCamMode] = useState(1);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [photoNote, setPhotoNote] = useState("");

  const [sets, setSets] = useState([true, true, true, true, false, true, true]);
  const [themePref, setThemePref] = useState(0);
  const [defModel, setDefModel] = useState(0);
  const [accent, setAccent] = useState("indigo");
  const [haptics, setHaptics] = useState(true);

  // Appearance and haptics survive restarts (SecureStore, per device).
  const prefsLoaded = useRef(false);
  useEffect(() => {
    void secureStorage
      .getItem("kortex.prefs")
      .then((raw) => {
        const p = raw ? (JSON.parse(raw) as { themePref?: number; accent?: string; haptics?: boolean }) : {};
        if (typeof p.themePref === "number") setThemePref(p.themePref);
        if (typeof p.accent === "string") setAccent(p.accent);
        if (typeof p.haptics === "boolean") setHaptics(p.haptics);
      })
      .catch(() => undefined)
      .finally(() => {
        prefsLoaded.current = true;
      });
  }, []);
  useEffect(() => {
    setHapticsEnabled(haptics);
    if (prefsLoaded.current) void secureStorage.setItem("kortex.prefs", JSON.stringify({ themePref, accent, haptics })).catch(() => undefined);
  }, [themePref, accent, haptics]);

  const [toast, setToast] = useState("");
  const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const timers = useRef<{ toast?: ReturnType<typeof setTimeout>; ask?: ReturnType<typeof setTimeout>; ci?: ReturnType<typeof setTimeout> }>({});

  const say = useCallback((m: string, action?: { label: string; run: () => void }) => {
    setToast(m);
    setToastAction(action ?? null);
    if (timers.current.toast) clearTimeout(timers.current.toast);
    timers.current.toast = setTimeout(() => {
      setToast("");
      setToastAction(null);
    }, action ? 4000 : 2200);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach((x) => x && clearTimeout(x));
    };
  }, []);

  // Voice recorder clock: real seconds when live, the prototype's 700 ms tick in demo mode.
  useEffect(() => {
    if (cap !== "voice") return;
    const iv = setInterval(() => setVSec((s) => s + 1), live ? 1000 : 700);
    return () => clearInterval(iv);
  }, [cap, live]);

  const openCap = useCallback((k: CaptureKind) => {
    setFan(false);
    setHot(null);
    setCap(k);
    setVSec(0);
    setShot(false);
    setSheet(null);
    if (k === "photo") {
      setPhoto(null);
      setPhotoNote("");
    }
    if (k === "voice" && live)
      void voice.start().then((ok) => {
        if (!ok) {
          setCap(null);
          setToast(t("Microphone access not granted"));
        } else takePeakDb(voice.recorder);
      });
  }, [live, voice]);
  const closeCap = useCallback(() => setCap(null), []);

  const addCapture = useCallback((c: Omit<Capture, "id">) => {
    const id = `cap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setCap(null);
    setNewInbox((n) => n + 1);
    setCaps((l) => [{ ...c, id }, ...l]);
    return id;
  }, []);
  const setCapStep = useCallback((id: string, step: string) => setCaps((l) => l.map((c) => (c.id === id ? { ...c, step } : c))), []);
  const dropCapture = useCallback((id: string) => {
    setCaps((l) => l.filter((c) => c.id !== id));
    setNewInbox((n) => Math.max(0, n - 1));
  }, []);

  // Offline queue (SecureStore): captures that could not reach Kortex are sent later.
  const queue = useMemo(() => createQueue(secureStorage), []);
  const [pendingCount, setPendingCount] = useState(0);

  /** Sends one capture; tells retry (offline) apart from permanent failures. */
  const runJob = useCallback(async (job: QueueJob, onStep?: (s: string) => void): Promise<{ result: SendResult; duplicate?: boolean; error?: string; nothingHeard?: boolean }> => {
    try {
      let req: IngestRequest;
      if (job.kind === "voice") {
        const text = await transcribe(job.uri, VOICE_MIME);
        onStep?.(t("Saving"));
        req = {
          kind: "note",
          client: clientInfo(APP_VERSION),
          captured_at: new Date().toISOString(),
          content_md: text,
          title: text.split(/\s+/).slice(0, 8).join(" ").slice(0, 80) || job.title,
          type_hint: "voice",
        };
      } else if (job.kind === "file") {
        const r = await api().ingestFile({ uri: job.uri, name: job.name, mimeType: job.mimeType }, { title: job.title, ...(job.note ? { note: job.note } : {}) });
        if (r.ok) return { result: "ok", duplicate: r.duplicate };
        return { result: isRetryable(r) ? "retry" : "drop", error: r.error.message };
      } else req = job.req;
      const r = await api().ingest(req);
      if (r.ok) return { result: "ok", duplicate: r.duplicate };
      return { result: isRetryable(r) ? "retry" : "drop", error: r.error.message };
    } catch (e) {
      if (e instanceof NothingHeardError) return { result: "drop", error: e.message, nothingHeard: true };
      return { result: isNetworkError(e) ? "retry" : "drop", error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  /** Live capture: a pending card in the Inbox until /api/ingest answered; offline → queue. */
  const sendJob = useCallback(
    async (capId: string, job: QueueJob, done: string) => {
      const r = await runJob(job, (step) => setCapStep(capId, step));
      if (r.result === "ok") {
        dropCapture(capId);
        say(r.duplicate ? t("Already in the vault, nothing saved twice") : done);
        void data.refreshItems();
      } else if (r.nothingHeard) {
        dropCapture(capId);
        say(r.error ?? t("Nothing understood"));
      } else if (r.result === "retry") {
        dropCapture(capId);
        setPendingCount(await queue.add(job));
        say(t("Saved offline, will be sent as soon as Kortex is reachable"));
      } else {
        setCapStep(capId, t("Error: {message}", { message: r.error ?? t("unknown") }));
        say(r.error ?? t("Error while saving"));
      }
    },
    [data, dropCapture, setCapStep, say, runJob, queue],
  );

  const flushQueue = useCallback(async () => {
    if (!live) return;
    const r = await queue.flush(async (job) => (await runJob(job)).result);
    setPendingCount(r.left);
    if (r.sent) {
      say(tn(r.sent, "{n} waiting capture sent", "{n} waiting captures sent"));
      void data.refreshItems();
    }
  }, [live, queue, runJob, say, data]);

  // Retry on sign-in, when the app returns to the foreground and every 30 s while something waits.
  useEffect(() => {
    void queue.list().then((l) => setPendingCount(l.length));
    if (!live) {
      setPendingCount(0);
      return;
    }
    void flushQueue();
    const sub = RNAppState.addEventListener("change", (st) => st === "active" && void flushQueue());
    return () => sub.remove();
  }, [live, queue, flushQueue]);
  useEffect(() => {
    if (!live || !pendingCount) return;
    const iv = setInterval(() => void flushQueue(), 30_000);
    return () => clearInterval(iv);
  }, [live, pendingCount, flushQueue]);

  // Live photo capture (A2): system camera or gallery → preview in the sheet → upload as a file
  // ingest; the server runs the vision_ocr route on images.
  const pickPhoto = useCallback((from: "camera" | "library") => {
    void (async () => {
      try {
        const perm = from === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return setToast(from === "camera" ? t("Camera access not granted") : t("Photo access not granted"));
        const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, exif: false };
        const res = from === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
        const asset = res.canceled ? null : res.assets[0];
        if (!asset) return;
        setPhoto({ uri: asset.uri, name: asset.fileName || `foto-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg", width: asset.width, height: asset.height });
      } catch (e) {
        setToast(e instanceof Error ? e.message : t("The photo could not be opened"));
      }
    })();
  }, []);

  const saveVoice = useCallback(() => {
    const sec = Math.max(1, vSec);
    if (live) {
      // Too short or nothing heard: do not upload, do not store.
      const bad = voiceRejection(vSec, takePeakDb(voice.recorder));
      if (bad) {
        void voice.cancel();
        setCap(null);
        return say(bad === "short" ? t("Too short. Hold the orb and speak.") : t("Nothing understood. Check the microphone and speak louder."));
      }
    }
    const title = t("Voice memo {time}", { time: clock(sec) });
    const inInbox = t("Voice memo ({time}) in the Inbox", { time: clock(sec) });
    const id = addCapture({ title, img: IMG.home, step: live ? t("Transcribing") : t("Whisper is transcribing") });
    if (!live) return say(inInbox);
    void voice.stop().then((uri) => {
      if (!uri) {
        setCapStep(id, t("Error: {message}", { message: t("Recording failed") }));
        return say(t("Recording failed"));
      }
      return sendJob(id, { kind: "voice", title, uri }, inInbox);
    });
  }, [vSec, addCapture, say, live, sendJob, voice, setCapStep]);

  const ask = useCallback(
    (text: string, itemId?: string) => {
      const v = text.trim();
      if (!v || thinking) return;
      setMsgs((m) => [...m, { me: true, text: v }]);
      setAskText("");
      setThinking(true);
      setAskRec(false);
      const instruction = statusCommand(v);
      if (instruction) {
        if (!live) {
          setMsgs((m) => [...m, { me: false, text: t("Status updates only work with your Kortex account.") }]);
          setThinking(false);
          return;
        }
        // Preview first; "Apply" stores it on the entry the server found.
        chatStatus(instruction, { save: false })
          .then((r) => {
            const apply = () => {
              setMsgs((m) => m.map((x) => (x.action?.run === apply ? { ...x, action: undefined } : x)));
              setThinking(true);
              chatStatus(instruction, { itemId: r.item_id, save: true })
                .then((s) => {
                  setMsgs((m) => [...m, { me: false, text: statusSummary(s), ids: [s.item_id], titles: [s.title] }]);
                  void data.refreshItems();
                })
                .catch((e: unknown) => setMsgs((m) => [...m, { me: false, text: t("Not saved: {message}", { message: e instanceof Error ? e.message : String(e) }) }]))
                .finally(() => setThinking(false));
            };
            setMsgs((m) => [...m, { me: false, text: statusSummary(r), ids: [r.item_id], titles: [r.title], action: { label: t("Apply"), run: apply } }]);
          })
          .catch((e: unknown) => setMsgs((m) => [...m, { me: false, text: t("Error: {message}", { message: e instanceof Error ? e.message : String(e) }) }]))
          .finally(() => setThinking(false));
        return;
      }
      if (live) {
        const history: ChatTurn[] = [...msgs.filter((m) => !m.action && m.text.trim()), { me: true, text: v }].map((m) => ({ role: m.me ? "user" : "assistant", content: m.text }));
        // The answer streams into one assistant message that is replaced on every chunk.
        let started = false;
        const show = (msg: Msg) =>
          setMsgs((m) => {
            if (!started) {
              started = true;
              return [...m, msg];
            }
            return [...m.slice(0, -1), msg];
          });
        const key = ++answerKey.current;
        askKortex(
          history,
          (partial) => {
            const last = partial.steps[partial.steps.length - 1];
            if (last) setAgentStep(last.label);
            if (!partial.text) return;
            setThinking(false);
            show({ me: false, key, text: partial.text, steps: partial.steps });
          },
          itemId,
          { autonomy, skill: skillOf(v) },
        )
          .then((a) => {
            const src = citedSources(a);
            const text = a.error ?? (a.text || (a.proposal || a.done.length ? "" : t("No answer received.")));
            show({
              me: false,
              key,
              text,
              ids: src.map((c) => c.item_id),
              titles: src.map((c) => c.title),
              steps: a.steps,
              ...(a.proposal ? { proposal: { ...a.proposal, state: "open" as const } } : {}),
              ...(a.done.length ? { done: a.done } : {}),
            });
            if (a.done.some((r) => r.ok)) void data.refreshItems();
          })
          .catch((e: unknown) => show({ me: false, text: t("Error: {message}", { message: e instanceof Error ? e.message : String(e) }) }))
          .finally(() => {
            setThinking(false);
            setAgentStep(null);
          });
        return;
      }
      if (timers.current.ask) clearTimeout(timers.current.ask);
      timers.current.ask = setTimeout(() => {
        const a = answerFor(v);
        setMsgs((m) => [...m, { me: false, text: a.text, ids: a.ids }]);
        setThinking(false);
      }, 1100);
    },
    [thinking, live, msgs, data, autonomy],
  );

  const patchAnswer = useCallback((key: number, patch: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m) => (m.key === key ? patch(m) : m))), []);
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const decideProposal = useCallback(
    (key: number, run: boolean) => {
      const m = msgs.find((x) => x.key === key);
      if (!m?.proposal || m.proposal.state !== "open") return;
      if (!run) return patchAnswer(key, (x) => ({ ...x, proposal: { ...x.proposal!, state: "dismissed" } }));
      patchAnswer(key, (x) => ({ ...x, proposal: { ...x.proposal!, state: "running" } }));
      agentExecute(m.proposal.actions)
        .then((results) => {
          patchAnswer(key, (x) => ({ ...x, proposal: { ...x.proposal!, state: "done" }, done: results }));
          if (results.some((r) => r.ok)) void data.refreshItems();
        })
        .catch((e: unknown) => {
          patchAnswer(key, (x) => ({ ...x, proposal: { ...x.proposal!, state: "open" } }));
          say(t("Not carried out: {message}", { message: errText(e) }));
        });
    },
    [msgs, patchAnswer, data, say],
  );

  const undoAnswer = useCallback(
    (key: number) => {
      const m = msgs.find((x) => x.key === key);
      const undo = undoOf(m?.done ?? []);
      if (!undo.length || m?.undone) return;
      patchAnswer(key, (x) => ({ ...x, undone: true }));
      agentUndo(undo)
        .then((r) => {
          const failed = r.filter((x) => !x.ok).length;
          say(failed ? tn(failed, "{n} change could not be undone", "{n} changes could not be undone") : t("Undone"));
          void data.refreshItems();
        })
        .catch((e: unknown) => {
          patchAnswer(key, (x) => ({ ...x, undone: false }));
          say(t("Not undone: {message}", { message: errText(e) }));
        });
    },
    [msgs, patchAnswer, data, say],
  );

  // Live: start with an empty conversation instead of the prototype example.
  useEffect(() => {
    if (live) setMsgs([]);
  }, [live]);

  const value = useMemo<AppState>(() => {
    const activeCount = inboxP.filter((v) => v < 100).length + caps.length;
    return {
      q, setQ, chip, setChip, scope, setScope, view, setView, sort, setSort, sortOpen, setSortOpen,
      sheet,
      openEntry: (id) => setSheet({ kind: "entry", id }),
      openArea: (key) => setSheet({ kind: "area", id: key }),
      closeSheet: () => setSheet(null),
      energy: live ? (daily?.energy ?? 0) : energy,
      setEnergy: (n) => {
        const first = !saved;
        if (!live) {
          setEnergyRaw(n);
          setSaved(true);
          if (first) say(tn(mockCheckinStreak(true), "Check-in saved, streak {n} day", "Check-in saved, streak {n} days"));
          return;
        }
        if (!daily) return;
        const days = dailyDays.includes(daily.date) ? dailyDays : [daily.date, ...dailyDays];
        const next = { ...daily, energy: n, streak: streakOf(days, daily.date) };
        setDaily(next);
        setDailyEnergy((m) => ({ ...m, [daily.date]: n }));
        void saveDaily(next)
          .then(() => {
            setDailyDays(days);
            setSaved(true);
            if (first) say(tn(next.streak, "Check-in saved, streak {n} day", "Check-in saved, streak {n} days"));
          })
          .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));
      },
      streak: live ? (daily?.streak ?? 0) : mockCheckinStreak(saved),
      checkinDays: live ? dailyDays : saved ? [isoDay(new Date())] : [],
      energyHistory: (() => {
        const today = isoDay(new Date());
        return Array.from({ length: 7 }, (_, i) => {
          const date = isoDay(new Date(Date.now() - (6 - i) * 86_400_000));
          const e = live ? (date === today ? (daily?.energy ?? null) : (dailyEnergy[date] ?? null)) : date === today ? (energy || null) : null;
          return { date, energy: e };
        });
      })(),
      focus: live ? (daily?.focus ?? []) : (mockFocus ?? seedCheckin(isoDay(new Date()), data.tasks, 0).focus),
      toggleFocus: (key) => {
        const flip = (f: DailyFocus[]) => f.map((x) => (x.key === key ? { ...x, done: !x.done } : x));
        if (!live) return setMockFocus((m) => flip(m ?? seedCheckin(isoDay(new Date()), data.tasks, 0).focus));
        if (!daily) return;
        const next = { ...daily, focus: flip(daily.focus) };
        setDaily(next);
        void saveDaily(next).catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));
      },
      journalText,
      journalState: live ? journalState : "idle",
      setJournalText: (v) => {
        setJournalTextRaw(v);
        if (!live) return;
        const lines = v.split("\n").map((l) => l.trim()).filter(Boolean);
        setDaily((c) => (c ? { ...c, mindDump: lines } : c));
        if (journalTimer.current) clearTimeout(journalTimer.current);
        // Like the web journal: saved automatically, debounced.
        journalTimer.current = setTimeout(() => {
          const cur = dailyRef.current;
          if (!cur) return;
          setJournalState("saving");
          void saveDaily({ ...cur, mindDump: lines })
            .then(() => setJournalState("saved"))
            .catch((e: unknown) => {
              setJournalState("error");
              say(e instanceof Error ? e.message : String(e));
            });
        }, 700);
      },
      cardsDone,
      reviewCards: () => {
        setCardsDone(true);
        say(t("3 flashcards reviewed, next ones on Monday"));
      },
      model,
      nextModel: () => setModel((m) => (m + 1) % 5),
      msgs,
      thinking,
      askText,
      setAskText,
      askRec,
      toggleAskRec: () => {
        if (!live) {
          if (askRec) {
            setAskRec(false);
            setAskText(t("What did Tom say about conflicts?"));
          } else setAskRec(true);
          return;
        }
        if (!askRec) {
          void voice.start().then((ok) => (ok ? setAskRec(true) : say(t("Microphone access not granted"))));
          return;
        }
        setAskRec(false);
        setThinking(true);
        voice
          .stop()
          .then((uri) => (uri ? transcribe(uri, VOICE_MIME) : Promise.reject(new Error(t("Recording failed")))))
          .then((text) => setAskText(text))
          .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
          .finally(() => setThinking(false));
      },
      ask,
      pendingCount,
      flushQueue,
      queueCapture: async (job) => setPendingCount(await queue.add(job)),
      autonomy,
      setAutonomy: (next: Autonomy) => {
        setAutonomyState(next);
        void secureStorage.setItem(AUTONOMY_KEY, next).catch(() => undefined);
      },
      agentStep,
      decideProposal,
      undoAnswer,
      resetChat: () => {
        setMsgs([]);
        setAskText("");
      },
      inboxP,
      tickInbox: () => setInboxP((p) => (p.every((v) => v >= 100) ? p : p.map((v, i) => Math.min(100, v + (INBOX_JOBS[i]?.rate ?? 5))))),
      caps,
      newInbox,
      inboxCount: live ? data.jobs.length + pendingCount : 2 + newInbox,
      activeCount,
      fan, setFan, hot, setHot, pressed, setPressed,
      cap,
      openCap,
      closeCap,
      vSec,
      voiceClock: clock(vSec),
      voiceRecorder: live ? voice.recorder : null,
      live,
      saveVoice,
      discardVoice: () => {
        void voice.cancel();
        setCap(null);
        say(t("Voice memo discarded"));
      },
      noteText,
      setNoteText,
      noteTag,
      toggleNoteTag: (i) => setNoteTag((tags) => tags.map((x, j) => (j === i ? !x : x))),
      saveNote: () => {
        if (!noteText.trim()) {
          say(t("Write down a thought first"));
          return;
        }
        const text = noteText.trim();
        const tags = NOTE_TAGS.filter((_, i) => noteTag[i]).map(([tag]) => tag.replace(/^#/, ""));
        setNoteText("");
        setNoteTag([false, false, false]);
        if (live) {
          // A pasted link becomes a web_clip (the server fetches the page), anything else a note.
          const req = requestFromShare({ text }, APP_VERSION);
          if (!req) return;
          const id = addCapture({ title: text.slice(0, 40), img: req.kind === "web_clip" ? IMG.book : IMG.journal, step: t("Saving") });
          void sendJob(id, { kind: "ingest", title: text.slice(0, 40), req: { ...req, tags } }, req.kind === "web_clip" ? t("Link in the Inbox") : t("Note in the Inbox"));
          return;
        }
        const r = routeOf(text);
        addCapture({ title: text.slice(0, 40), img: IMG.journal, step: `Auto-Routing: ${r}` });
        say(t("Note in the Inbox · suggestion: {route}", { route: r }));
      },
      shot,
      setShot,
      camMode,
      setCamMode,
      photo,
      pickPhoto,
      photoNote,
      setPhotoNote,
      savePhoto: () => {
        if (live) {
          if (!photo) return say(t("Take or pick a photo first"));
          const mode = t(PHOTO_MODES[camMode] ?? "Photo");
          const when = new Date().toLocaleString(intlLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          const note = [photoNote.trim(), t("Captured as {mode}", { mode })].filter(Boolean).join("\n\n");
          const title = `${mode} ${when}`;
          const id = addCapture({ title, img: { uri: photo.uri }, step: t("Uploading") });
          void sendJob(id, { kind: "file", title, uri: photo.uri, name: photo.name, mimeType: photo.mimeType, note }, t("Photo in the Inbox · Kortex is reading it"));
          setPhoto(null);
          setPhotoNote("");
          setShot(false);
          return;
        }
        addCapture({ title: t("Photo: whiteboard sketch"), img: IMG.meeting, step: t("Gemini Vision is analysing") });
        setShot(false);
        say(t("Photo in the Inbox · Gemini Vision links it to {meeting}", { meeting: "Q4 Architektur-Sync" }));
      },
      sets,
      toggleSet: (i) => setSets((s) => s.map((x, j) => (j === i ? !x : x))),
      themePref,
      cycleTheme: () => setThemePref((p) => (p + 1) % 3),
      defModel,
      cycleDefModel: () => setDefModel((m) => (m + 1) % 3),
      accent,
      setAccent,
      haptics,
      toggleHaptics: () => setHaptics((h) => !h),
      toast,
      toastAction,
      say,
      menu,
      openMenu: setMenu,
      closeMenu: () => setMenu(null),
    };
  }, [q, chip, scope, view, sort, sortOpen, sheet, energy, saved, daily, dailyDays, dailyEnergy, mockFocus, data.tasks, journalText, journalState, cardsDone, model, msgs, thinking, autonomy, agentStep, decideProposal, undoAnswer, askText, askRec, inboxP, caps, newInbox, fan, hot, pressed, cap, vSec, noteText, noteTag, shot, camMode, photo, photoNote, pickPhoto, sets, themePref, defModel, accent, haptics, toast, toastAction, menu, say, ask, openCap, saveVoice, addCapture, live, voice, sendJob, pendingCount, flushQueue, queue, data.jobs, locale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useApp must be used inside <AppProvider>");
  return s;
}
