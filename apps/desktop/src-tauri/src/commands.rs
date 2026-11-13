//! Tauri commands; names and payloads mirror `apps/desktop/src/bridge/contract.ts`.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::config::{config_path, DesktopConfig};
use crate::i18n::{t, tf};
use crate::{audio, autostart, autostop, config, connect, deepgram, i18n, inject, launcher, live, reminders, secrets, selftest, tray, upload, vault, window, AppState, STEALTH_WINDOWS};

type CmdResult<T> = Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Windows that draw level meters (HUD / pill, Audio-Setup): ~30 events per second do not go to the
/// web app in `main` or the hidden launcher / tray (each emit runs script in every webview it reaches).
pub fn shows_levels(target: &tauri::EventTarget) -> bool {
    match target {
        tauri::EventTarget::WebviewWindow { label } | tauri::EventTarget::Webview { label } | tauri::EventTarget::Window { label } => {
            !matches!(label.as_str(), "main" | "capture" | "tray")
        }
        _ => true,
    }
}

fn emit_levels(app: &AppHandle, levels: audio::LevelsPayload) {
    let _ = app.emit_filter("audio:levels", levels, shows_levels);
}

fn level_sink(app: &AppHandle) -> audio::LevelSink {
    let app = app.clone();
    Box::new(move |levels| emit_levels(&app, levels))
}

/// Levels of a meeting recording; sound on either channel also resets the auto-stop silence clock.
fn meeting_level_sink(app: &AppHandle) -> audio::LevelSink {
    let app = app.clone();
    Box::new(move |levels| {
        if autostop::is_sound(&levels) {
            *app.state::<AppState>().last_sound.lock().unwrap() = Some(std::time::Instant::now());
        }
        emit_levels(&app, levels);
    })
}

fn recordings_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(err)?.join("recordings"))
}

fn stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

pub fn load_config(app: &AppHandle) -> DesktopConfig {
    app.path().app_config_dir().ok().and_then(|d| DesktopConfig::load(&config_path(&d)).ok()).unwrap_or_default()
}

fn config_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path().app_config_dir().map_err(err)
}

fn connected(app: &AppHandle) -> bool {
    config_dir(app).map(|d| secrets::is_connected(&d, &secrets::default_store())).unwrap_or(false)
}

/// Connected with a personal API token (capture and transcription only, no live meeting).
fn token_only(app: &AppHandle) -> bool {
    config_dir(app).map(|d| secrets::uses_personal_token(&d, &secrets::default_store())).unwrap_or(false)
}

/// Fresh access token; the rotated refresh token is persisted before anything else runs.
async fn access_token(app: &AppHandle) -> CmdResult<String> {
    secrets::access_token(&config_dir(app)?, &secrets::default_store()).await.map_err(err)
}

/// `file` must be a `.wav` inside `dir` (both canonicalized, so `..` and links cannot escape;
/// review N5 #4).
pub fn ensure_recording_path(dir: &Path, file: &Path) -> anyhow::Result<PathBuf> {
    let dir = dunce_canonical(dir)?;
    let file = dunce_canonical(file)?;
    if !file.starts_with(&dir) {
        anyhow::bail!(t("File is not in the recordings folder"));
    }
    if !file.extension().is_some_and(|e| e.eq_ignore_ascii_case("wav")) || !file.is_file() {
        anyhow::bail!(t("Only WAV recordings can be uploaded"));
    }
    Ok(file)
}

fn dunce_canonical(p: &Path) -> anyhow::Result<PathBuf> {
    Ok(std::fs::canonicalize(p).map_err(|e| anyhow::anyhow!("{}: {e}", p.display()))?)
}

#[derive(Serialize)]
pub struct MeetingState {
    recording: bool,
    elapsed: u64,
    /// Live session in the web app (W1); None without an account or while it opens.
    item_id: Option<String>,
    title: Option<String>,
    transcriber: Option<String>,
    connected: bool,
    /// Stealth mode (HUD and overlays hidden from screen capture); every window shows the same.
    stealth: bool,
    /// Devices of the running recording (microphone, loopback source) and why the microphone was
    /// switched away from the Windows default.
    devices: Option<audio::InUse>,
}

#[tauri::command]
pub fn get_meeting_state(app: AppHandle, state: State<'_, AppState>) -> MeetingState {
    let rec = state.recorder.lock().unwrap();
    let live = state.live.lock().unwrap().clone();
    MeetingState {
        recording: rec.is_some(),
        elapsed: rec.as_ref().map(|r| r.recorder.elapsed_secs()).unwrap_or(0),
        item_id: live.as_ref().and_then(|s| s.item_id()),
        title: live.as_ref().map(|s| s.title.clone()),
        transcriber: live.as_ref().and_then(|s| s.transcriber()),
        connected: connected(&app),
        stealth: *state.stealth.lock().unwrap(),
        devices: rec.as_ref().map(|r| r.recorder.devices.clone()),
    }
}

/// The live API with the connected account (self-test online mode).
pub fn live_api_for(app: &AppHandle) -> CmdResult<live::Api> {
    live_api(app)
}

fn live_api(app: &AppHandle) -> CmdResult<live::Api> {
    live::Api::new(&load_config(app), config_dir(app)?).map_err(err)
}

/// The API of the running live session (the self-test's stub included), else the configured one.
fn session_api(app: &AppHandle, state: &AppState) -> CmdResult<live::Api> {
    match state.live_api.lock().unwrap().clone() {
        Some(a) => Ok(a),
        None => live_api(app),
    }
}

fn current_session(state: &AppState) -> CmdResult<std::sync::Arc<live::Session>> {
    state.live.lock().unwrap().clone().ok_or_else(|| t("No recording is running").to_string())
}

/// Starts the dual-channel capture into `recordings/<time>.wav`. With a connected account the
/// meeting runs live (live.rs): session in the web app, live transcript through the user's ADR-06
/// route (Deepgram only with `DEEPGRAM_API_KEY` as an override), coaching cards. Without an
/// account it only records locally.
#[tauri::command]
pub fn start_recording(app: AppHandle, state: State<'_, AppState>) -> CmdResult<MeetingState> {
    start_recording_inner(&app, &state)
}

pub fn start_recording_inner(app: &AppHandle, state: &AppState) -> CmdResult<MeetingState> {
    start_recording_from(app, state, false)
}

