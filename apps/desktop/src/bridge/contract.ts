/*
 * Contract between the React frontend and the Rust core (src-tauri). Command names and payloads
 * mirror src-tauri/src/commands.rs; event names mirror the `emit` calls in audio.rs / recorder.
 * Keep both sides in sync when changing anything here.
 */

import type { Locale } from "@kortex/i18n";
import type { SearchResponse } from "../launcher";

export type HudMode = "pill" | "hud" | "qc" | "off";
export type WindowLabel = "main" | "hud" | "capture" | "tray" | "meetings" | "audio" | "settings";
export type CaptureTarget = "note" | "inbox" | "task" | "scratchpad" | "ask";

/** Live coaching card from POST /api/meeting/coach (the user's meeting_coach route, ADR-06). */
export interface CoachCard {
  kind: "fact" | "question" | "action";
  text: string;
  /** Short headline ("Jetzt guter Moment"), 0.6.8; without it the HUD names the card by its kind. */
  title?: string | null;
  /** The object file the card draws on ("Akte Jonas"), 0.6.8; opens in the main window. */
  object?: CoachObject | null;
}

/** A knowledge item a coaching card refers to (live.rs `CardObject`). */
export interface CoachObject {
  id: string;
  title: string;
  type?: string | null;
}

/** Light / dark of the desktop's own windows: a fixed choice or Windows' setting. */
export type ThemePref = "system" | "light" | "dark";

/** Devices a running recording really uses (Rust `audio::InUse`). */
export interface DevicesInUse {
  mic: string;
  sys?: string | null;
  /** Why another microphone than the Windows default was taken (default delivered only silence). */
  note?: string | null;
}

/** Result of run_selftest (src-tauri/src/selftest.rs). */
export interface SelfTestReport {
  ok: boolean;
  online: boolean;
  source: string;
  seconds: number;
  steps: Array<{ name: string; ok: boolean; detail: string }>;
  report_file?: string | null;
  log_file?: string | null;
}

export interface MeetingState {
  recording: boolean;
  elapsed: number;
  /** Live session in the web app (W1); null without an account or while it opens. */
  item_id?: string | null;
  title?: string | null;
  transcriber?: string | null;
  connected?: boolean;
  /** Stealth mode as the Rust core has it (shared by every window). */
  stealth?: boolean;
  /** Devices of the running recording. */
  devices?: DevicesInUse | null;
}

export interface ChannelLevel {
  /** RMS of the last 50 ms block, 0..1. */
  rms: number;
  /** Same block in dBFS, rounded. */
  db: number;
}

