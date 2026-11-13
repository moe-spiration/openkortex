import { msg, t } from "@/i18n";
import type { DIconId } from "./components/icons";

/*
 * Static texts of the desktop app (Desktop.dc.html renderVals()). The meeting HUD and pill use no
 * content from here (H1): transcript, coaching and session come from bridge events (live.rs); the
 * Meeting-Center lists real meetings from the vault, devices come from list_audio_devices.
 */

export interface QcAction {
  icon: DIconId;
  label: string;
  hint: string;
  /** Toast after running it; empty = answers inline. */
  done: string;
}

// Labels are getters: the text follows the language at the time it is read (the shape stays `{ label, done }`).
/** Capture targets of QC_ACTIONS 0..3 (quick_capture `target`), in row order. */
export const QC_TARGETS = ["note", "inbox", "task", "scratchpad"] as const;
/** Row of "Second Brain fragen"; the launcher rows (search, prompt, selection) follow it. */
export const QC_ASK = QC_TARGETS.length;

export const QC_ACTIONS: QcAction[] = [
  {
    icon: "file",
    get label() { return t("Save as note"); },
    hint: "10_Notes",
    get done() { return t("Saved as note in 10_Notes"); },
  },
  {
    icon: "inbox",
    get label() { return t("Drop into Universal Inbox"); },
    hint: "Inbox",
    get done() { return t("Dropped into Universal Inbox"); },
  },
  { icon: "task", get label() { return t("Create as task"); }, hint: "Tasks", get done() { return t("Task created"); } },
  { icon: "file", get label() { return t("Write to scratchpad"); }, hint: "Scratchpad", get done() { return t("Written to scratchpad"); } },
  { icon: "sparkles", get label() { return t("Ask Second Brain"); }, hint: "Hybrid RAG", done: "" },
  // Launcher modes and the selection grab (QuickCapture.tsx runs these, not runQc).
  { icon: "search", get label() { return t("Search the vault"); }, hint: "?", done: "" },
  { icon: "msg", get label() { return t("Insert prompt"); }, hint: ">", done: "" },
  { icon: "clip", get label() { return t("Use selection"); }, hint: "Alt+Shift+Space", done: "" },
];

export const HOTKEYS = [
  { label: msg("Quick capture and ask"), keys: ["Alt", "Space"] },
  { label: msg("Capture selection"), keys: ["Alt", "Shift", "Space"] },
  { label: msg("Live HUD on or off"), keys: ["Ctrl", "Shift", "H"] },
  { label: msg("Start or stop recording"), keys: ["Ctrl", "Shift", "R"] },
  { label: msg("Note with timestamp"), keys: ["Ctrl", "Shift", "N"] },
  { label: msg("Capture a thought (voice note)"), keys: ["Ctrl", "Shift", "Space"] },
];

/** Settings → "Privacy and system" (English sources, shown with `t`; all switches are real: set_stealth, set_autostart, set_reminders). */
export const SYS_OPTS = {
  stealth: [
    msg("Stealth mode"),
    msg("HUD and overlays stay invisible in screen sharing (SetWindowDisplayAffinity)"),
  ],
  autostart: [msg("Start with Windows"), msg("Kortex starts hidden in the tray when you sign in")],
  reminders: [
    msg("Reminders as Windows notifications"),
    msg("Due reminders and radar changes while Kortex runs in the tray (every 15 minutes)"),
  ],
} as const;

export const WIN_TITLES = {
  meetings: msg("Meeting center"),
  audio: msg("Audio setup"),
  settings: msg("Settings"),
} as const;
export type NativeWin = keyof typeof WIN_TITLES;

/** Status line of the tray menu header. */
export function trayStatus(s: { connected: boolean; live: boolean; clock: string; session: string }): string {
  if (s.live) return s.session === "live" ? t("Recording · {clock} · Live sync", { clock: s.clock }) : t("Recording · {clock}", { clock: s.clock });
  return s.connected ? t("Account connected · ready") : t("No account connected (settings)");
}
/** Taskbar clock of the mock desktop. */
export const TASKBAR_TIME = { time: "11:19", date: "22.10.2026" };
