//! Vault sync: the desktop runs md-sync (`packages/md-sync`) as a sidecar process.
//!
//! - Runtime: `sidecar/node.exe` + `sidecar/md-sync.mjs` from the app resources (built by
//!   `scripts/build-sidecar.mjs`). Without a bundled `node.exe` the one on PATH runs it; a debug
//!   build (`tauri dev`) also finds the bundle in `src-tauri/sidecar/` after `node scripts/build-sidecar.mjs`.
//!   Every path handed to Node is plain (`plain_path`): a `\?` path crashes it at start.
//! - Auth: the personal `kx_` token from "Mit Windows-App verbinden" (Credential Manager,
//!   secrets.rs). md-sync trades it for a short-lived user JWT at `POST /api/sync/session` and runs
//!   under RLS; no service-role key ever reaches the PC. A token without the `sync` scope (older
//!   tokens, e-mail sign-in) gets a clear status instead of a sync.
//! - Folder: `vaultPath` in desktop.json, chosen in Einstellungen (default `~/KortexVault`). The
//!   app never deletes or moves anything in it; a non-empty folder that is no Kortex vault needs an
//!   explicit "Trotzdem verwenden".
//! - Status: md-sync prints `@@kortex-status {json}` on every heartbeat and `@@kortex-fatal {json}`
//!   before it exits (status-line.ts); the latest one is `vault_status` and the `vault:status` event.
//!   The same heartbeat goes to `kortex.sync_status`, which the web settings show.
//! - Lifecycle: starts with the app (and after connect / folder change), restarts with backoff after
//!   a crash, stops on quit ("stop" on stdin, killed after a grace period). Exit codes 2-5 (config,
//!   token, server too old, vault locked) do not restart.
//! - Dropzone `<vault>/00_Inbox/Dropzone`: md-sync hands files dropped there to `/api/ingest`.

use crate::i18n::{t, tf};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{config, secrets};

/// Vault subfolder md-sync watches for non-Markdown files (packages/md-sync DROPZONE_FOLDER).
pub const DROPZONE: [&str; 2] = ["00_Inbox", "Dropzone"];
/// Folders of a Kortex vault (packages/md-sync DEFAULT_VAULT_FOLDERS); any of them marks one.
const VAULT_MARKERS: [&str; 10] = [".kortex", "00_Inbox", "10_Notes", "20_Meetings", "30_Clippings", "40_AI_Memories", "50_Recipes", "60_Documents", "70_Objects", "90_Digests"];
/// Grace period for a clean stop before the process is killed.
const STOP_GRACE: Duration = Duration::from_secs(8);
/// The log file is rotated at this size (one `.old` kept).
const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
/// Output lines of the current run kept in memory to explain a crash.
const LOG_TAIL: usize = 60;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct DropzoneStats {
    pub processed: u64,
    pub duplicates: u64,
    pub failed: u64,
    pub pending: u64,
}

/// What the settings window shows (`vault_status`, event `vault:status`).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct VaultStatus {
    /// `setup` (no folder yet) | `no_account` | `no_sync_token` | `off` | `starting` | `running` | `error`
    pub state: String,
    pub vault_path: Option<String>,
    pub dropzone_path: Option<String>,
    /// Proposed folder for the first-run setup (`%USERPROFILE%\KortexVault`).
    pub default_path: String,
    /// The "Vault-Sync" switch (desktop.json), independent of the state.
    pub enabled: bool,
    /// First-run prompt already answered or postponed.
    pub setup_done: bool,
    pub realtime: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_success_at: Option<String>,
    /// Last sync error the daemon reported (it keeps running).
    pub last_error: Option<String>,
    pub pending_local: u64,
    pub items_tracked: Option<u64>,
    pub dropzone: DropzoneStats,
    /// Why the sync is not running (state error / no_sync_token / ...), German.
    pub message: Option<String>,
    pub version: Option<String>,
    /// Time of the last heartbeat.
    pub at: Option<String>,
    /// The telling line of md-sync's output when it crashed (shown under the error).
    pub log_line: Option<String>,
}

impl VaultStatus {
    pub fn new(state: &str, default_path: String) -> Self {
        Self {
            state: state.into(),
            vault_path: None,
            dropzone_path: None,
            default_path,
            enabled: true,
            setup_done: false,
            realtime: None,
            last_sync_at: None,
            last_success_at: None,
            last_error: None,
            pending_local: 0,
            items_tracked: None,
            dropzone: DropzoneStats::default(),
            message: None,
            version: None,
            at: None,
            log_line: None,
        }
    }
}

// --- status lines -------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct StatusLine {
    pub state: Option<String>,
    pub realtime: Option<String>,
    pub vault_path: Option<String>,
    pub dropzone_path: Option<String>,
    pub version: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub last_error_at: Option<String>,
    pub pending_local: Option<u64>,
    pub items_tracked: Option<u64>,
    pub stats: HashMap<String, f64>,
    pub at: Option<String>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct FatalLine {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, PartialEq)]
pub enum Line {
    Status(Box<StatusLine>),
    Fatal(FatalLine),
    /// A normal log line (goes to md-sync.log).
    Log,
}