export interface Events {
  /** Recording clock, once per second while a meeting is recorded. */
  "meeting:tick": { elapsed: number };
  /** Recording started / stopped (also when triggered from tray or hotkey). */
  /**
   * `uploading` (after a stop): a result follows as `meeting:upload`; false = nothing follows.
   * `discarded`: the user threw the recording away (no file, no minutes): back to "ready".
   */
  "meeting:state": { recording: boolean; elapsed: number; uploading?: boolean; discarded?: boolean };
  /** Per-channel levels: ch0 = microphone (cpal), ch1 = WASAPI loopback. ~20 Hz from Rust, 1 Hz in the mock. */
  "audio:levels": {
    ch0: ChannelLevel;
    ch1: ChannelLevel;
    /** false = the microphone delivered no non-zero sample for 3 s (muted or a virtual device). */
    mic_signal?: boolean;
  };
  /** Devices of the recording that just started (microphone may differ from the Windows default). */
  "meeting:devices": DevicesInUse;
  /** Self-test asks the HUD what it renders; the HUD answers with `selftest:hud`. */
  "selftest:probe": Record<string, never>;
  /**
   * Self-test presses an HUD / pill button (the real click path): `action` is the HUD mode the
   * button switches to (`data-hud-action`, independent of the language), `label` its aria-label.
   */
  "selftest:click": { label: string; action?: HudMode };
  "selftest:hud": { phase: string; meters: number; lines: number; cards: number; mic_db: number; mode: string };
  /** Self-test finished (report written to the log folder). */
  "selftest:done": { ok: boolean; summary: string; report?: string | null };
  /**
   * Live transcript, channel 0 = me ("Ich"), 1 = remote side. Final lines come from the user's
   * audio_transcription route (~15 s chunks, live.rs) or, with DEEPGRAM_API_KEY, from Deepgram;
   * partial lines only from Deepgram.
   */
  "transcript:partial": { channel: 0 | 1; speaker: string; ts: string; text: string };
  "transcript:final": { channel: 0 | 1; speaker: string; ts: string; text: string };
  /** Live transcription health: listening (with the route's transcriber id), error, off (no account). */
  "transcript:status": { state: "listening" | "error" | "off"; transcriber?: string | null; message?: string | null };
  /** Live session in the web app: connecting → live (item_id) → ended; offline = could not open. */
  "meeting:live": {
    state: "connecting" | "live" | "offline" | "ended";
    item_id?: string | null;
    title?: string | null;
    transcriber?: string | null;
    message?: string | null;
  };
  /** Up to 3 cards after each coaching run (every 45 s with new text, or refresh_coaching). */
  "coaching:cards": { cards: CoachCard[]; at?: string };
  "coaching:status": { state: "idle" | "loading" | "error"; message?: string | null };
  /** Global shortcut Alt+Space pressed (Rust registers it, the frontend toggles the overlay). */
  "shortcut:quick-capture": Record<string, never>;
  /** Ctrl+Shift+R: Rust toggled the recording (natively); the mock lets the frontend toggle. */
  "shortcut:record": { recording?: boolean };
  /** Record-then-upload progress after stop_recording (connected account). */
  "meeting:upload": {
    state: "uploading" | "done" | "error";
    item_id?: string;
    folder_path?: string | null;
    segments?: number;
    message?: string;
    /** Local WAV, for a retry with upload_recording. */
    file?: string;
  };
  /** Voice note upload after stop_voice_note (connected account): transcribed, then a note in the inbox. */
  "voice:upload": {
    state: "uploading" | "done" | "error";
    item_id?: string;
    folder_path?: string | null;
    message?: string;
    /** Local WAV (stays in the recordings folder). */
    file?: string;
  };
  /** Ctrl+Shift+N: focus the timestamped note input in the HUD. */
  "shortcut:note": Record<string, never>;
  /** Ctrl+Shift+Space: voice note in the capture overlay. */
  "shortcut:voice-note": Record<string, never>;
  /**
   * The web app in the main window records with its own microphone (Orbit-Bar dictation,
   * main_bridge.rs): the pill stands for it while the main window is minimized.
   */
  "webrec:state": { recording: boolean };
  /** HUD mode changed from another window (tray menu, hotkey Ctrl+Shift+H, recording start). */
  "hud:mode": { mode: HudMode };
  /** Stealth switched (set_stealth), so every window shows the same state. */
  "settings:stealth": { enabled: boolean };
  /** Theme switched (set_theme): every window follows (the value is also shared through localStorage). */
  "settings:theme": { theme: ThemePref };
  /** Language switched (set_locale): every local window remembers it and reloads to rebuild its texts. */
  "settings:locale": { locale: Locale };
  /** Account connected / disconnected in the settings window (sent by the frontend). */
  "account:changed": { connected: boolean };
  /**
   * Alt+Shift+Space: Rust copied the active app's selection (Ctrl+C, clipboard restored) and opened
   * the launcher. text null = nothing selected; message = why it failed.
   */
  "launcher:selection": { text: string | null; source: string | null; message?: string | null };
  /**
   * A kortex://connect link from the web app arrived and waits for "Verbinden" in the settings window
   * (web = the web app that sent it), or was refused (error).
   */
  "connect:pending": { web: string | null; error: string | null };
  /** The core stopped a forgotten recording (10 min silence or 4 h); the upload runs as after a stop. */
  "meeting:autostop": { reason: "silence" | "max_duration"; message: string; uploading: boolean };
  /** Vault sync status changed (md-sync heartbeat, start, stop, crash; vault.rs). */
  "vault:status": VaultStatus;
}