/// `from_main`: started in the web app of the main window (Orbit-Bar, main_bridge.rs). Then the HUD
/// stays out of the way while the main window is in front (the web app shows the meeting itself) and
/// the pill comes as soon as it is minimized (window.rs `mode_on_start`).
pub fn start_recording_from(app: &AppHandle, state: &AppState, from_main: bool) -> CmdResult<MeetingState> {
    let mut slot = state.recorder.lock().unwrap();
    if slot.is_none() {
        // Self-test (selftest.rs): generated audio and the stub (or real) API instead.
        let test = state.selftest.lock().unwrap().take();
        let is_test = test.is_some();
        let deepgram_key = !is_test && std::env::var("DEEPGRAM_API_KEY").map(|k| !k.trim().is_empty()).unwrap_or(false);
        // Live session with any connected account (sign-in or personal API token) and a valid web URL.
        let api = match &test {
            Some(t) => Some(t.api.clone()),
            None if connected(app) => live_api(app).map_err(|e| log::warn!("live api: {e}")).ok(),
            None => None,
        };
        let path = if is_test {
            std::env::temp_dir().join(format!("kortex-selftest-{}.wav", stamp()))
        } else {
            recordings_dir(app)?.join(format!("{}.wav", stamp()))
        };
        let opts = audio::StartOptions {
            input: state.input_device.lock().unwrap().clone(),
            output: state.output_device.lock().unwrap().clone(),
            wav_path: Some(path),
            loopback: true,
            live_frames: deepgram_key || api.is_some(),
            synthetic: test.map(|t| t.audio),
        };
        *state.last_sound.lock().unwrap() = Some(std::time::Instant::now());
        let mut rec = audio::start(opts, meeting_level_sink(app)).map_err(err)?;
        log::info!("recording started: mic {:?}, loopback {:?}, live {}", rec.devices.mic, rec.devices.sys, api.is_some());
        let _ = app.emit("meeting:devices", &rec.devices);
        let title = if is_test { t("Kortex self-test").to_string() } else { format!("Meeting {}", chrono::Local::now().format("%d.%m.%Y %H:%M")) };
        let session = api.as_ref().map(|_| live::Session::new(title.clone(), chrono::Local::now().to_rfc3339()));
        if let (Some(s), Some(api)) = (&session, &api) {
            tauri::async_runtime::spawn(live::open(app.clone(), s.clone(), api.clone(), deepgram_key.then(|| "deepgram:nova-3".to_string())));
            tauri::async_runtime::spawn(live::coach_loop(app.clone(), s.clone(), api.clone()));
        } else {
            let message = if connected(app) {
                t("Recording is local only: web address invalid (settings)")
            } else {
                t("Recording is local only: no account connected, so no transcript and no minutes")
            };
            let _ = app.emit("transcript:status", serde_json::json!({ "state": "off", "message": message }));
        }
        if let Some(frames) = rec.frames.take() {
            let app2 = app.clone();
            let live_pair = session.clone().zip(api.clone());
            let handle = if deepgram_key {
                // Optional override; reconnects and falls back to the ADR-06 route by itself.
                tauri::async_runtime::spawn(deepgram::run(app2, frames, live_pair))
            } else {
                let (s, api) = live_pair.expect("live frames only with an account");
                tauri::async_runtime::spawn(live::transcribe(app2, s, api, frames))
            };
            if let Some(s) = &session {
                *s.worker.lock().unwrap() = Some(handle);
            }
        }
        *state.live_api.lock().unwrap() = session.as_ref().and(api.clone());
        *state.live.lock().unwrap() = session;
        // 1 Hz clock for the HUD / pill / title bar, and the auto-stop (10 min silence, 4 h).
        let app3 = app.clone();
        let started = rec.started;
        tauri::async_runtime::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                tick.tick().await;
                let st = app3.state::<AppState>();
                let running = st.recorder.lock().unwrap().as_ref().map(|r| r.recorder.started == started).unwrap_or(false);
                if !running {
                    break;
                }
                let _ = app3.emit("meeting:tick", serde_json::json!({ "elapsed": started.elapsed().as_secs() }));
                let silent_for = st.last_sound.lock().unwrap().map(|t| t.elapsed()).unwrap_or_default();
                if let Some(reason) = autostop::check(started.elapsed(), silent_for) {
                    auto_stop(&app3, reason);
                    break;
                }
            }
        });
        *slot = Some(crate::Recording { recorder: rec, started_at: chrono::Local::now().to_rfc3339() });
        drop(slot);
        tray::set_recording(app, true);
        // A recording is a deliberate act: no automatic HUD switch is pending any more.
        *state.hud_restore.lock().unwrap() = None;
        // Started from the tray, a hotkey or the Meeting-Center: the live HUD comes up by itself.
        // From the Orbit-Bar in the main window: nothing while it is in front, else the pill.
        let hud_visible = app.get_webview_window("hud").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
        let mode = state.hud_mode.lock().unwrap().clone();
        let away = window::main_away(app);
        if let Some(next) = window::mode_on_start(from_main, away, &mode, hud_visible) {
            if from_main {
                // The main window comes back: the HUD as it was before the pill.
                *state.hud_restore.lock().unwrap() = Some(mode.clone());
            }
            window::switch_hud(app, next);
        }
    }
    let _ = app.emit("meeting:state", serde_json::json!({ "recording": true, "elapsed": 0 }));
    let live = state.live.lock().unwrap().clone();
    Ok(MeetingState {
        recording: true,
        elapsed: 0,
        item_id: live.as_ref().and_then(|s| s.item_id()),
        title: live.as_ref().map(|s| s.title.clone()),
        transcriber: None,
        connected: live.is_some(),
        stealth: *state.stealth.lock().unwrap(),
        // Not from `recorder`: its lock is still held here when a recording already ran.
        devices: None,
    })
}

/// Stops a recording the user forgot: same path as "Aufnahme beenden" (upload, protocol), plus a
/// Windows notification and `meeting:autostop` for the HUD.
fn auto_stop(app: &AppHandle, reason: autostop::Reason) {
    use tauri_plugin_notification::NotificationExt;
    let st = app.state::<AppState>();
    match stop_recording_inner(app, &st) {
        Ok(res) => {
            log::info!("auto-stop ({}) after {:.0} s: {}", reason.id(), res.seconds, res.file);
            let _ = app.emit("meeting:autostop", serde_json::json!({ "reason": reason.id(), "message": reason.message(), "uploading": res.uploading }));
            let body = if res.uploading { t("The minutes are being created.") } else { t("The recording is stored locally in the recordings folder.") };
            let _ = app.notification().builder().title(reason.message()).body(body).show();
        }
        Err(e) => log::warn!("auto-stop failed: {e}"),
    }
}