pub fn parse_line(line: &str) -> Line {
    let line = line.trim_end();
    if let Some(json) = line.strip_prefix("@@kortex-status ") {
        if let Ok(s) = serde_json::from_str::<StatusLine>(json) {
            return Line::Status(Box::new(s));
        }
    } else if let Some(json) = line.strip_prefix("@@kortex-fatal ") {
        if let Ok(f) = serde_json::from_str::<FatalLine>(json) {
            return Line::Fatal(f);
        }
    }
    Line::Log
}

/// Folds a heartbeat into the shown status.
pub fn apply_status(status: &mut VaultStatus, s: &StatusLine) {
    status.state = match s.state.as_deref() {
        Some("error") => "error".into(),
        _ => "running".into(),
    };
    status.message = None;
    status.log_line = None;
    if s.vault_path.is_some() {
        status.vault_path = s.vault_path.clone();
    }
    status.dropzone_path = s.dropzone_path.clone();
    status.realtime = s.realtime.clone();
    status.last_sync_at = s.last_sync_at.clone();
    status.last_success_at = s.last_success_at.clone();
    // Only an error newer than the last clean reconcile is still an error (same rule as the web
    // settings; ISO timestamps from toISOString compare as strings).
    status.last_error = s.last_error.clone().filter(|_| match (&s.last_error_at, &s.last_success_at) {
        (Some(err), Some(ok)) => err > ok,
        _ => true,
    });
    status.pending_local = s.pending_local.unwrap_or(0);
    status.items_tracked = s.items_tracked;
    let n = |k: &str| s.stats.get(k).copied().unwrap_or(0.0).max(0.0) as u64;
    status.dropzone = DropzoneStats { processed: n("dropzone_processed"), duplicates: n("dropzone_duplicates"), failed: n("dropzone_failed"), pending: n("dropzone_pending") };
    status.version = s.version.clone();
    status.at = s.at.clone();
}

// --- exits and restarts -------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum ExitAction {
    Restart(Duration),
    Stop { state: &'static str, message: String },
}

/// What to do when md-sync exited. `fatal` = its last `@@kortex-fatal` message, `crashes` =
/// restarts in a row without a heartbeat in between.
pub fn on_exit(code: Option<i32>, intended: bool, fatal: Option<&FatalLine>, crashes: u32) -> ExitAction {
    let msg = |fallback: &str| fatal.map(|f| f.message.clone()).filter(|m| !m.is_empty()).unwrap_or_else(|| fallback.to_string());
    if intended {
        return ExitAction::Stop { state: "off", message: String::new() };
    }
    match code {
        Some(0) => ExitAction::Stop { state: "off", message: String::new() },
        Some(2) => ExitAction::Stop { state: "error", message: tf("Setting is faulty: {reason}", &[("reason", &msg(t("unknown")))]) },
        Some(3) => ExitAction::Stop {
            state: "no_sync_token",
            message: tf(
                "The token does not allow vault sync or was revoked ({reason}). In the web app under Settings → Connectors choose “Connect with Windows app” again.",
                &[("reason", &msg(t("refused")))],
            ),
        },
        Some(4) => ExitAction::Stop { state: "error", message: msg(t("The server does not know vault sync yet (web app 0.6.0 or later)")) },
        Some(5) => ExitAction::Stop { state: "error", message: msg(t("Another md-sync is already running on this vault")) },
        _ => ExitAction::Restart(backoff(crashes)),
    }
}

/// 5 s, 15 s, 1 min, then every 5 min (offline at boot, server restarts: keeps trying).
pub fn backoff(crashes: u32) -> Duration {
    Duration::from_secs(match crashes {
        0 => 5,
        1 => 15,
        2 => 60,
        _ => 300,
    })
}

/// Picks the line of a crashed run that says why: a JS error (`Error: EISDIR: ...`), else the last
/// `error`/`warn` log line, else the last line that is no stack frame or Node banner.
pub fn summarize_log<S: AsRef<str>>(lines: &[S]) -> Option<String> {
    let lines: Vec<&str> = lines.iter().map(|l| l.as_ref().trim()).filter(|l| !l.is_empty()).collect();
    let short = |l: &str| {
        let l = l.strip_prefix("md-sync: ").unwrap_or(l);
        if l.chars().count() > 300 {
            format!("{}…", l.chars().take(300).collect::<String>())
        } else {
            l.to_string()
        }
    };
    let is_js_error = |l: &&str| {
        let head = l.split(": ").next().unwrap_or("");
        l.contains(": ") && head.ends_with("Error") && head.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ' ' | '[' | ']'))
    };
    if let Some(l) = lines.iter().rev().find(|l| is_js_error(l)) {
        return Some(short(l));
    }
    let is_level = |l: &&str| l.starts_with("md-sync: ") || l.split_whitespace().nth(1).is_some_and(|w| w == "error" || w == "warn");
    if let Some(l) = lines.iter().rev().find(|l| is_level(l)) {
        return Some(short(l));
    }
    lines
        .iter()
        .rev()
        .find(|l| !l.starts_with("at ") && !l.starts_with("Node.js v") && !l.starts_with('^') && !matches!(**l, "}" | "{"))
        .map(|l| short(l))
}