/**
 * Vault sync (md-sync as the desktop sidecar, vault.rs). `state`:
 * setup = no folder chosen yet · no_account · no_sync_token = the stored credential may not sync
 * (e-mail sign-in, older token) · off = switched off · starting · running · error (message says why).
 */
export type VaultState = "setup" | "no_account" | "no_sync_token" | "off" | "starting" | "running" | "error";

export interface VaultStatus {
  state: VaultState;
  vault_path: string | null;
  dropzone_path: string | null;
  /** Proposal for the first-run setup (%USERPROFILE%\\KortexVault). */
  default_path: string;
  /** The "Vault-Sync" switch, independent of the state (error/starting keep it on). */
  enabled: boolean;
  /** First-run prompt answered or postponed. */
  setup_done: boolean;
  realtime: "connected" | "disconnected" | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  /** Last sync error of a running daemon (newer than its last clean reconcile). */
  last_error: string | null;
  pending_local: number;
  items_tracked: number | null;
  dropzone: { processed: number; duplicates: number; failed: number; pending: number };
  /** Why it is not running (error, no_sync_token, no_account). */
  message: string | null;
  version: string | null;
  /** Last heartbeat. */
  at: string | null;
  /** The telling line of md-sync output after a crash (e.g. `Error: EISDIR: ...`). */
  log_line: string | null;
}

/** Read-only check of a folder before it becomes the vault (vault_pick_folder / vault_check_folder). */
export interface FolderCheck {
  path: string;
  exists: boolean;
  empty: boolean;
  /** Already a Kortex vault (.kortex or the vault folders). */
  kortex_vault: boolean;
  entries: number;
  /** Markdown files directly inside: md-sync moves them into 00_Inbox. */
  md_at_root: number;
  /** Not allowed at all (drive root, user folder, system folder, file). */
  refused: string | null;
  /** Not empty and no Kortex vault: needs "Trotzdem verwenden". */
  needs_confirm: boolean;
}

/** Short copilot answer for the launcher's "Fragen" (POST /api/chat, brief). */
export interface AskAnswer {
  text: string;
  model: string | null;
  sources: Array<{ n: number; item_id: string; title: string; type: string }>;
}

