"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Kbd } from "@kortex/ui";
import {
  detectIntent,
  orbitCanSend,
  orbitMicLabel,
  orbitStep,
  type OrbitEffect,
  type OrbitEvent,
  type OrbitState,
} from "@kortex/db/orbit";
import { appendMindDump } from "@/components/home/daily";
import { createActionItem } from "@/lib/api/actions";
import { chatAction } from "@/lib/api/client";
import { optionLabel } from "@/lib/typed/fields";
import { todayIso } from "@/lib/date/today";
import { countLinkedContext } from "@/lib/shell/linked-context";
import { useNotes } from "@/lib/notes/store";
import { useSettings } from "@/lib/settings/store";
import { useCapture } from "@/lib/shell/capture";
import type { CaptureTypeHint } from "@/lib/shell/capture-core";
import { fmtSec } from "@/lib/shell/copilot";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import {
  applyMention,
  barHint,
  commandQuery,
  detectMention,
  domainOf,
  dropLabel,
  editorPrefill,
  enterAction,
  filterCommands,
  focusSuggestions,
  matchObjects,
  matchTags,
  nextEnabled,
  parseCommand,
  planCapture,
  recordingHint,
  routeTranscript,
  splitLink,
  COMMAND_SKILL,
  type CaptureTarget,
  type OrbitCommand,
  type Suggestion,
} from "@/lib/shell/orbit";
import { useShellStatus } from "@/lib/shell/status";
import { useShell } from "@/lib/shell/store";
import { ALL_ITEMS, NOTE_TYPES, OBJECT_ITEMS, RECENT_NOTE_IDS, isLiveData, noteById } from "@/lib/workspace-data";
import { msg, t, tn, tx } from "@/i18n";
import { Ico, type IconId } from "./icons";
import { ModelMenu } from "./ModelMenu";
import { AutonomyMenu, ScopeMenu, TargetMenu, useSpaceContext } from "./TargetMenu";
import { useAsk } from "./useAsk";
import { LiveWave } from "./Wave";
import { LiveMeetingChip } from "@/components/meeting/LiveMeetingChip";
import { usePathname, useRouter } from "next/navigation";
import { AGENT_SKILL_INFO, skillOfCommand } from "@/lib/agent-skills";
import { parseStandingOrder } from "@/lib/agent-jobs";
import { AGENT_JOB_EVENT, AGENT_ORDER_EVENT, putAgentJob, useAgentJobs } from "@/lib/shell/agent-jobs-store";
import { addStandingOrder, startAgentJob } from "@/server/agent/actions";
import { DesktopMeetingChip } from "@/components/meeting/DesktopMeetingChip";
import { useDesktopMeeting } from "@/lib/shell/desktop-bridge";

/*
 * Orbit-Bar (W9, Tactile Craft decision 9; click dummy `Orbit`): a flat acrylic capsule (Level 2,
 * .tc-float recipe) at the bottom of the canvas, with an accent glow that breathes on focus, voice
 * and drop.
 *   micro orb (accent ring) · segment Festhalten | Fragen (inset track, sliding thumb) · field
 *   (link chip) · Ziel-Chip / Suchbereich-Chip · Modell-Chip · attach · send (the one accent fill, with content)
 * Feinschliff Live: AppShell renders it in the row that holds list and editor, so it floats centred over both;
 * the look (ring mic, tinted segment, quiet send) is in packages/ui/src/styles/fs-chrome.css.
 * Above the capsule: `/` commands, @Objekte / #Tags, focus quick actions; the answer card is
 * CopilotPanel. The mode follows the input (detectIntent after 150 ms) until the user pins it
 * (segment, Tab, "?"). State machine: @kortex/db/orbit; routing: lib/shell/orbit.
 * Enter sends, Shift/Ctrl/Cmd+Enter opens the editor with the text, Esc clears; "/" anywhere focuses.
 */

const DETECT_DELAY_MS = 150;
const PTT_HOLD_MS = 380;
const OBJECT_KIND: Record<string, string> = {
  person: msg("Person"),
  project: msg("Project"),
  organization: msg("Organization"),
  concept: msg("Concept"),
  tool: msg("Tool"),
  asset: msg("Asset"),
  goal: msg("Goal"),
};

function RecClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="kx-orbit-timer">{fmtSec(Math.max(0, Math.floor((now - startedAt) / 1000)))}</span>;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

type ListRow = { key: string; label: string; help?: string; disabled?: string; render: "cmd" | "obj" | "tag"; cmd?: OrbitCommand; insert?: string };

/** Glyphs of the dragged files (by MIME type), at most three, for the stacked drop preview. */
function dropGlyphs(dt: DataTransfer | null): { files: number; icons: IconId[] } {
  const items = Array.from(dt?.items ?? []).filter((i) => i.kind === "file");
  const icons = items.slice(0, 3).map<IconId>((i) => (i.type.startsWith("image/") ? "orbit-image" : "file-text"));
  while (icons.length < 3) icons.push(icons.length === 1 ? "orbit-image" : icons.length === 2 ? "link" : "file-text");
  return { files: items.length, icons };
}