// --- folders ------------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct FolderCheck {
    pub path: String,
    pub exists: bool,
    pub empty: bool,
    /// Has `.kortex` or one of the vault folders: an existing Kortex vault.
    pub kortex_vault: bool,
    /// Entries directly in the folder (files and folders, hidden ones included).
    pub entries: usize,
    /// Markdown files directly in the folder: md-sync moves root notes into `00_Inbox`.
    pub md_at_root: usize,
    /// Why this folder cannot be used at all (None = usable).
    pub refused: Option<String>,
    /// Needs "Trotzdem verwenden": not empty and no Kortex vault.
    pub needs_confirm: bool,
}

pub fn default_vault_path(home: Option<&Path>) -> PathBuf {
    home.map(|h| h.join("KortexVault")).unwrap_or_else(|| PathBuf::from("KortexVault"))
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase()
}

/// Checks a folder before it becomes the vault (reads only, never writes).
pub fn check_folder(path: &Path, home: Option<&Path>) -> FolderCheck {
    let shown = path.to_string_lossy().to_string();
    let mut c = FolderCheck { path: shown, exists: false, empty: true, kortex_vault: false, entries: 0, md_at_root: 0, refused: None, needs_confirm: false };
    let p = norm(path);
    let refuse = if !path.is_absolute() {
        Some(t("Please choose a full path (for example C:\\Users\\You\\KortexVault)."))
    } else if path.parent().is_none() || p.len() <= 3 {
        Some(t("A whole drive cannot be a vault. Please choose a subfolder."))
    } else if home.is_some_and(|h| norm(h) == p) {
        Some(t("The user folder itself is too large. Please choose a subfolder, for example KortexVault."))
    } else if p.get(2..).is_some_and(|rest| ["\\windows", "\\program files", "\\program files (x86)", "\\programdata"].iter().any(|s| rest == *s || rest.starts_with(&format!("{s}\\")))) {
        Some(t("System folders are not allowed as a vault."))
    } else {
        None
    };
    c.refused = refuse.map(String::from);
    match std::fs::read_dir(path) {
        Ok(rd) => {
            c.exists = true;
            for e in rd.flatten() {
                c.entries += 1;
                let name = e.file_name().to_string_lossy().to_string();
                if VAULT_MARKERS.iter().any(|m| m.eq_ignore_ascii_case(&name)) {
                    c.kortex_vault = true;
                }
                if name.to_ascii_lowercase().ends_with(".md") && e.file_type().is_ok_and(|t| t.is_file()) {
                    c.md_at_root += 1;
                }
            }
            c.empty = c.entries == 0;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => c.refused = c.refused.or(Some(tf("Folder not readable: {error}", &[("error", &e)]))),
    }
    if c.exists && !path.is_dir() {
        c.refused = Some(t("This is a file, not a folder.").into());
    }
    c.needs_confirm = c.refused.is_none() && !c.empty && !c.kortex_vault;
    c
}

pub fn dropzone_of(vault: &Path) -> PathBuf {
    DROPZONE.iter().fold(vault.to_path_buf(), |p, s| p.join(s))
}

// --- process ------------------------------------------------------------------------------

/// Windows extended-length paths (`\\?\C:\x`, `\\?\UNC\srv\share\x`) back to the normal form.
/// Tauri's `resource_dir()` returns them on Windows, and Node cannot start a script given that
/// way: it resolves the main module with `realpathSync`, which ends in `lstat 'C:'` → EISDIR
/// (0.6.0: "md-sync beendet (Code 1)"). Spaces need nothing: the path is one argument.
pub fn plain_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match s.strip_prefix(r"\\?\") {
        // Only drive paths: other verbatim forms (`\\?\Volume{..}`) have no normal spelling.
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

/// Node runtime + bundled md-sync, from the app resources (dev: `node` on PATH). Both paths are
/// plain (`plain_path`), never `\\?\`.
pub fn runtime(resource_dir: Option<&Path>) -> Option<(PathBuf, PathBuf)> {
    let dir = plain_path(resource_dir?).join("sidecar");
    let script = dir.join("md-sync.mjs");
    if !script.is_file() {
        return None;
    }
    let node = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    Some((if node.is_file() { node } else { PathBuf::from("node") }, script))
}

/// Environment of the sidecar: the user's token and folder; nothing that could switch it to the
/// service role or load foreign code.
pub fn sidecar_env(vault: &Path, web_url: &str, token: &str, version: &str) -> Vec<(&'static str, String)> {
    vec![
        ("KORTEX_VAULT_PATH", plain_path(vault).to_string_lossy().to_string()),
        ("KORTEX_API_URL", web_url.to_string()),
        ("KORTEX_SYNC_TOKEN", token.to_string()),
        ("KORTEX_SYNC_STATUS_STDOUT", "1".into()),
        ("KORTEX_SYNC_STOP_ON_STDIN_END", "1".into()),
        ("KORTEX_SYNC_VERSION", version.to_string()),
        ("KORTEX_SYNC_INGEST", "0".into()),
    ]
}

/// Variables never passed on to the sidecar (from the user's environment).
pub const SIDECAR_ENV_REMOVE: [&str; 9] = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "KORTEX_USER_ID",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NODE_OPTIONS",
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "OPENROUTER_API_KEY",
    "EDENAI_API_KEY",
];

struct Running {
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
    run: u64,
}

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    status: Option<VaultStatus>,
    /// Bumped on every start: events of an older process are ignored.
    run: u64,
    intended_stop: bool,
    crashes: u32,
    last_fatal: Option<FatalLine>,
    /// Last output lines of the current run (stdout log lines and stderr).
    tail: VecDeque<String>,
}