#[derive(Serialize)]
pub struct StopResult {
    /// Local WAV path of the recording.
    pub file: String,
    pub seconds: f64,
    /// true when the transcript upload started (account connected, auto upload on).
    pub uploading: bool,
}

/// Stops capture and finalizes the WAV. With a connected account the recording is transcribed and
/// ingested as a meeting in the background; progress arrives as `meeting:upload` events
/// (`{ state: "uploading" | "done" | "error", item_id?, folder_path?, message? }`).
#[tauri::command]
pub fn stop_recording(app: AppHandle, state: State<'_, AppState>) -> CmdResult<StopResult> {
    stop_recording_inner(&app, &state)
}

pub fn stop_recording_inner(app: &AppHandle, state: &AppState) -> CmdResult<StopResult> {
    let rec = state.recorder.lock().unwrap().take().ok_or(t("No recording is running"))?;
    let started_at = rec.started_at.clone();
    let session = state.live.lock().unwrap().take();
    let session_api = state.live_api.lock().unwrap().take();
    tray::set_recording(app, false);
    // The pill stays until the main window is back: it shows "Protokoll …" and then "Gespeichert".
    let stopped = rec.recorder.stop();
    let cfg = load_config(app);
    let uploading = session.is_some() || (connected(app) && cfg.auto_upload());
    // Every window learns whether a result (meeting:upload) follows, so none waits for nothing.
    let seconds = stopped.as_ref().map(|s| s.seconds as u64).unwrap_or(0);
    let path = stopped.as_ref().ok().and_then(|s| s.path.clone());
    let uploading = uploading && path.is_some();
    let _ = app.emit("meeting:state", serde_json::json!({ "recording": false, "elapsed": seconds, "uploading": uploading }));
    let summary = stopped.map_err(err)?;
    let path = path.ok_or(t("No recording file"))?;
    log::info!("recording stopped: {:.1} s, live session {}, upload {uploading}", summary.seconds, session.is_some());
    if let Some(s) = session {
        // Live session: end it (the protocol starts in the web app) even without auto upload, with
        // the API the session was opened with.
        let api = match session_api {
            Some(a) => a,
            None => live_api(app)?,
        };
        tauri::async_runtime::spawn(live::finish(app.clone(), s, api, cfg, Some(path.clone())));
        return Ok(StopResult { file: path.display().to_string(), seconds: summary.seconds, uploading: true });
    }
    if uploading {
        spawn_upload(app.clone(), cfg, path.clone(), started_at);
    } else {
        // Local only: no result follows, the pill can go after "Gespeichert".
        window::after_recording(app);
    }
    Ok(StopResult { file: path.display().to_string(), seconds: summary.seconds, uploading })
}

fn spawn_upload(app: AppHandle, cfg: DesktopConfig, path: PathBuf, started_at: String) {
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("meeting:upload", serde_json::json!({ "state": "uploading" }));
        let title = format!("Meeting {}", chrono::Local::now().format("%d.%m.%Y %H:%M"));
        let result = match access_token(&app).await {
            Ok(token) => upload::upload_meeting(&cfg, &token, &path, &title, &started_at).await,
            Err(e) => Err(anyhow::anyhow!(e)),
        };
        match result {
            Ok(res) => {
                let _ = app.emit("meeting:upload", serde_json::json!({ "state": "done", "item_id": res.item_id, "folder_path": res.folder_path, "segments": res.segments }));
            }
            Err(e) => {
                log::error!("meeting upload failed: {e:#}");
                let _ = app.emit("meeting:upload", serde_json::json!({ "state": "error", "message": format!("{e:#}"), "file": path.display().to_string() }));
            }
        }
    });
}

/// Uploads a finished recording again (after an error, or without auto upload).
#[tauri::command]
pub fn upload_recording(app: AppHandle, file: String) -> CmdResult<()> {
    let path = ensure_recording_path(&recordings_dir(&app)?, Path::new(&file)).map_err(err)?;
    if !connected(&app) {
        return Err(t("No account connected (Settings → Connect account)").into());
    }
    spawn_upload(app.clone(), load_config(&app), path, chrono::Local::now().to_rfc3339());
    Ok(())
}

#[derive(Serialize)]
pub struct AccountStatus {
    connected: bool,
    email: Option<String>,
    /// Validated web URL, or the reason it is refused (only https:// or localhost).
    web_url: String,
    web_url_error: Option<String>,
    /// No server known yet (first start of a build without its own Kortex): the settings ask for one.
    needs_server: bool,
    has_anon_key: bool,
    /// Connected with a personal API token (`kx_…`) instead of the Supabase sign-in.
    api_token: bool,
}

#[tauri::command]
pub fn account_status(app: AppHandle) -> AccountStatus {
    let cfg = load_config(&app);
    let (web_url, web_url_error) = match cfg.web_url() {
        Ok(u) => (u, None),
        Err(e) => (String::new(), Some(e.to_string())),
    };
    AccountStatus { connected: connected(&app), email: cfg.email.clone(), web_url, web_url_error, needs_server: !cfg.has_server(), has_anon_key: cfg.anon_key().is_some(), api_token: token_only(&app) }
}

