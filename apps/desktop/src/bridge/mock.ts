import { getLocale } from "@kortex/i18n";
import type { Bridge, CoachCard, CommandName, Commands, EventName, Events, FolderCheck, ThemePref, Unlisten, VaultStatus } from "./contract";

/**
 * Browser stand-in for the Rust core (browser preview and tests only; the Tauri app never loads it).
 * Simulates what Desktop.dc.html simulates: a meeting that has been recording for 18:42, a 1 Hz
 * clock, per-channel levels, and it replays the prototype's conversation as the same events the
 * Rust core sends (meeting:live, transcript:final, coaching:cards, meeting:upload).
 */

/** Prototype conversation, replayed as transcript:final events (one line every DEMO_EVERY ticks). */
export const DEMO_LINES: Array<{ channel: 0 | 1; text: string }> = [
  { channel: 0, text: "We hash every file with SHA-256 and put a .conflict.md next to it when they diverge." },
  { channel: 1, text: "And who decides which version wins?" },
  { channel: 1, text: "The user should see that before anything gets overwritten." },
  { channel: 0, text: "Then we need a diff view right in the conflict dialog." },
  { channel: 1, text: "Can we make that by the Q4 release?" },
];
export const DEMO_EVERY = 6;
export const DEMO_CARDS: CoachCard[] = [
  {
    kind: "question",
    title: "Good moment now",
    text: "Ask how the user sees conflicts before anything is overwritten. From the file: Tom decides with examples.",
    object: { id: "00000000-0000-4000-8000-00000000c001", title: "Tom", type: "person" },
  },
  { kind: "fact", text: "Matches doc 02: SHA-256 checksum plus .conflict.md on divergence." },
  { kind: "action", text: "Send the checksum concept to Tom by Friday." },
];
const MOCK_ITEM = "00000000-0000-4000-8000-00000000d001";

/** Launcher preview data: two notes and the prompt catalog (40_AI_Memories/Prompts). */
export const MOCK_VAULT = [
  {
    item_id: "00000000-0000-4000-8000-00000000a001",
    title: "Vault sync conflicts",
    type: "note",
    folder_path: "10_Notes",
    snippet: "Every file carries a SHA-256 checksum; on divergence a .conflict.md appears.",
    content_md: "# Vault sync conflicts\nEvery file carries a SHA-256 checksum; on divergence a .conflict.md appears.",
  },
  {
    item_id: "00000000-0000-4000-8000-00000000a002",
    title: "Fleet tracking roadmap",
    type: "note",
    folder_path: "10_Notes",
    snippet: "The vendor delivers the OBD interface by Q1.",
    content_md: "# Fleet tracking roadmap\nThe vendor delivers the OBD interface by Q1.",
  },
  {
    item_id: "00000000-0000-4000-8000-00000000b001",
    title: "Follow-up email after a meeting",
    type: "prompt",
    folder_path: "40_AI_Memories/Prompts",
    snippet: "Write a short follow-up email to {{name}} …",
    content_md:
      "Write a short follow-up email to {{name}} about the meeting on {{topic}}. Sum up the three most important decisions and suggest a next date.",
  },
  {
    item_id: "00000000-0000-4000-8000-00000000b002",
    title: "Shorten text",
    type: "prompt",
    folder_path: "40_AI_Memories/Prompts",
    snippet: "Cut the following text in half …",
    content_md: "Cut the following text in half without losing any facts.",
  },
  {
    item_id: "00000000-0000-4000-8000-00000000d001",
    title: "Q4 architecture review",
    type: "meeting",
    folder_path: "20_Meetings",
    snippet: "Checksum concept: SHA-256 per file, conflicts as .conflict.md. Tom gets the concept by Friday.",
    content_md: "# Q4 architecture review\n## Decisions\n- SHA-256 per file",
  },
  {
    item_id: "00000000-0000-4000-8000-00000000d002",
    title: "1:1 Priya",
    type: "meeting",
    folder_path: "20_Meetings",
    snippet: "Onboarding the new colleagues, budget for Q1.",
    content_md: "# 1:1 Priya",
  },
].map((h) => ({ ...h, source_url: null, tags: [] as string[], page_or_timestamp: null, score: null }));