impl Inner {
    fn remember(&mut self, run: u64, line: &str) {
        if self.run != run {
            return;
        }
        if self.tail.len() >= LOG_TAIL {
            self.tail.pop_front();
        }
        self.tail.push_back(line.to_string());
    }
}

/// Lives in `AppState`.
#[derive(Default)]
pub struct VaultSync {
    inner: Mutex<Inner>,
}

fn default_path_string() -> String {
    default_vault_path(home_dir().as_deref()).to_string_lossy().to_string()
}

fn emit(app: &AppHandle, status: &VaultStatus) {
    let _ = app.emit("vault:status", status);
}

fn sync_of(app: &AppHandle) -> &VaultSync {
    &app.state::<crate::AppState>().inner().vault
}

/// Current status (computed from desktop.json when nothing runs).
pub fn status(app: &AppHandle) -> VaultStatus {
    let cfg = crate::commands::load_config(app);
    let s = sync_of(app).inner.lock().unwrap().status.clone().unwrap_or_else(|| idle_status(app, &cfg));
    status_with(app, s)
}

/// Fills what the settings window always needs (setup flag, default, folder, Dropzone path).
fn status_with(app: &AppHandle, mut s: VaultStatus) -> VaultStatus {
    let cfg = crate::commands::load_config(app);
    s.setup_done = cfg.vault_setup_done.unwrap_or(false) || cfg.vault_path.is_some();
    s.enabled = cfg.vault_sync_enabled();
    s.default_path = default_path_string();
    if s.vault_path.is_none() {
        s.vault_path = cfg.vault_path.clone();
    }
    if s.dropzone_path.is_none() {
        s.dropzone_path = s.vault_path.as_ref().map(|v| dropzone_of(Path::new(v)).to_string_lossy().to_string());
    }
    s
}

fn idle_status(app: &AppHandle, cfg: &config::DesktopConfig) -> VaultStatus {
    let mut s = VaultStatus::new("off", default_path_string());
    s.vault_path = cfg.vault_path.clone();
    if cfg.vault_path.is_none() {
        s.state = "setup".into();
    } else if !cfg.vault_sync_enabled() {
        s.state = "off".into();
    } else {
        let dir = app.path().app_config_dir().ok();
        let token = dir.as_deref().and_then(|d| secrets::load(d, &secrets::default_store()).ok().flatten());
        match token {
            None => {
                s.state = "no_account".into();
                s.message = Some(t("Connect an account, then the vault sync starts.").into());
            }
            Some(token) if !secrets::is_personal_token(&token) => {
                s.state = "no_sync_token".into();
                s.message = Some(t("Signed in with email: the vault sync needs the token from “Connect with Windows app” (web app → Settings → Connectors).").into());
            }
            Some(_) => {}
        }
    }
    s
}

fn set_status(app: &AppHandle, f: impl FnOnce(&mut VaultStatus)) {
    let snapshot = {
        let cfg = crate::commands::load_config(app);
        let mut g = sync_of(app).inner.lock().unwrap();
        let mut s = g.status.clone().unwrap_or_else(|| idle_status(app, &cfg));
        f(&mut s);
        g.status = Some(s.clone());
        s
    };
    emit(app, &status_with(app, snapshot));
}

fn log_file(app: &AppHandle) -> Option<std::fs::File> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("md-sync.log");
    if std::fs::metadata(&path).map(|m| m.len() > LOG_MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("md-sync.log.old"));
    }
    std::fs::OpenOptions::new().create(true).append(true).open(path).ok()
}

pub fn log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_log_dir().ok().map(|d| plain_path(&d).join("md-sync.log"))
}

/// App-side events (start with the exact command, exit code) in md-sync.log.
fn log_event(app: &AppHandle, line: &str) {
    if let Some(mut f) = log_file(app) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "[kortex t={secs}] {line}");
    }
}