/// What `GET <web>/api/instance` answers (apps/web): who the server is and its public Supabase config.
#[derive(serde::Deserialize)]
struct InstanceInfo {
    app: Option<String>,
    supabase: Option<InstanceSupabase>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceSupabase {
    url: Option<String>,
    anon_key: Option<String>,
}

/// "Server verbinden": the address of the user's Kortex. Checks that a Kortex answers there
/// (`/api/instance`), stores the address with the server's public Supabase config in desktop.json
/// and points the main window at it. An existing account connection belongs to the old server and
/// is dropped.
#[tauri::command]
pub async fn set_server(app: AppHandle, url: String) -> CmdResult<AccountStatus> {
    let typed = url.trim();
    let typed = if typed.contains("://") { typed.to_string() } else { format!("https://{typed}") };
    let web = config::secure_base_url(&typed).map_err(err)?;
    let res = upload::http_client(std::time::Duration::from_secs(15))
        .map_err(err)?
        .get(format!("{web}/api/instance"))
        .send()
        .await
        .map_err(|_| t("Server not reachable. Check the address and the connection.").to_string())?;
    if !res.status().is_success() {
        return Err(tf("No Kortex answers at this address (HTTP {status})", &[("status", &res.status().as_u16())]));
    }
    let info: InstanceInfo = res.json().await.map_err(|_| t("No Kortex answers at this address").to_string())?;
    if info.app.as_deref() != Some("kortex") {
        return Err(t("No Kortex answers at this address").into());
    }
    let dir = config_dir(&app)?;
    let switched = load_config(&app).web_url().ok().as_deref() != Some(web.as_str());
    if switched && connected(&app) {
        secrets::sign_out(&dir, &secrets::default_store()).await.map_err(err)?;
    }
    let supabase = info.supabase;
    config::update(&dir, |c| {
        c.web_url = Some(web.clone());
        if let Some(s) = supabase {
            c.supabase_url = s.url.map(|u| u.trim_end_matches('/').to_string()).filter(|u| !u.is_empty());
            c.supabase_anon_key = s.anon_key.filter(|k| !k.trim().is_empty());
        }
    })
    .map_err(err)?;
    crate::main_bridge::register(&app, &web);
    navigate_main(&app, "/home");
    let _ = app.emit("account:changed", serde_json::json!({ "connected": false }));
    vault::restart(&app);
    let _ = show_main(app.clone());
    Ok(account_status(app))
}

/// "Konto verbinden": signs in to the Kortex Supabase project. Only the refresh token is stored.
#[tauri::command]
pub async fn connect_account(app: AppHandle, email: String, password: String) -> CmdResult<AccountStatus> {
    secrets::sign_in(&config_dir(&app)?, &secrets::default_store(), email.trim(), &password).await.map_err(err)?;
    vault::restart(&app);
    Ok(account_status(app))
}

/// "Mit API-Token verbinden": a personal token from the web app (`kx_…`) instead of a sign-in.
#[tauri::command]
pub async fn connect_token(app: AppHandle, token: String) -> CmdResult<AccountStatus> {
    secrets::connect_token(&config_dir(&app)?, &secrets::default_store(), &token).await.map_err(err)?;
    vault::restart(&app);
    Ok(account_status(app))
}

#[tauri::command]
pub async fn disconnect_account(app: AppHandle) -> CmdResult<AccountStatus> {
    secrets::sign_out(&config_dir(&app)?, &secrets::default_store()).await.map_err(err)?;
    vault::restart(&app); // stops it; without an account it stays off
    Ok(account_status(app))
}

#[tauri::command]
pub fn set_hud_mode(app: AppHandle, state: State<'_, AppState>, mode: String) -> CmdResult<()> {
    // The user decided: nothing to restore automatically when the main window comes back.
    // "qc" only shows the launcher: the HUD stays as it is, and its window must not switch its React
    // state to "qc" (it would render nothing while staying visible on top, audit D-03).
    if mode == "qc" {
        return window::apply_hud_mode(&app, "qc").map_err(err);
    }
    *state.hud_restore.lock().unwrap() = None;
    let recording = state.recorder.lock().unwrap().is_some();
    let mode = window::effective_mode(&mode, recording, window::main_away(&app)).to_string();
    window::apply_hud_mode(&app, &mode).map_err(err)?;
    // Keep every window's React state in sync (tray menu, pill).
    app.emit("hud:mode", serde_json::json!({ "mode": mode })).map_err(err)
}

#[tauri::command]
pub fn set_stealth(app: AppHandle, state: State<'_, AppState>, enabled: bool) -> CmdResult<()> {
    *state.stealth.lock().unwrap() = enabled;
    for label in STEALTH_WINDOWS {
        if let Some(w) = app.get_webview_window(label) {
            window::set_capture_excluded(&w, enabled).map_err(err)?;
        }
    }
    // Every window (HUD badge, settings switch) follows.
    app.emit("settings:stealth", serde_json::json!({ "enabled": enabled })).map_err(err)
}

#[derive(Serialize)]
pub struct Devices {
    inputs: Vec<String>,
    outputs: Vec<String>,
    /// Chosen devices (Audio-Setup, kept in desktop.json); None = system default.
    input: Option<String>,
    output: Option<String>,
    /// What "Windows-Standardgerät" currently is.
    default_input: Option<String>,
    default_output: Option<String>,
}

#[tauri::command]
pub fn list_audio_devices(state: State<'_, AppState>) -> CmdResult<Devices> {
    let (inputs, outputs) = audio::list_devices().map_err(err)?;
    let input = state.input_device.lock().unwrap().clone();
    let output = state.output_device.lock().unwrap().clone();
    let (default_input, default_output) = audio::default_devices();
    Ok(Devices { inputs, outputs, input, output, default_input, default_output })
}

/// Picks the microphone (`input`) or the loopback source (`output`) for the next recording and
/// keeps the choice in desktop.json. An empty name goes back to the system default.
#[tauri::command]
pub fn select_audio_device(app: AppHandle, state: State<'_, AppState>, kind: String, name: String) -> CmdResult<()> {
    let name = Some(name.trim().to_string()).filter(|n| !n.is_empty());
    match kind.as_str() {
        "input" => *state.input_device.lock().unwrap() = name.clone(),
        "output" => *state.output_device.lock().unwrap() = name.clone(),
        other => return Err(format!("unknown device kind {other}")),
    }
    config::update(&config_dir(&app)?, |c| {
        if kind == "input" {
            c.input_device = name;
        } else {
            c.output_device = name;
        }
    })
    .map_err(err)
}

/// "Mit Windows starten": Run key in HKCU, the app then starts hidden in the tray.
#[tauri::command]
pub fn get_autostart() -> bool {
    autostart::is_enabled()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> CmdResult<bool> {
    autostart::set_enabled(enabled).map_err(err)?;
    Ok(autostart::is_enabled())
}

#[derive(Serialize)]
pub struct TestResult {
    ok: bool,
    mic_db: i32,
    system_db: i32,
    mic_ok: bool,
    system_ok: bool,
}

/// Records `seconds` on both channels (with a quiet test tone on the output so the loopback has
/// something to hear) and reports the peak level per channel. -50 dBFS counts as signal.
#[tauri::command]
pub async fn test_recording(app: AppHandle, state: State<'_, AppState>, seconds: u64) -> CmdResult<TestResult> {
    let opts = audio::StartOptions {
        input: state.input_device.lock().unwrap().clone(),
        output: state.output_device.lock().unwrap().clone(),
        loopback: true,
        ..Default::default()
    };
    let secs = seconds.clamp(1, 10);
    let summary = tauri::async_runtime::spawn_blocking(move || {
        let tone = audio::play_tone(440.0, 0.1).ok();
        let rec = audio::start(opts, level_sink(&app))?;
        std::thread::sleep(std::time::Duration::from_secs(secs));
        let s = rec.stop();
        drop(tone);
        s
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    let (mic_ok, system_ok) = (summary.ch0_peak_db > -50, summary.ch1_peak_db > -50);
    Ok(TestResult { ok: mic_ok && system_ok, mic_db: summary.ch0_peak_db, system_db: summary.ch1_peak_db, mic_ok, system_ok })
}

#[derive(Serialize)]
pub struct CaptureResult {
    id: String,
}

/// Quick capture from the Alt+Space overlay: a note through `/api/ingest` with the connected account.
/// `title` is optional (selection capture: "Markierung aus <Fenster>").
#[tauri::command]
pub async fn quick_capture(app: AppHandle, text: String, target: String, title: Option<String>) -> CmdResult<CaptureResult> {
    let cfg = load_config(&app);
    let web = cfg.web_url().map_err(err)?;
    let token = access_token(&app).await?;
    let mut body = serde_json::json!({ "kind": "note", "content_md": text, "client": { "name": "kortex-desktop", "version": env!("CARGO_PKG_VERSION") } });
    if target == "task" {
        body["content_md"] = serde_json::json!(format!("- [ ] {}", text.trim()));
    }
    if let Some(t) = title.map(|t| t.trim().chars().take(200).collect::<String>()).filter(|t| !t.is_empty()) {
        body["title"] = serde_json::json!(t);
    }
    // Scratchpad: one list entry in the single scratchpad document, not a new item (no title).
    let (path, body) = if target == "scratchpad" {
        ("/api/scratchpad", serde_json::json!({ "text": text.trim() }))
    } else {
        ("/api/ingest", body)
    };
    let res = upload::http_client(upload::API_TIMEOUT)
        .map_err(err)?
        .post(format!("{web}{path}"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(err)?;
    let status = res.status();
    let value: serde_json::Value = res.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tf("Ingest failed ({status}): {message}", &[("status", &status), ("message", &value["error"]["message"].as_str().unwrap_or(""))]));
    }
    Ok(CaptureResult { id: value["item_id"].as_str().unwrap_or_default().to_string() })
}

// --- launcher (Alt+Space prefixes: `>` prompts, `?` search, ask; selection capture) -----------

fn launcher_api(app: &AppHandle) -> CmdResult<live::Api> {
    if !connected(app) {
        return Err(t("No account connected (Settings → Connect account)").into());
    }
    live_api(app)
}

/// Window that was in front before the overlay opened (the paste / selection target).
pub fn remember_foreground(app: &AppHandle) {
    *app.state::<AppState>().launcher_prev.lock().unwrap() = inject::foreign_foreground();
}

fn hide_launcher(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
}

/// Hands the foreground back to `prev` while the overlay still owns it (Windows only lets the
/// foreground process pass it on), then hides the overlay.
fn step_aside(app: &AppHandle, prev: Option<isize>) {
    if let Some(p) = prev {
        inject::focus(p);
    }
    hide_launcher(app);
}

pub fn show_launcher(app: &AppHandle) -> anyhow::Result<()> {
    if let Some(w) = app.get_webview_window("capture") {
        w.center()?;
        w.show()?;
        w.set_focus()?;
    }
    Ok(())
}

/// `GET /api/search` for the overlay: `?` search and the `>` prompt catalog (`kind: "prompt"`,
/// `content: true`). Returns the API's JSON as-is.
#[tauri::command]
pub async fn launcher_search(app: AppHandle, q: String, kind: Option<String>, limit: Option<u32>, content: Option<bool>) -> CmdResult<serde_json::Value> {
    let api = launcher_api(&app)?;
    launcher::search(&api, &q, kind.as_deref(), limit.unwrap_or(8), content.unwrap_or(false)).await.map_err(|e| tf("Search: {error}", &[("error", &format!("{e:#}"))]))
}

/// "Fragen": short copilot answer over the whole vault with its numbered sources.
#[tauri::command]
pub async fn launcher_ask(app: AppHandle, question: String) -> CmdResult<launcher::AskAnswer> {
    if question.trim().is_empty() {
        return Err(t("Please enter a question").into());
    }
    // Works with the sign-in and with a personal token that has the `ask` scope.
    let api = launcher_api(&app)?;
    launcher::ask(&api, &question).await.map_err(|e| {
        launcher::ask_refusal(live::http_status(&e), api.personal_token).map(String::from).unwrap_or_else(|| format!("{e:#}"))
    })
}

/// Hands a text (a filled prompt) to the app the user came from: `paste` focuses that window,
/// pastes with Ctrl+V and restores the clipboard; `copy` only leaves the text on the clipboard.
/// The overlay hides first either way. Returns true when it pasted.
#[tauri::command]
pub async fn paste_text(app: AppHandle, state: State<'_, AppState>, text: String, mode: String) -> CmdResult<bool> {
    if text.is_empty() {
        return Err(t("Nothing to insert").into());
    }
    let prev = *state.launcher_prev.lock().unwrap();
    step_aside(&app, prev);
    if mode == "copy" {
        inject::set_text(&text, false).map_err(err)?;
        return Ok(false);
    }
    if prev.is_none() {
        // Nothing to paste into (the overlay was opened over Kortex itself): keep the text.
        inject::set_text(&text, false).map_err(err)?;
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || inject::paste_into(prev, &text)).await.map_err(err)?.map_err(err)?;
    Ok(true)
}

#[derive(Serialize)]
pub struct Selection {
    /// Selected text of the previous window, None when nothing was selected.
    text: Option<String>,
    /// Title of that window ("Markierung aus …").
    source: Option<String>,
}

/// Copies the selection of the window behind the overlay (Ctrl+C, clipboard restored) and shows
/// the overlay again. Also run by the Alt+Shift+Space hotkey (shortcut.rs).
pub async fn grab_selection_inner(app: &AppHandle, prev: Option<isize>) -> CmdResult<Selection> {
    let Some(target) = prev else {
        return Err(t("Select text in another app first").into());
    };
    step_aside(app, Some(target));
    let text = tauri::async_runtime::spawn_blocking(move || inject::copy_selection(Some(target))).await.map_err(err)?;
    *app.state::<AppState>().launcher_prev.lock().unwrap() = Some(target);
    show_launcher(app).map_err(err)?;
    let text = text.map_err(err)?;
    Ok(Selection { text, source: inject::source_label(&inject::window_title(target)) })
}

#[tauri::command]
pub async fn grab_selection(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Selection> {
    let prev = *state.launcher_prev.lock().unwrap();
    grab_selection_inner(&app, prev).await
}

/// Esc in the overlay: hide it and give the focus back to the previous window (not the HUD).
#[tauri::command]
pub fn close_launcher(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let prev = *state.launcher_prev.lock().unwrap();
    step_aside(&app, prev);
    Ok(())
}

/// Mic-only capture into a temp WAV (voice note).
#[tauri::command]
pub fn start_voice_note(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let mut slot = state.voice.lock().unwrap();
    if slot.is_none() {
        let path = recordings_dir(&app)?.join(format!("voice-{}.wav", stamp()));
        let opts = audio::StartOptions { input: state.input_device.lock().unwrap().clone(), wav_path: Some(path), loopback: false, ..Default::default() };
        *slot = Some(audio::start(opts, level_sink(&app)).map_err(err)?);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct VoiceNote {
    seconds: u64,
    file: String,
    /// true when the upload started (account connected); progress arrives as `voice:upload`.
    uploading: bool,
}

/// Stops the voice note. With a connected account it is transcribed through the user's ADR-06
/// route (`/api/chat/transcribe`) and captured as a note in the inbox, in the background
/// (`voice:upload` events: `{ state: "uploading" | "done" | "error", item_id?, message?, file? }`).
/// The WAV stays in the recordings folder either way.
#[tauri::command]
pub fn stop_voice_note(app: AppHandle, state: State<'_, AppState>) -> CmdResult<VoiceNote> {
    let rec = state.voice.lock().unwrap().take().ok_or(t("No voice note active"))?;
    let s = rec.stop().map_err(err)?;
    let file = s.path.clone().map(|p| p.display().to_string()).unwrap_or_default();
    let uploading = connected(&app) && s.path.is_some();
    if let (true, Some(path)) = (uploading, s.path) {
        spawn_voice_upload(app, path, s.seconds, chrono::Local::now().to_rfc3339());
    }
    Ok(VoiceNote { seconds: s.seconds.round() as u64, file, uploading })
}

fn spawn_voice_upload(app: AppHandle, path: PathBuf, seconds: f64, captured_at: String) {
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("voice:upload", serde_json::json!({ "state": "uploading" }));
        let cfg = load_config(&app);
        let result = match access_token(&app).await {
            Ok(token) => upload::upload_voice_note(&cfg, &token, &path, seconds, &captured_at).await,
            Err(e) => Err(anyhow::anyhow!(e)),
        };
        match result {
            Ok(out) => {
                let _ = app.emit("voice:upload", serde_json::json!({ "state": "done", "item_id": out.item_id, "folder_path": out.folder_path }));
            }
            Err(e) => {
                log::error!("voice note upload failed: {e:#}");
                let _ = app.emit("voice:upload", serde_json::json!({ "state": "error", "message": format!("{e:#}"), "file": path.display().to_string() }));
            }
        }
    });
}


/// Marks a moment of the running meeting (HUD clip field, coaching card); stored in the session.
#[tauri::command]
pub async fn meeting_clip(app: AppHandle, state: State<'_, AppState>, text: String) -> CmdResult<serde_json::Value> {
    let s = current_session(&state)?;
    let api = session_api(&app, &state)?;
    live::clip(&s, &api, &text).await.map_err(err)
}

/// Creates a task from a coaching card ("Task anlegen").
#[tauri::command]
pub async fn meeting_task(app: AppHandle, state: State<'_, AppState>, title: String) -> CmdResult<String> {
    let s = current_session(&state)?;
    let api = session_api(&app, &state)?;
    live::task(&s, &api, &title).await.map_err(err)
}

/// Runs the coaching now (HUD "Aktualisieren"); the answer arrives as `coaching:cards`.
#[tauri::command]
pub fn refresh_coaching(state: State<'_, AppState>) -> CmdResult<()> {
    current_session(&state)?.coach_now()
}

/// Opens an item of the web app in the main window (`/notes/<id>`).
#[tauri::command]
pub fn open_in_main(app: AppHandle, item_id: String) -> CmdResult<()> {
    if !live::is_item_id(&item_id) {
        return Err(t("invalid item ID").into());
    }
    let web = load_config(&app).web_url().map_err(err)?;
    let w = app.get_webview_window("main").ok_or("main window missing")?;
    w.navigate(format!("{web}/notes/{item_id}").parse().map_err(err)?).map_err(err)?;
    // Opened from the launcher (search hit, answer source): the always-on-top overlay steps aside.
    hide_launcher(&app);
    w.unminimize().map_err(err)?;
    w.show().map_err(err)?;
    w.set_focus().map_err(err)?;
    window::sync_main(&app);
    Ok(())
}

/// Opens (or focuses) one of the small native windows: meetings, audio, settings.
/// async on purpose: a sync command runs on the main thread, and building a webview window there
/// can deadlock on Windows (audit D-07).
#[tauri::command]
pub async fn open_window(app: AppHandle, label: String) -> CmdResult<()> {
    open_window_inner(&app, &label)
}

/// Title of a small native window in the current language (None = not one of them).
fn window_title(label: &str) -> Option<&'static str> {
    match label {
        "meetings" => Some(t("Meeting center")),
        "audio" => Some(t("Audio setup")),
        "settings" => Some(t("Settings")),
        _ => None,
    }
}

pub fn open_window_inner(app: &AppHandle, label: &str) -> CmdResult<()> {
    let label = label.to_string();
    if let Some(w) = app.get_webview_window(&label) {
        w.unminimize().map_err(err)?;
        w.show().map_err(err)?;
        return w.set_focus().map_err(err);
    }
    let title = match window_title(&label) {
        Some(title) => title,
        None if matches!(label.as_str(), "main" | "hud" | "capture" | "tray") => return Err(format!("{label} is created at startup")),
        None => return Err(format!("unknown window {label}")),
    };
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(620.0, 660.0)
        // fx3: below this the rows wrap instead of running out on the right (checked down to 440 px).
        .min_inner_size(440.0, 420.0)
        .decorations(false)
        .transparent(true)
        .center()
        .build()
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn show_main(app: AppHandle) -> CmdResult<()> {
    let w = app.get_webview_window("main").ok_or("main window missing")?;
    w.unminimize().map_err(err)?;
    w.show().map_err(err)?;
    w.set_focus().map_err(err)?;
    window::sync_main(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_to_tray(app: AppHandle) -> CmdResult<()> {
    app.get_webview_window("main").ok_or("main window missing")?.hide().map_err(err)?;
    window::sync_main(&app);
    Ok(())
}

// --- connect by deep link (kortex://connect, see connect.rs) -----------------------------------

/// A `kortex://` link arrived (cold start, second start or the running app): park it and ask in
/// the settings window. A bad link opens the settings window with the reason.
pub fn handle_link(app: &AppHandle, raw: &str) {
    let payload = match connect::parse(raw) {
        Ok(link) => {
            let web = link.web.clone();
            *app.state::<AppState>().pending_connect.lock().unwrap() = Some(link);
            serde_json::json!({ "web": web, "error": null })
        }
        Err(e) => {
            log::warn!("deep link refused: {e:#}");
            serde_json::json!({ "web": null, "error": format!("{e:#}") })
        }
    };
    // Not on the event-loop thread of the link handler (window creation could deadlock, D-07).
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = open_window_inner(&app, "settings") {
            log::warn!("open settings for the deep link: {e}");
        }
        let _ = app.emit("connect:pending", payload);
    });
}

#[derive(Serialize)]
pub struct PendingConnect {
    /// Web app that sent the token (None = the configured one).
    web: Option<String>,
    /// The web URL the app uses now, to show "Verbinden mit …".
    current_web: String,
}

/// The parked connect link, if any (the settings window asks on mount).
#[tauri::command]
pub fn pending_connect(app: AppHandle, state: State<'_, AppState>) -> Option<PendingConnect> {
    let link = state.pending_connect.lock().unwrap().clone()?;
    Some(PendingConnect { web: link.web, current_web: load_config(&app).web_url().unwrap_or_default() })
}

#[tauri::command]
pub fn dismiss_connect(state: State<'_, AppState>) {
    state.pending_connect.lock().unwrap().take();
}

/// "Verbinden" on the parked link: switches the web URL when the link names another one, checks
/// the token against that web app and stores it in the Credential Manager. On failure the old web
/// URL comes back.
#[tauri::command]
pub async fn confirm_connect(app: AppHandle, state: State<'_, AppState>) -> CmdResult<AccountStatus> {
    let link = state.pending_connect.lock().unwrap().take().ok_or(t("No connection link pending"))?;
    let dir = config_dir(&app)?;
    let before = load_config(&app).web_url;
    let switch = link.web.as_ref().is_some_and(|w| load_config(&app).web_url().ok().as_deref() != Some(w.as_str()));
    if switch {
        config::update(&dir, |c| c.web_url = link.web.clone()).map_err(err)?;
    }
    if let Err(e) = secrets::connect_token(&dir, &secrets::default_store(), &link.token).await {
        if switch {
            let _ = config::update(&dir, |c| c.web_url = before);
        }
        return Err(format!("{e:#}"));
    }
    if switch {
        // The main window follows the new web app.
        navigate_main(&app, "/home");
    }
    let _ = app.emit("account:changed", serde_json::json!({ "connected": true }));
    // The new token may sync the vault (scope sync): restart the sidecar with it.
    vault::restart(&app);
    // Due reminders right away instead of in 15 minutes.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = reminders::check_now(&app2).await;
    });
    Ok(account_status(app))
}

fn navigate_main(app: &AppHandle, path: &str) {
    let Ok(web) = load_config(app).web_url() else { return };
    if let (Some(w), Ok(url)) = (app.get_webview_window("main"), format!("{web}{path}").parse()) {
        if let Err(e) = w.navigate(url) {
            log::warn!("main navigate: {e}");
        }
    }
}

/// "Konto verbinden" in the HUD, launcher, tray or settings: opens Einstellungen → Connectors of
/// the web app in the main window, where "Mit Windows-App verbinden" sends the token back.
#[tauri::command]
pub fn open_connect(app: AppHandle) -> CmdResult<()> {
    navigate_main(&app, "/settings?section=connectors");
    hide_launcher(&app);
    if let Some(t) = app.get_webview_window("tray") {
        let _ = t.hide();
    }
    show_main(app)
}

// --- self-test ---------------------------------------------------------------------------------

/// Self-test of the meeting chain (selftest.rs): `wav` = a WAV file instead of the test signal,
/// `online` = the real web app with the connected account instead of the local stub.
#[tauri::command]
pub async fn run_selftest(app: AppHandle, wav: Option<String>, online: Option<bool>) -> CmdResult<selftest::Report> {
    let opts = selftest::Options { wav: wav.filter(|w| !w.trim().is_empty()).map(PathBuf::from), online: online.unwrap_or(false) };
    selftest::run(app, opts).await.map_err(|e| format!("{e:#}"))
}

// --- language (i18n.rs) -------------------------------------------------------------------------

/// Language of the core's texts and of the local windows ("en" | "de").
#[tauri::command]
pub fn get_locale() -> &'static str {
    i18n::locale().code()
}

/// Settings → Language: stores the choice in desktop.json, switches the core's texts (tray tooltip,
/// titles of the open small windows) and tells every window (`settings:locale`), which reloads.
#[tauri::command]
pub fn set_locale(app: AppHandle, state: State<'_, AppState>, locale: String) -> CmdResult<&'static str> {
    let next = i18n::Locale::parse(&locale).ok_or_else(|| format!("unknown locale {locale}"))?;
    config::update(&config_dir(&app)?, |c| c.locale = Some(next.code().to_string())).map_err(err)?;
    i18n::set_locale(next);
    tray::set_recording(&app, state.recorder.lock().unwrap().is_some());
    for label in ["meetings", "audio", "settings"] {
        if let (Some(w), Some(title)) = (app.get_webview_window(label), window_title(label)) {
            let _ = w.set_title(title);
        }
    }
    let _ = app.emit("settings:locale", serde_json::json!({ "locale": next.code() }));
    // Status texts of the vault sync are built in the core: send them again in the new language.
    let _ = app.emit("vault:status", vault::status(&app));
    Ok(next.code())
}

// --- reminders --------------------------------------------------------------------------------

#[tauri::command]
pub fn get_reminders(app: AppHandle) -> bool {
    load_config(&app).reminders_enabled()
}

#[tauri::command]
pub fn set_reminders(app: AppHandle, enabled: bool) -> CmdResult<bool> {
    config::update(&config_dir(&app)?, |c| c.reminders = Some(enabled)).map_err(err)?;
    if enabled {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = reminders::check_now(&app2).await;
        });
    }
    Ok(load_config(&app).reminders_enabled())
}

#[tauri::command]
pub async fn quit_app(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    // A running meeting is not thrown away (audit D-08): stop it like "Aufnahme beenden" and wait
    // for the end of the session / upload (at most QUIT_WAIT) before the app goes.
    let recording = state.recorder.lock().unwrap().is_some();
    if recording {
        use tauri::Listener;
        use tauri_plugin_notification::NotificationExt;
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let tx = std::sync::Mutex::new(Some(tx));
        let id = app.listen_any("meeting:upload", move |e| {
            if !e.payload().contains("\"uploading\"") {
                if let Some(t) = tx.lock().unwrap().take() {
                    let _ = t.send(());
                }
            }
        });
        match stop_recording_inner(&app, &state) {
            Ok(r) if r.uploading => {
                let _ = app.notification().builder().title(t("Kortex is about to quit")).body(t("The running recording is being finished and uploaded first.")).show();
                if tokio::time::timeout(QUIT_WAIT, rx).await.is_err() {
                    log::warn!("quit: upload not finished after {QUIT_WAIT:?}, the WAV stays in the recordings folder");
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("quit: stopping the recording failed: {e}"),
        }
        app.unlisten(id);
    }
    if let Some(rec) = state.voice.lock().unwrap().take() {
        let _ = rec.stop();
    }
    vault::stop(&app, true);
    app.exit(0);
    Ok(())
}

/// How long "Beenden" waits for a stopped meeting to be uploaded.
const QUIT_WAIT: std::time::Duration = std::time::Duration::from_secs(120);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_paths_must_stay_in_the_recordings_folder() {
        let root = std::env::temp_dir().join(format!("kortex-paths-{}", std::process::id()));
        let rec = root.join("recordings");
        std::fs::create_dir_all(&rec).unwrap();
        let ok = rec.join("2026-10-25_10-00-00.wav");
        std::fs::write(&ok, b"RIFF").unwrap();
        let outside = root.join("secret.wav");
        std::fs::write(&outside, b"RIFF").unwrap();
        let txt = rec.join("notes.txt");
        std::fs::write(&txt, b"x").unwrap();

        assert!(ensure_recording_path(&rec, &ok).is_ok());
        assert!(ensure_recording_path(&rec, &outside).is_err());
        assert!(ensure_recording_path(&rec, &rec.join("..").join("secret.wav")).is_err());
        assert!(ensure_recording_path(&rec, &txt).is_err());
        assert!(ensure_recording_path(&rec, &rec.join("missing.wav")).is_err());
        assert!(ensure_recording_path(&rec, &rec).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}

// --- Vault sync (vault.rs) ------------------------------------------------------------------

#[tauri::command]
pub fn vault_status(app: AppHandle) -> vault::VaultStatus {
    vault::status(&app)
}

/// Folder picker (Windows dialog), started in the current vault or the user folder. Returns the
/// checked folder; nothing is applied until `vault_set_folder`.
#[tauri::command]
pub async fn vault_pick_folder(app: AppHandle) -> CmdResult<Option<vault::FolderCheck>> {
    use tauri_plugin_dialog::DialogExt as _;
    let current = load_config(&app).vault_path.map(PathBuf::from);
    let start = current.filter(|p| p.is_dir()).or_else(vault::home_dir);
    let mut dialog = app.dialog().file().set_title(t("Choose vault folder"));
    if let Some(dir) = start {
        dialog = dialog.set_directory(dir);
    }
    if let Some(w) = app.get_webview_window("settings") {
        dialog = dialog.set_parent(&w);
    }
    let Some(picked) = dialog.blocking_pick_folder() else { return Ok(None) };
    let path = picked.into_path().map_err(err)?;
    Ok(Some(vault::check_folder(&path, vault::home_dir().as_deref())))
}

#[tauri::command]
pub fn vault_check_folder(path: String) -> vault::FolderCheck {
    vault::check_folder(Path::new(path.trim()), vault::home_dir().as_deref())
}

/// Makes `path` the vault and (re)starts the sync. A non-empty folder that is no Kortex vault needs
/// `confirm: true` ("Trotzdem verwenden"). The old folder stays as it is.
#[tauri::command]
pub fn vault_set_folder(app: AppHandle, path: String, confirm: bool) -> CmdResult<vault::VaultStatus> {
    let check = vault::check_folder(Path::new(path.trim()), vault::home_dir().as_deref());
    if let Some(why) = check.refused {
        return Err(why);
    }
    if check.needs_confirm && !confirm {
        return Err(tf("The folder is not empty ({n} entries) and not a Kortex vault yet.", &[("n", &check.entries)]));
    }
    config::update(&config_dir(&app)?, |c| {
        c.vault_path = Some(check.path.clone());
        c.vault_setup_done = Some(true);
    })
    .map_err(err)?;
    vault::restart(&app);
    Ok(vault::status(&app))
}

#[tauri::command]
pub fn vault_set_enabled(app: AppHandle, enabled: bool) -> CmdResult<vault::VaultStatus> {
    config::update(&config_dir(&app)?, |c| c.vault_sync = Some(enabled)).map_err(err)?;
    vault::restart(&app); // with the switch off it only stops
    Ok(vault::status(&app))
}

/// First-run "Später": no automatic prompt again (Einstellungen keep the setup card).
#[tauri::command]
pub fn vault_skip_setup(app: AppHandle) -> CmdResult<vault::VaultStatus> {
    config::update(&config_dir(&app)?, |c| c.vault_setup_done = Some(true)).map_err(err)?;
    Ok(vault::status(&app))
}

#[tauri::command]
pub fn vault_sync_now(app: AppHandle) -> CmdResult<()> {
    vault::sync_now(&app)
}

/// Opens the vault or its Dropzone (created if missing) in the Explorer, or md-sync.log in the editor.
#[tauri::command]
pub fn vault_open(app: AppHandle, target: String) -> CmdResult<()> {
    if target == "log" {
        return vault::open_log(&vault::log_path(&app).ok_or(t("Log folder not found"))?);
    }
    let vault_path = load_config(&app).vault_path.map(PathBuf::from).ok_or(t("No vault folder chosen yet"))?;
    match target.as_str() {
        "vault" => vault::open_folder(&vault_path, false),
        "dropzone" => vault::open_folder(&vault::dropzone_of(&vault_path), true),
        other => Err(tf("unknown target {target}", &[("target", &other)])),
    }
}