export function Footbar({
  liveDock,
  onLiveExpand,
  onLiveHide,
}: {
  liveDock: boolean;
  onLiveExpand: () => void;
  /** Closes the meeting (card and chip) until a newer one comes. */
  onLiveHide: () => void;
}) {
  const shell = useShell();
  const {
    rec,
    startRec,
    stopRec,
    startMeeting,
    stopMeeting,
    recStream,
    cmode,
    setCmode,
    pinned,
    setPinned,
    captureTarget,
    copilot,
    setCopilot,
    showToast,
    prompt,
    setPrompt,
    transcript,
    takeTranscript,
    openNewNote,
    openNote,
    drawer,
  } = shell;
  const { local } = useSettings();
  const askCopilot = useAsk();
  const router = useRouter();
  const onAgentPage = (usePathname() ?? "").startsWith("/agent");
  const { jobs: agentJobs } = useAgentJobs();
  const runningJobs = agentJobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const { capture, captureData } = useCapture();
  const copilotChat = useCopilotChat();
  // The item map is read only while a list needs it (@ mentions, note-mode ghost context): the tracked notes store then
  // leaves the Orbit-Bar alone while the user types in a note (fx2-perf).
  const notes = useNotes();
  const { applyMetadata } = notes;
  const space = useSpaceContext();
  const { meeting: liveMeeting, refresh: refreshStatus } = useShellStatus();
  const desktopRec = useDesktopMeeting();
  // A native meeting started or ended: the meeting chip (server status) follows right away.
  useEffect(() => {
    if (desktopRec.available) refreshStatus();
  }, [desktopRec.available, desktopRec.recording, refreshStatus]);
  /** Starts a job in the background and shows it on the agent's page. */
  const startJob = useCallback(
    async (prompt: string, skill?: (typeof AGENT_SKILL_INFO)[number]["id"]) => {
      if (!copilotChat.live) return showToast(t("The agent needs an account (not available in mock mode)"));
      const r = await startAgentJob({ prompt, autonomy: copilotChat.autonomy, ...(skill ? { skill } : {}) });
      if (!r.ok) return showToast(t("The agent could not start: {error}", { error: r.error }));
      putAgentJob(r.data);
      window.dispatchEvent(new CustomEvent(AGENT_JOB_EVENT, { detail: r.data.id }));
      if (!onAgentPage) router.push(`/agent?job=${r.data.id}`);
    },
    [copilotChat.live, copilotChat.autonomy, onAgentPage, router, showToast],
  );
  /**
   * A question or a request in "Fragen". "Jeden Morgen um 6 …" becomes a standing order; on the agent's page a
   * request runs as a job in the background; everywhere else the copilot answers in place.
   */
  const ask = useCallback(
    (text: string) => {
      if (parseStandingOrder(text)) {
        if (!copilotChat.live) return showToast(t("The agent needs an account (not available in mock mode)"));
        void addStandingOrder(text).then((r) => {
          if (!r.ok) return showToast(t("Standing order not created: {error}", { error: r.error }));
          window.dispatchEvent(new CustomEvent(AGENT_ORDER_EVENT));
          showToast(t("Standing order created"), onAgentPage ? undefined : { label: t("Open"), run: () => router.push("/agent") });
        });
        return;
      }
      if (onAgentPage) return void startJob(text);
      askCopilot(text);
    },
    [askCopilot, copilotChat.live, onAgentPage, router, showToast, startJob],
  );
  const answering = copilotChat.live && (copilotChat.status === "submitted" || copilotChat.status === "streaming");
  const [dragging, setDragging] = useState<{ files: number; icons: IconId[] } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [clip, setClip] = useState<{ granted: boolean; text: string | null }>({ granted: false, text: null });
  const field = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const hold =useRef<ReturnType<typeof setTimeout> | null>(null);
  const ptt = useRef(false);
  const wasRec = useRef(false);

  const state: OrbitState = useMemo(
    () => ({
      text: link ? `${link} ${prompt}`.trim() : prompt,
      mode: cmode,
      pinned,
      kind: link ? "link" : (detectIntent(prompt)?.kind ?? null),
      recording: !!rec,
      sendVoiceImmediately: local.voiceSend,
    }),
    [prompt, link, cmode, pinned, rec, local.voiceSend],
  );

  const objectNames = useCallback(() => OBJECT_ITEMS.map((o) => o.title), []);

  /** Capture by the Ziel-Chip: ingest (note / link, with #tags and [[objects]]), Tagesnotiz or a task. */
  const runCapture = useCallback(
    (
      text: string,
      extra: { title?: string; typeHint?: "voice"; target?: CaptureTarget; note?: string } = {},
    ) => {
      const plan = planCapture(text, extra.target ?? captureTarget, { space, objects: objectNames() });
      if (!plan) return;
      if (plan.to === "ingest") {
        const typeHint = extra.typeHint ?? plan.typeHint;
        const note = extra.note ? planCapture(extra.note, "auto", { objects: objectNames() }) : null;
        const noteText = note && note.to === "ingest" ? note.text : undefined;
        const tags = [...new Set([...(plan.tags ?? []), ...(note && note.to === "ingest" ? (note.tags ?? []) : [])])];
        void capture({
          text: plan.text,
          ...(extra.title ? { title: extra.title } : {}),
          ...(typeHint ? { typeHint: typeHint as CaptureTypeHint } : {}),
          ...(plan.folderPath ? { folderPath: plan.folderPath } : {}),
          ...(tags.length ? { tags } : {}),
          ...(noteText ? { note: noteText } : {}),
        });
        return;
      }
      if (plan.to === "journal") {
        // N5 #10/#11: appended to the workspace day's note, merged onto its current state at save time.
        appendMindDump(todayIso(), plan.text, () => showToast(t("Mind dump saved only locally")));
        showToast(t("In the daily note: mind dump added"));
        return;
      }
      if (!isLiveData()) {
        showToast(t("Task created: {title}", { title: plan.title.slice(0, 60) }));
        return;
      }
      void createActionItem({ title: plan.title }).then((r) =>
        showToast(r.ok ? t("Task created: {title}", { title: plan.title.slice(0, 60) }) : t("Task not created: {error}", { error: r.error })),
      );
    },
    [captureTarget, space, objectNames, capture, showToast],
  );

  const clearField = useCallback(() => {
    setLink(null);
    setPrompt("");
  }, [setPrompt]);

  const runEffect = useCallback(
    (e: OrbitEffect) => {
      switch (e.type) {
        case "announce":
          setAnnounce(e.message);
          break;
        case "capture":
          // A link chip: the URL is the capture, the field text its note.
          if (link) runCapture(link, { note: prompt });
          else runCapture(e.text);
          setLink(null);
          break;
        case "ask":
          ask(e.text);
          setLink(null);
          break;
        case "startRecording":
          startRec("tap");
          break;
        case "stopRecording":
          stopRec(true);
          break;
        case "discardRecording":
          stopRec(false);
          break;
        case "captureFiles":
          break; // the drop handler already started the uploads
      }
    },
    [link, prompt, runCapture, ask, startRec, stopRec],
  );

  /** One event through the shared state machine; the result lands in the shell store. */
  const dispatch = useCallback(
    (event: OrbitEvent) => {
      const { state: next, effects } = orbitStep(state, event);
      if (next.text !== state.text) setPrompt(link && next.text ? prompt : next.text);
      if (next.mode !== state.mode) setCmode(next.mode);
      if (next.pinned !== state.pinned) setPinned(next.pinned);
      effects.forEach(runEffect);
    },
    [state, link, prompt, setPrompt, setCmode, setPinned, runEffect],
  );

  // Detection after a 150 ms typing pause (also after paste); the field updates at once.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => {
      typed.current = false;
      if (!link && commandQuery(prompt) === null) dispatch({ type: "input", text: prompt });
    }, DETECT_DELAY_MS);
    return () => clearTimeout(t);
  }, [prompt, link, dispatch]);

  // A finished transcription goes by intent (lib/shell/orbit routeTranscript).
  useEffect(() => {
    if (!transcript) return;
    takeTranscript(transcript.id);
    const plan = routeTranscript(transcript.text, {
      purpose: transcript.purpose,
      pinned,
      mode: cmode,
      sendVoiceImmediately: local.voiceSend,
    });
    if (!plan) {
      showToast(t("Nothing understood"));
      return;
    }
    if (plan.to === "capture") runCapture(plan.text, { title: transcript.title, typeHint: "voice" });
    else if (plan.to === "ask") ask(plan.text);
    else {
      // Never overwrite what the user typed while the transcript was in flight.
      setPrompt(prompt.trim() ? `${prompt.trimEnd()} ${plan.text}` : plan.text);
      if (plan.mode !== cmode) setCmode(plan.mode);
      if (plan.auto) setAnnounce(t("Mode: {mode}, detected automatically", { mode: plan.mode === "ask" ? tx("mode", "Ask") : tx("mode", "Capture") }));
      field.current?.focus();
    }
  }, [transcript, takeTranscript, prompt, pinned, cmode, local.voiceSend, runCapture, ask, setPrompt, setCmode, showToast]);

  // Recording announcements (aria-live), also for Ctrl+Shift+Space and the palette.
  const recording = !!rec;
  const wasRecording = useRef(recording);
  useEffect(() => {
    if (wasRecording.current !== recording) setAnnounce(recording ? t("Recording in progress") : t("Recording ended"));
    wasRecording.current = recording;
  }, [recording]);

  // "/" anywhere outside a text field focuses the bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      e.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drag-over anywhere: the capsule grows and invites the drop (the drop itself only on the bar).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(dropGlyphs(e.dataTransfer));
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(null);
    };
    const end = () => {
      depth = 0;
      setDragging(null);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, []);

  // Clipboard for the focus quick action: read silently only when the permission is already granted.
  const readClipboard = useCallback(async (prompted: boolean): Promise<string | null> => {
    try {
      if (!prompted) {
        const perm = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName });
        if (perm?.state !== "granted") return null;
      }
      const text = await navigator.clipboard.readText();
      setClip({ granted: true, text });
      return text;
    } catch {
      return null;
    }
  }, []);

  // ---- lists above the capsule -------------------------------------------------------------
  const cmdOpen = !link && !rec && commandQuery(prompt) !== null;
  const mention = !link && !rec && focused ? detectMention(prompt, caret) : null;
  // @ searches every entity (all item types), like the editor's @; objects alone only before items are loaded.
  const poolItems = mention?.sig === "@" ? notes.items : null;
  const mentionPool = useMemo(() => {
    const all = poolItems ? Object.values(poolItems) : [];
    return all.length ? all : OBJECT_ITEMS;
  }, [poolItems]);
  // Ghost context: links of the open note that go to the copilot as background (note mode).
  // Shown only in Fragen (askMode below), so only then does the Orbit-Bar follow edits of the open note.
  const ghostItems = cmode === "ask" && copilotChat.mode === "note" && copilotChat.scope.itemId ? notes.items : null;
  const ghostCount = useMemo(() => {
    const id = copilotChat.scope.itemId;
    const note = id && ghostItems ? ghostItems[id] : undefined;
    return id && note && ghostItems ? countLinkedContext(note.contentMd ?? "", id, Object.values(ghostItems)) : 0;
  }, [copilotChat.scope.itemId, ghostItems]);
  const rows: ListRow[] = useMemo(() => {
    if (cmdOpen) {
      const list = filterCommands(prompt);
      // In "Fragen" the agent's skills come first, in "Festhalten" the capture commands.
      const skillFirst = (c: OrbitCommand) => (skillOfCommand(c.id) ? 0 : 1);
      const sorted = cmode === "ask" ? [...list].sort((a, b) => skillFirst(a) - skillFirst(b)) : list;
      return sorted.map((c) => ({ key: c.cmd, label: c.label, disabled: c.disabled, render: "cmd" as const, cmd: c }));
    }
    if (!mention) return [];
    if (mention.sig === "@")
      return matchObjects(mentionPool, mention.query).map((o) => ({
        key: o.id,
        label: o.title,
        help: (OBJECT_KIND[o.type] ? t(OBJECT_KIND[o.type]!) : undefined) ?? NOTE_TYPES[o.type as keyof typeof NOTE_TYPES]?.label ?? t("Object"),
        render: "obj" as const,
        insert: "@" + o.title,
      }));
    return matchTags(
      ALL_ITEMS.flatMap((n) => n.tags),
      mention.query,
    ).map((t) => ({ key: t, label: "#" + t, help: "Hashtag", render: "tag" as const, insert: "#" + t }));
  }, [cmdOpen, prompt, mention, mentionPool, cmode]);
  const listOpen = rows.length > 0;
  const activeRow = Math.min(active, Math.max(0, rows.length - 1));
  useEffect(() => setActive((a) => (rows[a] && !rows[a]!.disabled ? a : Math.max(0, nextEnabled(rows, -1, 1)))), [rows]);

  const recent = useMemo(() => {
    const id = RECENT_NOTE_IDS.find((x) => x !== drawer.id);
    const n = id ? noteById(id) : undefined;
    return n ? { id: n.id, title: n.title } : null;
  }, [drawer.id]);
  const suggOpen = focused && !prompt && !link && !rec && !dragging && !listOpen && !copilot;
  const suggestions = suggOpen ? focusSuggestions({ clipboard: clip.text, recent }) : [];
  // Key hints only show while they fit next to the chips: chips keep their room, nothing overlaps at any width.
  const suggRef = useRef<HTMLDivElement>(null);
  const suggKey = suggestions.map((x) => x.kind + x.label).join("|");
  useLayoutEffect(() => {
    const el = suggRef.current;
    if (!el) return;
    const fit = () => {
      const keys = el.querySelector<HTMLElement>(".kx-orbit-keys");
      if (!keys) return;
      const chips = [...el.querySelectorAll<HTMLElement>(".kx-orbit-suggchip")];
      const gap = 6;
      // Natural chip width: padding + icon + gap + full label (capped like the CSS max-width).
      const chipsW = chips.reduce((sum, c) => {
        const label = c.querySelector<HTMLElement>("span");
        return sum + Math.min(260, 20 + 14 + 5 + (label?.scrollWidth ?? 0)) + gap;
      }, 0);
      keys.classList.toggle("is-off", chipsW + keys.scrollWidth + gap > el.clientWidth);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [suggOpen, suggKey, cmode]);
  useEffect(() => {
    if (focused && !prompt) void readClipboard(false);
  }, [focused, prompt, readClipboard]);

  // ---- actions -------------------------------------------------------------------------------
  const toEditor = (text: string) => {
    const t = text.trim();
    openNewNote(link ? { title: domainOf(link), body: [link, t].filter(Boolean).join("\n\n") } : t ? editorPrefill(t) : undefined);
    clearField();
    dispatch({ type: "escape" });
  };

  const insertCommand = (c: OrbitCommand) => {
    setPrompt(c.cmd + " ");
    requestAnimationFrame(() => field.current?.focus());
  };

  /** "/status Dune gesehen, 9/10": the server finds the entry and saves status, rating and feedback (never a new note). */
  const runStatus = async (text: string) => {
    if (!isLiveData()) {
      showToast(t("Status by AI needs an account (not available in mock mode)"));
      return;
    }
    try {
      const res = await chatAction({ action: "status", content_md: text, save: true });
      if (res.action !== "status" || !("metadata" in res)) throw new Error(t("Unexpected answer"));
      applyMetadata(res.item_id, res.metadata);
      const s = typeof res.metadata.status === "string" ? ` · ${optionLabel(res.metadata.status)}` : "";
      showToast(t("“{title}” updated", { title: res.title }) + s);
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : t("The status could not be set"));
    }
  };

  const runCommand = (c: OrbitCommand, arg: string) => {
    if (c.disabled) {
      showToast(c.disabled);
      return;
    }
    switch (c.id) {
      case "notiz":
        openNewNote(arg ? editorPrefill(arg) : undefined);
        clearField();
        return;
      case "aufgabe":
        if (!arg) return insertCommand(c);
        runCapture(arg, { target: "task" });
        clearField();
        return;
      case "link": {
        if (!arg) return insertCommand(c);
        const sp = splitLink(arg);
        if (!sp) {
          showToast(t("Not a valid link (https://…)"));
          return;
        }
        runCapture(sp.url, { note: sp.rest });
        clearField();
        return;
      }
      case "meeting":
        clearField();
        // Windows app: the native meeting recording (mic + system sound, HUD pill on minimize).
        startMeeting();
        return;
      case "status":
        if (!arg) return insertCommand(c);
        clearField();
        void runStatus(arg);
        return;
      case "frage":
        setPrompt(arg);
        setCmode("ask");
        setPinned(true);
        return;
      case "objekt":
        return;
      default: {
        // Agent skills (/briefing, /recherche …): the request goes to the copilot with the skill set.
        const skill = COMMAND_SKILL[c.id];
        if (!skill) return;
        if (c.arg && !arg) return insertCommand(c);
        if (!copilotChat.live) {
          showToast(t("The agent needs an account (not available in mock mode)"));
          return;
        }
        clearField();
        // On the agent's page a skill runs as a job in the background, elsewhere the copilot answers in place.
        if (onAgentPage) {
          const info = skillOfCommand(c.id);
          void startJob(arg || (info?.prompt ? t(info.prompt) : c.cmd), skill);
          return;
        }
        copilotChat.send(arg ? `${c.cmd} ${arg}` : c.cmd, { skill });
        return;
      }
    }
  };

  const pickRow = (r: ListRow | undefined) => {
    if (!r || r.disabled) {
      if (r?.disabled) showToast(r.disabled);
      return;
    }
    if (r.render === "cmd" && r.cmd) {
      const parsed = parseCommand(prompt);
      runCommand(r.cmd, parsed && parsed.command.id === r.cmd.id ? parsed.arg : "");
      return;
    }
    if (mention && r.insert) {
      const next = applyMention(prompt, mention, r.insert);
      setPrompt(next.text);
      setCaret(next.caret);
      requestAnimationFrame(() => {
        field.current?.setSelectionRange(next.caret, next.caret);
        field.current?.focus();
      });
    }
  };

  const send = () => {
    if (cmdOpen) {
      const parsed = parseCommand(prompt);
      if (parsed) runCommand(parsed.command, parsed.arg);
      else pickRow(rows[activeRow]);
      return;
    }
    dispatch({ type: "submit" });
  };

  const runSuggestion = async (s: Suggestion) => {
    if (s.kind === "clipboard") {
      setLink(s.url);
      field.current?.focus();
    } else if (s.kind === "continue") openNote(s.id);
    else {
      dispatch({ type: "segment", mode: "ask" });
      field.current?.focus();
    }
  };
  const pasteFromClipboard = async () => {
    const text = await readClipboard(true);
    if (!text) {
      showToast(t("Clipboard not readable"));
      return;
    }
    const sp = splitLink(text);
    if (sp) {
      setLink(sp.url);
      setPrompt(sp.rest);
    } else setPrompt(text);
    field.current?.focus();
  };

  // ---- orb: a tap toggles the recording, holding it longer than 380 ms is push-to-talk ------
  const orbDown = () => {
    if (rec) {
      wasRec.current = true;
      return;
    }
    wasRec.current = false;
    ptt.current = false;
    if (hold.current) clearTimeout(hold.current);
    hold.current = setTimeout(() => {
      ptt.current = true;
      startRec("ptt");
    }, PTT_HOLD_MS);
  };
  const orbUp = () => {
    if (hold.current) {
      clearTimeout(hold.current);
      hold.current = null;
    }
    if (wasRec.current || ptt.current) {
      wasRec.current = false;
      ptt.current = false;
      stopRec(true);
      return;
    }
    dispatch({ type: "mic" });
  };
  const orbLeave = () => {
    if (hold.current) {
      clearTimeout(hold.current);
      hold.current = null;
    }
    if (ptt.current) {
      ptt.current = false;
      stopRec(true);
    }
  };
  const orbKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (rec) stopRec(true);
    else dispatch({ type: "mic" });
  };

  const onFieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (listOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const at = nextEnabled(rows, activeRow, e.key === "ArrowDown" ? 1 : -1);
      if (at >= 0) setActive(at);
      return;
    }
    const enter = enterAction(e);
    if (enter) {
      e.preventDefault();
      if (enter === "editor") return toEditor(prompt);
      if (mention && listOpen) return pickRow(rows[activeRow]);
      return send();
    }
    if (e.key === "Tab" && !e.shiftKey) {
      // A list open: Tab takes the row. Otherwise Tab switches the mode and pins it; Shift+Tab leaves.
      e.preventDefault();
      if (listOpen && !cmdOpen) pickRow(rows[activeRow]);
      else if (cmdOpen) {
        const r = rows[activeRow];
        if (r?.cmd && !r.disabled) setPrompt(r.cmd.cmd + " ");
      } else dispatch({ type: "tab" });
      return;
    }
    if (e.key === "Backspace" && link && !prompt && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      setLink(null);
      return;
    }
    if (e.key === "Escape") {
      if (listOpen && mention) {
        // First Esc closes the @/# list (by moving the caret token out of reach).
        e.preventDefault();
        setFocused(false);
        return;
      }
      setLink(null);
      dispatch({ type: "escape" });
      e.currentTarget.blur();
    }
  };

  const canSend = orbitCanSend(state) || cmdOpen;
  const hasContent = !!(prompt.trim() || link);
  const hint = barHint(state, captureTarget);
  const recState: OrbitState = { ...state, mode: rec?.purpose === "voiceQuestion" ? "ask" : "capture" };
  const micLabel = orbitMicLabel(rec ? { ...recState, recording: true } : state);
  const dataState = dragging
    ? "drop"
    : rec
      ? "voice"
      : cmdOpen
        ? "cmd"
        : listOpen
          ? "mention"
          : suggOpen
            ? "suggest"
            : hasContent
              ? "typing"
              : "rest";
  const askMode = cmode === "ask";
  const sendLabel = askMode ? t("Send question") : tx("mode", "Capture");

  return (
    <div
      className="kx-orbit-wrap"
      // Above the docked meeting card (z 7): the bar's popovers must not slip under it.
      style={{ zIndex: 8 }}
      data-mode={cmode}
      data-state={dataState}
      data-recording={recording || undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.some((t) => t === "Files" || t === "text/uri-list" || t === "text/plain")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragging) setDragging(dropGlyphs(e.dataTransfer));
      }}
      onDrop={(e) => {
        // Files and links dropped on the bar go to the inbox (Festhalten), as before.
        e.preventDefault();
        setDragging(null);
        const n = captureData(e.dataTransfer);
        if (n) dispatch({ type: "drop", files: n });
      }}
    >
      <div className="kx-orbit-glow" aria-hidden />
      <span className="kx-orbit-live" aria-live="polite">
        {announce}
      </span>

      {listOpen && !dragging && (
        <div
          className="kx-orbit-above kx-orbit-list tc-float"
          role="listbox"
          id="kx-orbit-list"
          aria-label={cmdOpen ? t("Commands") : mention?.sig === "@" ? t("Objects") : "Hashtags"}
        >
          <div className="kx-orbit-micro">{cmdOpen ? (cmode === "ask" ? t("Skills and commands") : t("Commands")) : mention?.sig === "@" ? t("Link object") : t("Set hashtag")}</div>
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              role="option"
              id={`kx-orbit-opt-${i}`}
              aria-selected={i === activeRow}
              aria-disabled={r.disabled ? true : undefined}
              title={r.disabled}
              tabIndex={-1}
              className={"kx-orbit-mi" + (i === activeRow ? " is-active" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => !r.disabled && setActive(i)}
              onClick={() => pickRow(r)}
            >
              {r.render === "cmd" && r.cmd && skillOfCommand(r.cmd.id) ? (
                (() => {
                  const sk = skillOfCommand(r.cmd.id)!;
                  return (
                    <>
                      <span className="kx-orbit-skill" style={{ "--gc": sk.tint } as CSSProperties} aria-hidden>
                        <Ico name={sk.icon} size={14} />
                      </span>
                      <span className="kx-orbit-mi-text">
                        <span className="kx-truncate kx-orbit-mi-strong">{t(sk.label)}</span>
                        <span className="kx-orbit-mi-help kx-truncate">{t(sk.help)}</span>
                      </span>
                      <small className="kx-orbit-cmd">{r.cmd.cmd}</small>
                    </>
                  );
                })()
              ) : r.render === "cmd" && r.cmd ? (
                <>
                  <span className="kx-orbit-glyph" aria-hidden>
                    <Ico name={r.cmd.icon} size={11} />
                  </span>
                  <span className="kx-orbit-cmd">{r.cmd.cmd}</span>
                  <span className="kx-truncate kx-orbit-mi-dim">{r.label}</span>
                  {r.cmd.keys && (
                    <small>
                      <Kbd size="sm">{r.cmd.keys}</Kbd>
                    </small>
                  )}
                </>
              ) : (
                <>
                  <span className={"kx-orbit-glyph" + (r.render === "obj" ? " is-avatar" : "")} aria-hidden>
                    {r.render === "obj" ? initials(r.label) : <Ico name="hash" size={11} />}
                  </span>
                  <span className="kx-truncate kx-orbit-mi-strong">{r.label}</span>
                  <small>{r.help}</small>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {suggOpen && (
        <div ref={suggRef} className="kx-orbit-above kx-orbit-sugg">
          {suggestions.map((s) => (
            <button
              key={s.kind}
              type="button"
              className="kx-orbit-suggchip tc-glass"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void runSuggestion(s)}
            >
              <Ico name={s.kind === "clipboard" ? "clipboard" : s.kind === "continue" ? "file-text" : "orbit-sparkles"} size={14} />
              <span className="kx-truncate">{s.label}</span>
            </button>
          ))}
          {!suggestions.some((s) => s.kind === "clipboard") && (
            <button
              type="button"
              className="kx-orbit-suggchip tc-glass"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pasteFromClipboard()}
            >
              <Ico name="clipboard" size={14} />
              <span className="kx-truncate">{t("From clipboard")}</span>
            </button>
          )}
          <span className="kx-orbit-grow" />
          <span className="kx-orbit-keys" aria-hidden>
            <Kbd size="sm">↵</Kbd> {askMode ? tx("mode", "Ask") : tx("mode", "Capture")} <Kbd size="sm">⇧↵</Kbd> {t("As note")} <Kbd size="sm">/</Kbd> {t("Commands")}
          </span>
        </div>
      )}

      <div className={"kx-orbit tc-float" + (dragging ? " is-drop" : "")}>
        {dragging ? (
          <div className="kx-orbit-drop">
            <div className="kx-orbit-dropfiles" aria-hidden>
              {dragging.icons.map((ic, i) => (
                <span key={i} className="kx-orbit-df">
                  <Ico name={ic} size={16} />
                </span>
              ))}
            </div>
            <div className="kx-orbit-drop-t">
              {t("Drop to capture")} <span>· {dropLabel(dragging.files)}</span>
            </div>
            <div className="kx-orbit-drop-m">{t("PDF and EPUB are read, images captured by OCR, text becomes a note")}</div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={"kx-orbit-orb kx-orbit-mic" + (rec ? " is-rec" : "")}
              aria-label={micLabel}
              title={`${micLabel} · ${t("Hold: push-to-talk")} · Ctrl+Shift+Space`}
              onPointerDown={orbDown}
              onPointerUp={orbUp}
              onPointerLeave={orbLeave}
              onKeyDown={orbKey}
            >
              <Ico name={rec ? "square" : "orbit-mic"} size={rec ? 14 : 20} />
            </button>

            {rec ? (
              <div className="kx-orbit-ofield kx-orbit-rec">
                <RecClock startedAt={rec.startedAt} />
                <LiveWave stream={recStream} />
                <span className="kx-orbit-rec-hint">
                  <em>{t("Voice note …")}</em> {recordingHint(recState, rec.mode === "ptt")}
                </span>
                <button type="button" className="kx-orbit-discard" onClick={() => stopRec(false)}>
                  {t("Discard")}
                </button>
              </div>
            ) : (
              <>
                <div className="kx-orbit-seg" data-mode={cmode} role="tablist" aria-label={t("Mode")}>
                  <span className="kx-orbit-thumb" aria-hidden />
                  {(
                    [
                      ["capture", tx("mode", "Capture"), "plus"],
                      ["ask", tx("mode", "Ask"), "orbit-sparkles"],
                    ] as const
                  ).map(([mode, label, icon]) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={cmode === mode}
                      title={label + "  Tab"}
                      onClick={() => {
                        dispatch({ type: "segment", mode });
                        if (mode === "capture") shell.setModelOpen(false);
                      }}
                    >
                      <Ico name={icon} size={14} />
                      <span className="kx-orbit-seg-label">{label}</span>
                    </button>
                  ))}
                </div>
                <div className="kx-orbit-ofield">
                  {link && (
                    <span className="kx-orbit-linkchip" title={link}>
                      <span className="kx-orbit-glyph" aria-hidden>
                        <Ico name="globe" size={11} />
                      </span>
                      <span className="kx-truncate">{domainOf(link)}</span>
                      <button type="button" className="kx-orbit-x" aria-label={t("Remove link")} onClick={() => setLink(null)}>
                        <Ico name="x" size={11} />
                      </button>
                    </span>
                  )}
                  <input
                    ref={field}
                    className="kx-orbit-field"
                    aria-label={askMode ? t("Ask your second brain") : t("Capture a thought")}
                    aria-autocomplete="list"
                    aria-controls={listOpen ? "kx-orbit-list" : undefined}
                    aria-activedescendant={listOpen ? `kx-orbit-opt-${activeRow}` : undefined}
                    placeholder={link ? t("Note on the link (optional)") : askMode ? t("Question or job, / for skills") : t("Thought, idea, link …")}
                    value={prompt}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setTimeout(() => setFocused(false), 120)}
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                    onChange={(e) => {
                      typed.current = true;
                      setFocused(true);
                      const v = e.target.value;
                      setCaret(e.target.selectionStart ?? v.length);
                      const sp = !link ? splitLink(v) : null;
                      // A URL at the start becomes the link chip once it is complete (space or paste).
                      if (sp && (sp.rest || /\s$/.test(v) || v.length - prompt.length > 8)) {
                        setLink(sp.url);
                        setPrompt(sp.rest);
                        if (!pinned && cmode !== "capture") setCmode("capture");
                        return;
                      }
                      setPrompt(v);
                    }}
                    onKeyDown={onFieldKey}
                  />
                </div>
                <div className="kx-orbit-opt">
                  {askMode && ghostCount > 0 && (
                    <span className="kx-orbit-ghost" title={t("Linked items of the note go into the answer as background")}>
                      <Ico name="link" size={11} />
                      {tn(ghostCount, "Context: {n} linked item", "Context: {n} linked items")}
                    </span>
                  )}
                  {askMode ? <ScopeMenu /> : <TargetMenu onNewNote={() => toEditor(prompt)} />}
                  {askMode && <AutonomyMenu />}
                  {!askMode && <ModelMenu />}
                  {runningJobs > 0 && !onAgentPage && (
                    <button
                      type="button"
                      className="kx-orbit-chip kx-orbit-jobchip"
                      title={tn(runningJobs, "{n} job is running", "{n} jobs are running")}
                      aria-label={tn(runningJobs, "{n} job is running", "{n} jobs are running")}
                      onClick={() => router.push("/agent")}
                    >
                      <span className="kx-spinner" aria-hidden />
                      <span className="kx-num">{runningJobs}</span>
                    </button>
                  )}
                  {/* Feinschliff Live: attach instead of the Scratchpad shortcut (that sits in the titlebar, Neu menu
                      and on Alt+J). Files go to the inbox like a drop on the bar. */}
                  <button
                    type="button"
                    className="tc-ibtn kx-orbit-attach"
                    aria-label={t("Attach file")}
                    title={t("Attach file, image or PDF")}
                    onClick={() => attachRef.current?.click()}
                  >
                    <Ico name="paperclip" size={15} />
                  </button>
                  <input
                    ref={attachRef}
                    type="file"
                    hidden
                    multiple
                    accept=".pdf,.epub,.md,.markdown,.txt,image/*"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])];
                      e.target.value = "";
                      for (const f of files) void capture({ file: f });
                    }}
                  />
                </div>
                {askMode && (
                  <button
                    type="button"
                    className="tc-ibtn kx-orbit-history"
                    aria-label={t("Expand or collapse copilot history")}
                    aria-expanded={copilot}
                    onClick={() => setCopilot(!copilot)}
                  >
                    <Ico name={copilot ? "chev-d" : "chev-u"} />
                  </button>
                )}
              </>
            )}

            {rec ? (
              <button
                type="button"
                className="kx-orbit-orb kx-orbit-send is-ready"
                aria-label={t("Stop recording and accept")}
                title={t("Stop recording")}
                onClick={() => stopRec(true)}
              >
                <Ico name="send" size={16} />
              </button>
            ) : askMode && answering && !hasContent ? (
              <button
                type="button"
                className="kx-orbit-orb kx-orbit-send"
                aria-label={t("Stop answer")}
                title={t("Stop answer")}
                onClick={copilotChat.stop}
              >
                <Ico name="stop" />
              </button>
            ) : (
              <button
                type="button"
                className={"kx-orbit-orb kx-orbit-send" + (hasContent ? " is-ready" : "")}
                aria-label={sendLabel}
                title={`${sendLabel}${hint ? " " + hint : ""} (Enter)`}
                aria-disabled={!canSend}
                onClick={() => canSend && send()}
              >
                <Ico name="corner-down-left" size={16} />
              </button>
            )}
          </>
        )}

        {/* W1 (package D): chip with running clock and hover preview, components/meeting. */}
        {liveDock && liveMeeting && !dragging && <LiveMeetingChip meeting={liveMeeting} onExpand={onLiveExpand} onHide={onLiveHide} />}
        {/* Windows app: the native meeting recording runs (Orbit-Bar /meeting, tray, hotkey); minimized it is the HUD pill. */}
        {desktopRec.recording && !dragging && (
          <DesktopMeetingChip startedAt={desktopRec.startedAt} showClock={!(liveDock && liveMeeting?.live)} onStop={stopMeeting} />
        )}
      </div>
    </div>
  );
}