/// Starts the sidecar when a folder, an account with a `kx_` token and the switch allow it.
/// Does nothing while one runs.
pub fn start(app: &AppHandle) {
    let cfg = crate::commands::load_config(app);
    {
        let g = sync_of(app).inner.lock().unwrap();
        if g.running.is_some() {
            return;
        }
    }
    let idle = idle_status(app, &cfg);
    if idle.state != "off" || !cfg.vault_sync_enabled() || cfg.vault_path.is_none() {
        let mut g = sync_of(app).inner.lock().unwrap();
        g.status = Some(idle.clone());
        drop(g);
        emit(app, &status_with(app, idle));
        return;
    }
    let vault = PathBuf::from(cfg.vault_path.clone().unwrap_or_default());
    let fail = |msg: String| {
        set_status(app, |s| {
            s.state = "error".into();
            s.message = Some(msg);
        })
    };
    let Ok(dir) = app.path().app_config_dir() else { return fail(t("App folder not found").into()) };
    let token = match secrets::load(&dir, &secrets::default_store()) {
        Ok(Some(t)) => t,
        _ => return fail(t("Token not readable (Windows Credential Manager)").into()),
    };
    let web = match cfg.web_url() {
        Ok(w) => w,
        Err(e) => return fail(format!("{e:#}")),
    };
    let dev = cfg!(debug_assertions).then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    let Some((node, script)) = runtime(app.path().resource_dir().ok().as_deref()).or_else(|| runtime(dev.as_deref())) else {
        return fail(if cfg!(debug_assertions) {
            t("The sync module is missing: run `node scripts/build-sidecar.mjs` in apps/desktop.").into()
        } else {
            t("The sync module is missing in this installation (sidecar/md-sync.mjs). Please reinstall Kortex.").into()
        });
    };
    let version = app.package_info().version.to_string();
    let mut cmd = Command::new(&node);
    cmd.arg(&script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(parent) = script.parent() {
        cmd.current_dir(parent);
    }
    for k in SIDECAR_ENV_REMOVE {
        cmd.env_remove(k);
    }
    for (k, v) in sidecar_env(&vault, &web, &token, &version) {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return fail(tf("md-sync does not start ({path}): {error}", &[("path", &node.display()), ("error", &e)])),
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();
    let child = Arc::new(Mutex::new(child));
    let run = {
        let mut g = sync_of(app).inner.lock().unwrap();
        g.run += 1;
        g.intended_stop = false;
        g.last_fatal = None;
        g.tail.clear();
        g.running = Some(Running { child: child.clone(), stdin, run: g.run });
        let mut s = g.status.clone().unwrap_or_else(|| VaultStatus::new("starting", default_path_string()));
        s.state = "starting".into();
        s.message = None;
        s.log_line = None;
        s.vault_path = Some(vault.to_string_lossy().to_string());
        g.status = Some(s);
        g.run
    };
    emit(app, &status(app));
    log::info!("vault sync started (run {run}): {}", vault.display());
    log_event(
        app,
        &format!("start run {run}: \"{}\" \"{}\", vault \"{}\"", node.display(), script.display(), vault.display()),
    );

    if let Some(out) = stdout {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut log = log_file(&app);
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                match parse_line(&line) {
                    Line::Status(st) => {
                        {
                            let mut g = sync_of(&app).inner.lock().unwrap();
                            if g.run != run {
                                return;
                            }
                            g.crashes = 0; // a heartbeat = healthy again
                        }
                        set_status(&app, |s| apply_status(s, &st));
                    }
                    Line::Fatal(f) => {
                        let mut g = sync_of(&app).inner.lock().unwrap();
                        if g.run == run {
                            g.last_fatal = Some(f);
                        }
                    }
                    Line::Log => {
                        sync_of(&app).inner.lock().unwrap().remember(run, &line);
                        if let Some(f) = log.as_mut() {
                            let _ = writeln!(f, "{line}");
                        }
                    }
                }
            }
        });
    }
    if let Some(err) = stderr {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut log = log_file(&app);
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                sync_of(&app).inner.lock().unwrap().remember(run, &line);
                if let Some(f) = log.as_mut() {
                    let _ = writeln!(f, "{line}");
                }
            }
        });
    }
    // Waiter: polls the child (it is shared with stop()) and decides restart or stop.
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let code = match child.lock().unwrap().try_wait() {
            Ok(Some(st)) => st.code(),
            Ok(None) => continue,
            Err(_) => None,
        };
        // Give the reader threads a moment to drain the pipes, so the tail has the last words.
        std::thread::sleep(Duration::from_millis(300));
        let (intended, fatal, crashes, log_line) = {
            let mut g = sync_of(&app).inner.lock().unwrap();
            if g.run != run {
                return;
            }
            g.running = None;
            let tail: Vec<String> = g.tail.iter().cloned().collect();
            (g.intended_stop, g.last_fatal.take(), g.crashes, summarize_log(&tail))
        };
        log::info!("vault sync exited (run {run}, code {code:?})");
        log_event(&app, &format!("run {run} exited, code {code:?}"));
        match on_exit(code, intended, fatal.as_ref(), crashes) {
            ExitAction::Stop { state, message } => {
                let cfg = crate::commands::load_config(&app);
                if state == "off" {
                    let idle = idle_status(&app, &cfg);
                    sync_of(&app).inner.lock().unwrap().status = Some(idle.clone());
                    emit(&app, &status_with(&app, idle));
                } else {
                    set_status(&app, |s| {
                        s.state = state.into();
                        s.message = Some(message);
                        s.log_line = log_line;
                    });
                }
            }
            ExitAction::Restart(wait) => {
                let msg = fatal.map(|f| f.message).unwrap_or_else(|| tf("md-sync exited (code {code})", &[("code", &code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()))]));
                set_status(&app, |s| {
                    s.state = "error".into();
                    s.message = Some(tf("{message}. Retrying in {seconds} s.", &[("message", &msg), ("seconds", &wait.as_secs())]));
                    s.log_line = log_line;
                });
                sync_of(&app).inner.lock().unwrap().crashes = crashes + 1;
                std::thread::sleep(wait);
                // Not if someone stopped or restarted it meanwhile.
                if sync_of(&app).inner.lock().unwrap().run == run {
                    start(&app);
                }
            }
        }
        return;
    });
}