const mmss = (n: number) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");

/** Prototype starts the meeting clock at 18:42. */
export const MOCK_START_ELAPSED = 18 * 60 + 42;

/** dB readout of the prototype: base minus (elapsed * k) mod 5. */
export const mockDb = (elapsed: number, base: number, k: number) => base - ((elapsed * k) % 5);

const dbToRms = (db: number) => Math.round(Math.pow(10, db / 20) * 1000) / 1000;

export function createMockBridge(opts: { tickMs?: number } = {}): Bridge & { dispose: () => void } {
  const subs = new Map<EventName, Set<(p: unknown) => void>>();
  let recording = true;
  let elapsed = MOCK_START_ELAPSED;
  let stealth = true;
  let autostart = false;
  const devices: { input: string | null; output: string | null } = { input: null, output: null };
  let account = { connected: false, email: null as string | null, web_url: "https://kortex.example.com", web_url_error: null as string | null, needs_server: false, has_anon_key: true, api_token: false };
  let reminders = true;
  let pendingConnect: { web: string | null; current_web: string } | null = null;

  const emit = <E extends EventName>(event: E, payload: Events[E]) => {
    subs.get(event)?.forEach((cb) => cb(payload));
  };
  // Speech-like wobble per frame on top of the prototype's per-second value.
  const levels = (f = 0) => {
    const a = recording ? mockDb(elapsed, -12, 3) - Math.round(6 * Math.abs(Math.sin(f * 0.37))) : -60;
    const b = recording ? mockDb(elapsed, -17, 2) - Math.round(6 * Math.abs(Math.sin(f * 0.23 + 1))) : -60;
    emit("audio:levels", { ch0: { db: a, rms: dbToRms(a) }, ch1: { db: b, rms: dbToRms(b) }, mic_signal: true });
  };

  let said = 0;
  let ticks = 0;
  const say = () => {
    const l = DEMO_LINES[said % DEMO_LINES.length]!;
    said += 1;
    emit("transcript:final", { channel: l.channel, speaker: l.channel === 0 ? "Ich" : "Gesprächspartner", ts: mmss(elapsed), text: l.text });
    if (said === 3) emit("coaching:cards", { cards: DEMO_CARDS, at: mmss(elapsed) });
  };
  // First lines shortly after start (after the providers subscribed), so the preview opens on a running conversation.
  const intro = setTimeout(() => {
    if (!recording) return;
    emit("meeting:live", { state: "live", item_id: MOCK_ITEM, title: "Q4 architecture sync", transcriber: "edenai:deepgram" });
    emit("transcript:status", { state: "listening", transcriber: "edenai:deepgram" });
    say();
    say();
  }, 60);

  const timer = setInterval(() => {
    if (!recording) return;
    elapsed += 1;
    ticks += 1;
    emit("meeting:tick", { elapsed });
    if (ticks % DEMO_EVERY === 0) say();
  }, opts.tickMs ?? 1000);
  // Meters like the native core: ~30 levels per second (audio.rs LEVEL_INTERVAL).
  let frame = 0;
  const levelTimer = setInterval(() => {
    frame += 1;
    if (recording) levels(frame);
  }, 33);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Vault sync: first run (no folder) until the preview picks one; then "running" with a heartbeat.
  const VAULT_DEFAULT = "C:\\Users\\You\\KortexVault";
  let vault: VaultStatus = {
    state: "setup",
    vault_path: null,
    dropzone_path: null,
    default_path: VAULT_DEFAULT,
    enabled: true,
    setup_done: false,
    realtime: null,
    last_sync_at: null,
    last_success_at: null,
    last_error: null,
    pending_local: 0,
    items_tracked: null,
    dropzone: { processed: 0, duplicates: 0, failed: 0, pending: 0 },
    message: null,
    version: null,
    at: null,
    log_line: null,
  };
  const setVault = (patch: Partial<VaultStatus>) => {
    vault = { ...vault, ...patch };
    emit("vault:status", vault);
    return vault;
  };
  const startVault = () => {
    if (!vault.vault_path) return vault;
    if (!vault_on) return setVault({ state: "off", message: null });
    setVault({ state: "starting", message: null });
    setTimeout(() => {
      const now = new Date().toISOString();
      setVault({ state: "running", realtime: "connected", last_sync_at: now, last_success_at: now, at: now, items_tracked: 128, version: "0.6.0" });
    }, 700);
    return vault;
  };
  let vault_on = true;
  // Preview: a path containing "Documents" plays a non-empty foreign folder, "C:\\" a refused one.
  const checkFolder = (path: string): FolderCheck => {
    const foreign = /dokumente|documents/i.test(path);
    const refused = /^[a-z]:\\?$/i.test(path.trim()) ? "A whole drive cannot be a vault. Please pick a subfolder." : null;
    return { path, exists: foreign, empty: !foreign, kortex_vault: false, entries: foreign ? 14 : 0, md_at_root: foreign ? 3 : 0, refused, needs_confirm: foreign && !refused };
  };
  const handlers: {
    [C in CommandName]: (args: Commands[C]["args"]) => Promise<Commands[C]["result"]>;
  } = {
    get_meeting_state: async () => ({ recording, elapsed, item_id: recording ? MOCK_ITEM : null, title: "Q4 architecture sync", transcriber: "edenai:deepgram", connected: true, stealth }),
    start_recording: async () => {
      recording = true;
      elapsed = 0;
      said = 0;
      emit("meeting:state", { recording, elapsed });
      emit("meeting:live", { state: "live", item_id: MOCK_ITEM, title: "Q4 architecture sync", transcriber: "edenai:deepgram" });
      return { recording: true, elapsed };
    },
    stop_recording: async () => {
      recording = false;
      emit("meeting:state", { recording, elapsed, uploading: true });
      emit("meeting:upload", { state: "uploading" });
      await wait(1800); // last chunks + end of the live session
      emit("meeting:upload", { state: "done", item_id: MOCK_ITEM, folder_path: null, segments: said });
      emit("meeting:live", { state: "ended", item_id: MOCK_ITEM });
      return { file: "C:\\Users\\max\\AppData\\Roaming\\io.github.moe-spiration.openkortex\\recordings\\2026-10-22_11-00-00.wav", seconds: elapsed, uploading: true };
    },
    discard_recording: async () => {
      recording = false;
      emit("meeting:state", { recording, elapsed, uploading: false, discarded: true });
      emit("meeting:live", { state: "ended", item_id: MOCK_ITEM });
      return null;
    },
    meeting_clip: async ({ text }) => ({ id: "clip-" + Date.now().toString(36), at_sec: elapsed, text }),
    meeting_task: async () => "task-" + Date.now().toString(36),
    refresh_coaching: async () => {
      emit("coaching:status", { state: "loading" });
      await wait(900);
      emit("coaching:cards", { cards: DEMO_CARDS, at: mmss(elapsed) });
      return null;
    },
    open_in_main: async () => null,
    set_hud_mode: async ({ mode }) => {
      emit("hud:mode", { mode });
      return null;
    },
    set_stealth: async ({ enabled }) => {
      stealth = enabled;
      emit("settings:stealth", { enabled });
      return null;
    },
    list_audio_devices: async () => ({
      inputs: ["Mikrofon (Shure MV7)", "Headset-Mikrofon (Jabra Evolve2)", "Laptop-Mikrofon-Array"],
      outputs: [
        "Lautsprecher (Realtek Audio)",
        "Headset (Jabra Evolve2)",
        "Monitor-Lautsprecher (DisplayPort)",
      ],
      ...devices,
      default_input: "Mikrofon (Shure MV7)",
      default_output: "Lautsprecher (Realtek Audio)",
    }),
    select_audio_device: async ({ kind, name }) => {
      devices[kind] = name || null;
      return null;
    },
    get_autostart: async () => autostart,
    set_autostart: async ({ enabled }) => (autostart = enabled),
    test_recording: async ({ seconds }) => {
      await wait(Math.min(seconds, 2) * 1000);
      return { ok: true, mic_db: -14, system_db: -19, mic_ok: true, system_ok: true };
    },
    quick_capture: async () => ({ id: "mock-" + Date.now().toString(36) }),
    launcher_search: async ({ q, kind, limit, content }) => {
      await wait(120);
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const results = MOCK_VAULT.filter((h) => !kind || h.type === kind)
        .filter((h) => terms.every((t) => `${h.title} ${h.content_md}`.toLowerCase().includes(t)))
        .slice(0, limit ?? 8)
        .map(({ content_md, ...h }) => (content ? { ...h, content_md } : h));
      return { ok: true, query: q.trim(), mode: q.trim() ? "hybrid" : "recent", results };
    },
    launcher_ask: async ({ question }) => {
      await wait(700);
      if (!question.trim()) throw new Error("Please enter a question");
      return {
        text: "When versions diverge, the app puts a .conflict.md next to the file and compares both by SHA-256 [1]. The user makes the call [2].",
        model: "anthropic:auto",
        sources: [
          { n: 1, item_id: MOCK_VAULT[0]!.item_id, title: MOCK_VAULT[0]!.title, type: "note" },
          { n: 2, item_id: MOCK_ITEM, title: "Q4 architecture sync", type: "meeting" },
        ],
      };
    },
    paste_text: async ({ mode }) => mode === "paste",
    grab_selection: async () => ({
      text: "Checksum concept: SHA-256 per file, a .conflict.md next to it on divergence.",
      source: "Q4 architecture – Word",
    }),
    close_launcher: async () => null,
    start_voice_note: async () => null,
    stop_voice_note: async () => {
      const uploading = account.connected;
      if (uploading) {
        setTimeout(() => emit("voice:upload", { state: "uploading" }), 60);
        setTimeout(() => emit("voice:upload", { state: "done", item_id: "mock-voice", folder_path: "00_Inbox" }), 900);
      }
      return { seconds: 0, file: "", uploading };
    },
    upload_recording: async () => null,
    account_status: async () => ({ ...account }),
    set_server: async ({ url }) => {
      await wait(600);
      const typed = url.trim();
      if (!typed) throw new Error("Address missing");
      const web = (typed.includes("://") ? typed : `https://${typed}`).replace(/\/+$/, "");
      if (!/^https:\/\//.test(web) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(web)) throw new Error("only https:// (or http://localhost) is allowed");
      account = { ...account, web_url: web, web_url_error: null, needs_server: false, connected: false, email: null, api_token: false };
      return { ...account };
    },
    connect_token: async ({ token }) => {
      await wait(600);
      if (!/^kx_[A-Za-z0-9_-]{43}$/.test(token.trim())) throw new Error("That is not an API token of this app");
      account = { ...account, connected: true, email: "API token \"Desktop\"", api_token: true };
      return { ...account };
    },
    connect_account: async ({ email }) => {
      await wait(600);
      account = { ...account, connected: true, email };
      return { ...account };
    },
    disconnect_account: async () => {
      account = { ...account, connected: false, email: null, api_token: false };
      return { ...account };
    },
    open_window: async () => null,
    pending_connect: async () => pendingConnect,
    confirm_connect: async () => {
      await wait(400);
      if (!pendingConnect) throw new Error("No connection link open");
      pendingConnect = null;
      account = { ...account, connected: true, email: "API token \"Windows app\"", api_token: true };
      return { ...account };
    },
    dismiss_connect: async () => {
      pendingConnect = null;
      return null;
    },
    open_connect: async () => {
      // Browser preview: pretend the web app sent the deep link back.
      pendingConnect = { web: null, current_web: account.web_url };
      setTimeout(() => emit("connect:pending", { web: null, error: null }), 300);
      return null;
    },
    // Language: the preview keeps the choice in localStorage (natively desktop.json).
    get_locale: async () => getLocale(),
    set_locale: async ({ locale }) => {
      emit("settings:locale", { locale });
      return locale;
    },
    set_theme: async ({ theme }: { theme: ThemePref }) => {
      emit("settings:theme", { theme });
      return theme;
    },
    main_window: async () => null,
    get_reminders: async () => reminders,
    set_reminders: async ({ enabled }) => (reminders = enabled),
    // Preview: the same events as the native self-test, in a few seconds.
    stop_web_recording: async () => {
      emit("webrec:state", { recording: false });
      return null;
    },
    run_selftest: async () => {
      const t0 = Date.now();
      recording = true;
      elapsed = 0;
      said = 0;
      emit("meeting:state", { recording, elapsed });
      emit("meeting:devices", { mic: "Self-test (synthetic)", sys: "Self-test (synthetic)", note: null });
      emit("hud:mode", { mode: "hud" });
      emit("meeting:live", { state: "live", item_id: MOCK_ITEM, title: "Self-test", transcriber: "selftest:stub" });
      await wait(1200);
      emit("transcript:final", { channel: 0, speaker: "Ich", ts: "00:13", text: "Self-test microphone: 13.1 s of audio arrived, level -14 dBFS." });
      emit("transcript:final", { channel: 1, speaker: "Gesprächspartner", ts: "00:13", text: "Self-test system audio: 13.1 s of audio arrived, level -17 dBFS." });
      await wait(600);
      emit("coaching:cards", { cards: DEMO_CARDS, at: "00:14" });
      await wait(1200);
      recording = false;
      emit("meeting:state", { recording, elapsed, uploading: true });
      emit("meeting:upload", { state: "done", item_id: MOCK_ITEM, folder_path: null, segments: 2 });
      const steps = ["Levels of both channels (audio:levels)", "Live transcript (transcript:final)", "Live coach (coaching:cards)"].map((name) => ({ name, ok: true, detail: "Preview" }));
      const report = { ok: true, online: false, source: "Preview", seconds: (Date.now() - t0) / 1000, steps, report_file: null, log_file: null };
      emit("selftest:done", { ok: true, summary: `Self-test passed: ${steps.length} checks`, report: null });
      return report;
    },
    vault_status: async () => vault,
    vault_pick_folder: async () => checkFolder(VAULT_DEFAULT.replace("KortexVault", "Documents\\Notes")),
    vault_check_folder: async ({ path }) => checkFolder(path),
    vault_set_folder: async ({ path, confirm }) => {
      const c = checkFolder(path);
      if (c.refused) throw c.refused;
      if (c.needs_confirm && !confirm) throw `The folder is not empty (${c.entries} entries) and not a vault yet.`;
      setVault({ vault_path: path, dropzone_path: `${path}\\00_Inbox\\Dropzone`, setup_done: true });
      return startVault();
    },
    vault_set_enabled: async ({ enabled }) => {
      vault_on = enabled;
      setVault({ enabled });
      return enabled ? startVault() : setVault({ state: "off", realtime: null });
    },
    vault_skip_setup: async () => setVault({ setup_done: true }),
    vault_sync_now: async () => {
      setTimeout(() => setVault({ last_sync_at: new Date().toISOString(), at: new Date().toISOString() }), 400);
      return null;
    },
    vault_open: async () => null,
    show_main: async () => null,
    hide_to_tray: async () => null,
    quit_app: async () => null,
  };

  return {
    native: false,
    invoke: ((cmd: CommandName, args?: unknown) =>
      (handlers[cmd] as (a: unknown) => Promise<unknown>)(args)) as Bridge["invoke"],
    listen: <E extends EventName>(event: E, cb: (payload: Events[E]) => void): Unlisten => {
      const set = subs.get(event) ?? new Set();
      set.add(cb as (p: unknown) => void);
      subs.set(event, set);
      return () => set.delete(cb as (p: unknown) => void);
    },
    emit,
    hideWindow: () => {},
    dispose: () => {
      clearInterval(timer);
      clearInterval(levelTimer);
      clearTimeout(intro);
    },
  };
}