export interface Commands {
  get_meeting_state: { args: void; result: MeetingState };
  start_recording: { args: void; result: { recording: true; elapsed: number } };
  /**
   * Stops capture and finalizes the local WAV (16 kHz, L = mic, R = system). With a connected
   * account the recording is transcribed per channel (/api/chat/transcribe) and ingested as a
   * meeting (/api/ingest); progress arrives as `meeting:upload`.
   */
  stop_recording: { args: void; result: { file: string; seconds: number; uploading: boolean } };
  upload_recording: { args: { file: string }; result: null };
  /**
   * Throws the running recording away: capture stops, the WAV is deleted and the live session's
   * meeting entry is removed in Kortex. No upload, no minutes. `meeting:state` follows with `discarded`.
   */
  discard_recording: { args: void; result: null };
  account_status: { args: void; result: AccountStatus };
  /**
   * "Server verbinden": the address of the user's Kortex (first start, or to switch). The core checks
   * `<url>/api/instance`, stores the address and loads the web app from it; throws the text to show.
   */
  set_server: { args: { url: string }; result: AccountStatus };
  /** "Konto verbinden": Supabase sign-in; only the refresh token is stored (desktop.json). */
  connect_account: { args: { email: string; password: string }; result: AccountStatus };
  /** "Mit API-Token verbinden": personal token (kx_…) from the web app instead of a sign-in. */
  connect_token: { args: { token: string }; result: AccountStatus };
  disconnect_account: { args: void; result: AccountStatus };
  /** Shows / sizes / hides the meeting bar window: "pill" = the 560×48 bar, "hud" = bar plus panel. */
  set_hud_mode: { args: { mode: HudMode }; result: null };
  /** Settings → Appearance: stored in desktop.json, applied to every window, `settings:theme` follows. */
  set_theme: { args: { theme: ThemePref }; result: ThemePref };
  /**
   * Window buttons of the main window's titlebar (main_bridge.rs): "frame" announces that the page draws
   * them (the native frame goes), the others are the buttons; "close" hides to the tray, "drag" moves the window
   * (fallback of the web titlebar's move, Ruhe round 2).
   */
  main_window: { args: { action: "frame" | "minimize" | "toggle_maximize" | "close" | "drag" }; result: null };
  /** SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) on HUD + overlays. */
  set_stealth: { args: { enabled: boolean }; result: null };
  /** Device names plus the chosen ones (kept in desktop.json; null = system default). */
  list_audio_devices: {
    args: void;
    result: {
      inputs: string[];
      outputs: string[];
      input?: string | null;
      output?: string | null;
      /** What "Windows-Standardgerät" is right now. */
      default_input?: string | null;
      default_output?: string | null;
    };
  };
  /** "Beim Minimieren das Meeting-HUD zeigen" (without a recording; with one always the pill). */
  /** Self-test of the meeting chain with a test signal (or a WAV) and the local stub API (or online). */
  /** Pill "Aufnahme beenden" during a web recording: the web app in the main window stops and saves it. */
  stop_web_recording: { args: void; result: null };
  run_selftest: { args: { wav?: string | null; online?: boolean }; result: SelfTestReport };
  /** Picks mic / loopback source for the next recording and remembers it ("" = default). */
  select_audio_device: { args: { kind: "input" | "output"; name: string }; result: null };
  /** "Mit Windows starten" (HKCU Run key, starts hidden in the tray). */
  get_autostart: { args: void; result: boolean };
  set_autostart: { args: { enabled: boolean }; result: boolean };
  /** Test capture on both channels (with a quiet test tone for the loopback); peak dBFS per channel. */
  test_recording: {
    args: { seconds: number };
    result: { ok: boolean; mic_db: number; system_db: number; mic_ok: boolean; system_ok: boolean };
  };
  quick_capture: { args: { text: string; target: CaptureTarget; title?: string }; result: { id: string } };
  /** GET /api/search with the account: `?` search and the `>` prompt catalog (kind "prompt", content). */
  launcher_search: {
    args: { q: string; kind?: string | null; limit?: number; content?: boolean };
    result: SearchResponse;
  };
  /** "Fragen": short answer with numbered sources (sign-in, or a personal token with the `ask` scope). */
  launcher_ask: { args: { question: string }; result: AskAnswer };
  /**
   * Hides the launcher and hands `text` to the window that was in front before it: `paste` = Ctrl+V
   * there (clipboard restored afterwards), `copy` = leave it on the clipboard. true when pasted.
   */
  paste_text: { args: { text: string; mode: "paste" | "copy" }; result: boolean };
  /** Copies the selection of the window behind the launcher (Ctrl+C, clipboard kept). */
  grab_selection: { args: void; result: { text: string | null; source: string | null } };
  /** Esc: hide the launcher and focus the previous window again. */
  close_launcher: { args: void; result: null };
  start_voice_note: { args: void; result: null };
  /** Stops the voice note; with an account it is transcribed and captured (`voice:upload`). */
  stop_voice_note: { args: void; result: { seconds: number; file: string; uploading: boolean } };
  /** Marks a moment of the running meeting (stored in the live session, listed in the protocol). */
  meeting_clip: { args: { text: string }; result: { id: string; at_sec: number; text: string } | null };
  /** Task from a coaching card. */
  meeting_task: { args: { title: string }; result: string };
  refresh_coaching: { args: void; result: null };
  /** Opens a knowledge item (/notes/<id>) in the main window. */
  open_in_main: { args: { itemId: string }; result: null };
  open_window: { args: { label: WindowLabel }; result: null };
  show_main: { args: void; result: null };
  hide_to_tray: { args: void; result: null };
  quit_app: { args: void; result: null };
  /** Parked kortex://connect link (null = none); the token itself never reaches the frontend. */
  pending_connect: { args: void; result: { web: string | null; current_web: string } | null };
  /** "Verbinden": checks the parked token and stores it in the Windows Credential Manager. */
  confirm_connect: { args: void; result: AccountStatus };
  dismiss_connect: { args: void; result: null };
  /** Opens Einstellungen → Connectors of the web app in the main window ("Mit Windows-App verbinden"). */
  open_connect: { args: void; result: null };
  /** Windows notifications for due reminders and radar changes (every 15 min while in the tray). */
  get_reminders: { args: void; result: boolean };
  set_reminders: { args: { enabled: boolean }; result: boolean };
  /**
   * Language of the desktop app's own texts (windows, tray tooltip, notifications, errors of the
   * core): the stored choice (desktop.json `locale`), else the Windows display language.
   */
  get_locale: { args: void; result: Locale };
  /** Stores the language, switches the core's texts and tells every window (`settings:locale`). */
  set_locale: { args: { locale: Locale }; result: Locale };
  vault_status: { args: void; result: VaultStatus };
  /** Windows folder dialog; null = cancelled. Applies nothing. */
  vault_pick_folder: { args: void; result: FolderCheck | null };
  vault_check_folder: { args: { path: string }; result: FolderCheck };
  /** Makes the folder the vault and (re)starts the sync; `confirm` for a non-empty foreign folder. */
  vault_set_folder: { args: { path: string; confirm: boolean }; result: VaultStatus };
  vault_set_enabled: { args: { enabled: boolean }; result: VaultStatus };
  /** First-run "Später". */
  vault_skip_setup: { args: void; result: VaultStatus };
  /** Full reconcile in the running daemon now. */
  vault_sync_now: { args: void; result: null };
  /** Opens the vault or its Dropzone (created if missing) in the Explorer, or md-sync.log in the editor. */
  vault_open: { args: { target: "vault" | "dropzone" | "log" }; result: null };
}