/// Stops the sidecar: "stop" on stdin, killed after `STOP_GRACE`. `wait` blocks until it is gone
/// (app exit, restart); otherwise it returns at once.
pub fn stop(app: &AppHandle, wait: bool) {
    let running = {
        let mut g = sync_of(app).inner.lock().unwrap();
        g.intended_stop = true;
        // Cancels a restart that waits in its backoff, and mutes the old process's threads.
        g.run += 1;
        g.running.take()
    };
    let Some(mut r) = running else { return };
    if let Some(mut stdin) = r.stdin.take() {
        let _ = writeln!(stdin, "stop");
        let _ = stdin.flush();
        drop(stdin); // EOF: md-sync stops on stdin end as well
    }
    let child = r.child.clone();
    let run = r.run;
    let reap = move || {
        let deadline = Instant::now() + STOP_GRACE;
        loop {
            if matches!(child.lock().unwrap().try_wait(), Ok(Some(_)) | Err(_)) {
                return;
            }
            if Instant::now() >= deadline {
                log::warn!("vault sync (run {run}) did not stop in time, killing it");
                let _ = child.lock().unwrap().kill();
                let _ = child.lock().unwrap().wait();
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    };
    if wait {
        reap();
    } else {
        std::thread::spawn(reap);
    }
    let cfg = crate::commands::load_config(app);
    let mut idle = idle_status(app, &cfg);
    if idle.state == "off" && cfg.vault_sync_enabled() && cfg.vault_path.is_some() {
        idle.state = "starting".into(); // a restart follows
    }
    sync_of(app).inner.lock().unwrap().status = Some(idle);
}

/// Stop, then start again with the current settings (folder, token, switch).
pub fn restart(app: &AppHandle) {
    // Show the new settings right away (folder, switch, account); the process follows.
    let cfg = crate::commands::load_config(app);
    let mut next = idle_status(app, &cfg);
    if next.state == "off" && cfg.vault_sync_enabled() && cfg.vault_path.is_some() {
        next.state = "starting".into();
    }
    sync_of(app).inner.lock().unwrap().status = Some(next);
    emit(app, &status(app));
    let app = app.clone();
    std::thread::spawn(move || {
        stop(&app, true);
        sync_of(&app).inner.lock().unwrap().crashes = 0;
        start(&app);
    });
}

/// "Jetzt synchronisieren": full reconcile in the running daemon.
pub fn sync_now(app: &AppHandle) -> Result<(), String> {
    let mut g = sync_of(app).inner.lock().unwrap();
    let r = g.running.as_mut().ok_or(t("The vault sync is not running right now"))?;
    let stdin = r.stdin.as_mut().ok_or(t("The vault sync is not running right now"))?;
    writeln!(stdin, "sync").and_then(|_| stdin.flush()).map_err(|e| format!("{e}"))
}

/// Opens md-sync.log in the default editor (the folder when there is no log yet).
pub fn open_log(log: &Path) -> Result<(), String> {
    if log.is_file() {
        #[cfg(windows)]
        let mut cmd = Command::new("explorer.exe");
        #[cfg(target_os = "macos")]
        let mut cmd = Command::new("open");
        #[cfg(all(unix, not(target_os = "macos")))]
        let mut cmd = Command::new("xdg-open");
        return cmd.arg(log).spawn().map(|_| ()).map_err(|e| format!("{e}"));
    }
    open_folder(log.parent().ok_or(t("Log folder not found"))?, true)
}

/// Opens a folder in the Explorer (creating the Dropzone if needed; never touches files).
pub fn open_folder(path: &Path, create: bool) -> Result<(), String> {
    if create {
        std::fs::create_dir_all(path).map_err(|e| tf("Create folder: {error}", &[("error", &e)]))?;
    }
    if !path.exists() {
        return Err(tf("{path} does not exist yet", &[("path", &path.display())]));
    }
    #[cfg(windows)]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(path).spawn().map(|_| ()).map_err(|e| format!("{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("kortex-vault-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn parses_status_and_fatal_lines() {
        let l = parse_line(r#"@@kortex-status {"state":"running","realtime":"connected","vault_path":"C:\\V","last_sync_at":"2026-11-03T10:00:00Z","pending_local":2,"items_tracked":40,"stats":{"dropzone_processed":3,"dropzone_failed":1,"errors":0},"version":"0.6.0","at":"2026-11-03T10:00:01Z"}"#);
        let Line::Status(s) = l else { panic!("status expected") };
        let mut st = VaultStatus::new("starting", "C:\\Users\\x\\KortexVault".into());
        apply_status(&mut st, &s);
        assert_eq!(st.state, "running");
        assert_eq!(st.vault_path.as_deref(), Some("C:\\V"));
        assert_eq!(st.pending_local, 2);
        assert_eq!(st.items_tracked, Some(40));
        assert_eq!(st.dropzone, DropzoneStats { processed: 3, duplicates: 0, failed: 1, pending: 0 });
        assert_eq!(st.realtime.as_deref(), Some("connected"));
        // An old error before the last clean reconcile is not shown, a newer one is.
        let old = StatusLine { last_error: Some("x".into()), last_error_at: Some("2026-11-03T09:00:00.000Z".into()), last_success_at: Some("2026-11-03T10:00:00.000Z".into()), ..Default::default() };
        apply_status(&mut st, &old);
        assert_eq!(st.last_error, None);
        let new = StatusLine { last_error_at: Some("2026-11-03T11:00:00.000Z".into()), ..old };
        apply_status(&mut st, &new);
        assert_eq!(st.last_error.as_deref(), Some("x"));
        assert_eq!(
            parse_line(r#"@@kortex-fatal {"kind":"auth","message":"API-Token wurde widerrufen"}"#),
            Line::Fatal(FatalLine { kind: "auth".into(), message: "API-Token wurde widerrufen".into() })
        );
        assert_eq!(parse_line("[info] md-sync running {}"), Line::Log);
        assert_eq!(parse_line("@@kortex-status {broken"), Line::Log);
    }

    #[test]
    fn exit_codes_decide_restart_or_stop() {
        assert_eq!(on_exit(Some(1), false, None, 0), ExitAction::Restart(Duration::from_secs(5)));
        assert_eq!(on_exit(None, false, None, 7), ExitAction::Restart(Duration::from_secs(300)));
        assert!(matches!(on_exit(Some(1), true, None, 0), ExitAction::Stop { state: "off", .. }));
        let f = FatalLine { kind: "auth".into(), message: "API-Token darf hier nicht verwendet werden".into() };
        let ExitAction::Stop { state, message } = on_exit(Some(3), false, Some(&f), 0) else { panic!() };
        assert_eq!(state, "no_sync_token");
        assert!(message.contains("nicht verwendet") && message.contains("Mit Windows-App verbinden"));
        assert!(matches!(on_exit(Some(2), false, None, 0), ExitAction::Stop { state: "error", .. }));
        let ExitAction::Stop { message, .. } = on_exit(Some(4), false, None, 0) else { panic!() };
        assert!(message.contains("0.6.0"));
        assert!(matches!(on_exit(Some(5), false, None, 0), ExitAction::Stop { state: "error", .. }));
        assert!(backoff(0) < backoff(1) && backoff(2) < backoff(3) && backoff(3) == backoff(9));
    }

    #[test]
    fn folder_checks_protect_user_data() {
        let home = tmp("home");
        std::fs::create_dir_all(&home).unwrap();
        // Missing folder: fine, md-sync creates it.
        let c = check_folder(&home.join("KortexVault"), Some(&home));
        assert!(!c.exists && c.empty && c.refused.is_none() && !c.needs_confirm);
        // Home itself, a drive root and relative paths are refused.
        assert!(check_folder(&home, Some(&home)).refused.is_some());
        assert!(check_folder(Path::new("KortexVault"), Some(&home)).refused.is_some());
        #[cfg(windows)]
        {
            assert!(check_folder(Path::new("C:\\"), Some(&home)).refused.is_some());
            assert!(check_folder(Path::new("C:\\Windows\\Temp\\v"), Some(&home)).refused.is_some());
            assert!(check_folder(Path::new("C:\\Program Files\\Kortex"), Some(&home)).refused.is_some());
            // Only the real system roots: a "Windows" folder of the user is fine.
            assert!(check_folder(Path::new("D:\\Backup\\Windows-Notizen"), Some(&home)).refused.is_none());
        }
        // A folder with unrelated files needs a confirmation; md files at the root are counted.
        let docs = home.join("Dokumente");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(docs.join("brief.md"), "x").unwrap();
        std::fs::write(docs.join("bild.png"), "x").unwrap();
        let c = check_folder(&docs, Some(&home));
        assert!(c.exists && !c.empty && !c.kortex_vault && c.needs_confirm);
        assert_eq!((c.entries, c.md_at_root), (2, 1));
        // An existing Kortex vault (e.g. from the CLI daemon) is taken as it is.
        let vault = home.join("KortexVault");
        std::fs::create_dir_all(vault.join("10_Notes")).unwrap();
        let c = check_folder(&vault, Some(&home));
        assert!(c.kortex_vault && !c.needs_confirm && c.refused.is_none());
        // A file is not a folder.
        assert!(check_folder(&docs.join("brief.md"), Some(&home)).refused.is_some());
        // check_folder never writes.
        assert_eq!(std::fs::read_dir(&docs).unwrap().count(), 2);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn default_path_dropzone_and_runtime() {
        let home = PathBuf::from(if cfg!(windows) { "C:\\Users\\max" } else { "/home/max" });
        assert_eq!(default_vault_path(Some(&home)), home.join("KortexVault"));
        assert_eq!(dropzone_of(&home.join("KortexVault")), home.join("KortexVault").join("00_Inbox").join("Dropzone"));
        let res = tmp("res");
        assert_eq!(runtime(Some(&res)), None);
        std::fs::create_dir_all(res.join("sidecar")).unwrap();
        std::fs::write(res.join("sidecar").join("md-sync.mjs"), "").unwrap();
        // Without a bundled node: the one on PATH (dev builds).
        assert_eq!(runtime(Some(&res)), Some((PathBuf::from("node"), res.join("sidecar").join("md-sync.mjs"))));
        let node = res.join("sidecar").join(if cfg!(windows) { "node.exe" } else { "node" });
        std::fs::write(&node, "").unwrap();
        assert_eq!(runtime(Some(&res)).unwrap().0, node);
        let _ = std::fs::remove_dir_all(res);
    }

    #[test]
    fn plain_path_drops_the_verbatim_prefix() {
        let p = |s: &str| plain_path(Path::new(s));
        assert_eq!(p(r"\\?\C:\Users\max\AppData\Local\Kortex"), PathBuf::from(r"C:\Users\max\AppData\Local\Kortex"));
        assert_eq!(p(r"\\?\C:\Program Files\Kortex App"), PathBuf::from(r"C:\Program Files\Kortex App"));
        assert_eq!(p(r"\\?\UNC\nas\share\Kortex"), PathBuf::from(r"\\nas\share\Kortex"));
        assert_eq!(p(r"C:\Users\max\OneDrive\My Files\Kortex Vault"), PathBuf::from(r"C:\Users\max\OneDrive\My Files\Kortex Vault"));
        assert_eq!(p(r"\\?\Volume{1234}\x"), PathBuf::from(r"\\?\Volume{1234}\x"));
        let env = sidecar_env(Path::new(r"\\?\C:\Users\max\OneDrive\My Files\Kortex Vault"), "https://k", "kx_a", "0.6.1");
        assert_eq!(env[0].1, r"C:\Users\max\OneDrive\My Files\Kortex Vault");
    }

    /// The 0.6.0 bug end to end: resource_dir() as `\\?\` with spaces in the path. Node must start
    /// the script (it failed with `EISDIR: lstat 'C:'` before). Skipped without node on PATH.
    #[cfg(windows)]
    #[test]
    fn sidecar_starts_from_a_verbatim_path_with_spaces() {
        let res = tmp("res space").join("Kortex App 0.6");
        let side = res.join("sidecar");
        std::fs::create_dir_all(&side).unwrap();
        std::fs::write(side.join("md-sync.mjs"), "console.log('started ' + process.argv[1]);\n").unwrap();
        let verbatim = PathBuf::from(format!(r"\\?\{}", res.display()));
        assert!(verbatim.join("sidecar").join("md-sync.mjs").is_file());
        let (_node, script) = runtime(Some(&verbatim)).unwrap();
        assert!(!script.to_string_lossy().starts_with(r"\\?\"), "{}", script.display());
        assert_eq!(script, side.join("md-sync.mjs"));
        let Ok(out) = Command::new("node").arg(&script).current_dir(script.parent().unwrap()).output() else {
            eprintln!("node not on PATH, skipped");
            return;
        };
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(out.status.success(), "node failed: {}", String::from_utf8_lossy(&out.stderr));
        assert!(stdout.contains("started") && stdout.contains("Kortex App 0.6"), "{stdout}");
        let _ = std::fs::remove_dir_all(res.parent().unwrap());
    }

    #[test]
    fn summarize_log_finds_the_cause() {
        // The 0.6.0 crash as it was in md-sync.log.
        let crash = [
            "node:fs:2806",
            "    const out = binding.lstat(base, false, undefined, true /* throwIfNoEntry */);",
            "                        ^",
            "",
            "Error: EISDIR: illegal operation on a directory, lstat 'C:'",
            "    at Object.realpathSync (node:fs:2806:25)",
            "    at node:internal/main/run_main_module:33:47 {",
            "  errno: -4068,",
            "  code: 'EISDIR',",
            "}",
            "",
            "Node.js v24.20.0",
        ];
        assert_eq!(summarize_log(&crash).as_deref(), Some("Error: EISDIR: illegal operation on a directory, lstat 'C:'"));
        let logged = [
            "2026-11-03T10:00:00.000Z info  md-sync starting {}",
            "2026-11-03T10:00:01.000Z error realtime failed {\"error\":\"x\"}",
            "2026-11-03T10:00:02.000Z info  stopping",
        ];
        assert_eq!(summarize_log(&logged).as_deref(), Some("2026-11-03T10:00:01.000Z error realtime failed {\"error\":\"x\"}"));
        assert_eq!(summarize_log(&["md-sync: KORTEX_SYNC_TOKEN must be a personal kx_ token"]).as_deref(), Some("KORTEX_SYNC_TOKEN must be a personal kx_ token"));
        assert_eq!(summarize_log(&["hello", "Node.js v24.20.0"]).as_deref(), Some("hello"));
        assert_eq!(summarize_log::<&str>(&[]), None);
        let long = "x".repeat(400);
        assert_eq!(summarize_log(&[long.as_str()]).unwrap().chars().count(), 301);
    }

    #[test]
    fn sidecar_env_carries_the_token_never_the_service_role() {
        let env = sidecar_env(Path::new("C:\\V"), "https://kortex.example.com", "kx_abc", "0.6.0");
        let get = |k: &str| env.iter().find(|(n, _)| *n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("KORTEX_SYNC_TOKEN"), Some("kx_abc"));
        assert_eq!(get("KORTEX_API_URL"), Some("https://kortex.example.com"));
        assert_eq!(get("KORTEX_SYNC_STATUS_STDOUT"), Some("1"));
        assert!(env.iter().all(|(k, _)| !k.contains("SERVICE_ROLE")));
        assert!(SIDECAR_ENV_REMOVE.contains(&"SUPABASE_SERVICE_ROLE_KEY"));
        assert!(SIDECAR_ENV_REMOVE.contains(&"NODE_OPTIONS"));
    }
}