export interface AccountStatus {
  connected: boolean;
  email: string | null;
  web_url: string;
  /** Set when the configured web URL is refused (only https:// or localhost). */
  web_url_error: string | null;
  /** No server known yet (first start of a build without its own Kortex): the settings ask for one. */
  needs_server: boolean;
  /** Supabase anon key present (desktop.json or KORTEX_SUPABASE_ANON_KEY). */
  has_anon_key: boolean;
  /**
   * Connected with a personal API token: capture, live meetings and transcription; search and live
   * coaching and "Fragen" only when the token may also search and ask (scopes `search`, `ask`).
   */
  api_token: boolean;
}

export type EventName = keyof Events;
export type CommandName = keyof Commands;
export type Unlisten = () => void;

export interface Bridge {
  /** True inside the Tauri webview, false in the browser preview. */
  readonly native: boolean;
  invoke<C extends CommandName>(
    cmd: C,
    ...args: Commands[C]["args"] extends void ? [] : [Commands[C]["args"]]
  ): Promise<Commands[C]["result"]>;
  listen<E extends EventName>(event: E, cb: (payload: Events[E]) => void): Unlisten;
  emit<E extends EventName>(event: E, payload: Events[E]): void;
  /** Hides the calling window (native windows' close button); no-op in the browser preview. */
  hideWindow(): void;
}
