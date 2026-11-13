//! Kortex desktop core (Tauri v2, Windows first).
//!
//! Windows (see tauri.conf.json; the React bundle picks its view from the window label):
//! - `main`     the Kortex web app, loaded top-level from `webUrl` (the server entered on first start, or the build's own)
//!              so its Supabase session cookies are first-party
//! - `hud`      frameless, transparent, always-on-top meeting HUD (pill 440x56 / hud 400x684)
//! - `capture`  Alt+Space launcher: quick capture, ask, `?` search, `>` prompts (launcher.rs, inject.rs)
//! - `tray`     styled tray menu, anchored to the tray icon
//! - `meetings` / `audio` / `settings`  small native windows, created on demand
//!
//! The command / event contract lives in `apps/desktop/src/bridge/contract.ts`.
//!
//! Security (review N5 #8): every app command has a generated permission (build.rs) and only the
//! local windows get them (capabilities/local.json). `main` shows the remote web app and gets only
//! the four Orbit-Bar recording commands of main_bridge.rs, for the configured web origin (runtime
//! capability `main-web`); every other command stays out of its reach.

pub mod audio;
pub mod autostart;
pub mod autostop;
mod commands;
pub mod config;
pub mod connect;
mod deepgram;
pub mod i18n;
pub mod inject;
pub mod launcher;
pub mod live;
pub mod meeting_pass;
pub mod logfile;
mod main_bridge;
pub mod reminders;
pub mod selftest;
pub mod dsp;
mod shortcut;
mod tray;
pub mod upload;
pub mod wav;
pub mod secrets;
pub mod vault;
mod window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::webview::PageLoadEvent;
use tauri::Manager as _;
use tauri_plugin_deep_link::DeepLinkExt as _;

/// Self-test substitutions for the next `start_recording_inner` (selftest.rs).
pub struct SelfTestStart {
    pub audio: audio::Synthetic,
    pub api: live::Api,
}

/// A meeting being recorded.
pub struct Recording {
    pub recorder: audio::Recorder,
    /// RFC 3339 start time (sent as `captured_at`).
    pub started_at: String,
}

/// Shared state behind every command.
#[derive(Default)]
pub struct AppState {
    pub recorder: Mutex<Option<Recording>>,
    /// Mic-only voice note capture.
    pub voice: Mutex<Option<audio::Recorder>>,
    /// The web app in `main` records with its own microphone (Orbit-Bar dictation; main_bridge.rs).
    pub web_rec: Mutex<Option<std::time::Instant>>,
    /// Selected devices (names as reported by cpal); `None` = system default.
    pub input_device: Mutex<Option<String>>,
    pub output_device: Mutex<Option<String>>,
    /// Stealth mode (SetWindowDisplayAffinity) for HUD + overlays; on by default.
    pub stealth: Mutex<bool>,
    /// Live session of the running meeting (connected account), see live.rs.
    pub live: Mutex<Option<std::sync::Arc<live::Session>>>,
    /// API the live session was opened with (the self-test stub or the connected account).
    pub live_api: Mutex<Option<live::Api>>,
    /// Window in front before the Alt+Space overlay opened (HWND as isize): paste and selection target.
    pub launcher_prev: Mutex<Option<isize>>,
    /// Last level above the silence threshold during a meeting (auto-stop, autostop.rs).
    pub last_sound: Mutex<Option<std::time::Instant>>,
    /// Current mode of the HUD window: "off" | "pill" | "hud" (window.rs).
    pub hud_mode: Mutex<String>,
    /// The HUD mode was switched automatically when the main window went away; this mode comes
    /// back with the main window (window.rs `on_main_change`).
    pub hud_restore: Mutex<Option<String>>,
    /// Last seen state of the main window (shown, minimized, hidden).
    pub main_state: Mutex<window::MainState>,
    /// Top-right corner (physical px) where the user dragged the HUD; None = default place.
    pub hud_anchor: Mutex<Option<(i32, i32)>>,
    /// Pending self-test substitutions (selftest.rs).
    pub selftest: Mutex<Option<SelfTestStart>>,
    /// A `kortex://connect` link waiting for the user's "Verbinden" (connect.rs).
    pub pending_connect: Mutex<Option<connect::ConnectLink>>,
    /// `main` was shown once its web app loaded (no flash of the bundled page, no blocked iframe).
    pub main_shown: AtomicBool,
    /// Started by "Mit Windows starten" (--tray): stay in the tray.
    pub tray_start: AtomicBool,
    /// md-sync sidecar (vault.rs): vault folder ⇄ Kortex.
    pub vault: vault::VaultSync,
}

/// `--selftest`: bundled UI in `main` (no web app), HUD and stealth as usual, then the run; writes
/// the report (also to `report`) and exits with 0 = passed, 1 = failed.
fn setup_selftest(app: &mut tauri::App, opts: selftest::Options, report: Option<std::path::PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    for label in STEALTH_WINDOWS {
        if let Some(w) = app.get_webview_window(label) {
            let _ = window::set_capture_excluded(&w, true);
        }
    }
    window::spawn_watch(handle.clone());
    tauri::async_runtime::spawn(async move {
        if let Some(main) = handle.get_webview_window("main") {
            let _ = main.show();
        }
        // Let the windows load their React bundle.
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        let code = match selftest::run(handle.clone(), opts).await {
            Ok(r) => {
                let json = serde_json::to_string_pretty(&r).unwrap_or_default();
                if let Some(p) = &report {
                    let _ = std::fs::write(p, &json);
                }
                println!("{json}");
                if r.ok { 0 } else { 1 }
            }
            Err(e) => {
                log::error!("selftest: {e:#}");
                if let Some(p) = &report {
                    let _ = std::fs::write(p, serde_json::json!({ "ok": false, "error": format!("{e:#}") }).to_string());
                }
                eprintln!("selftest: {e:#}");
                2
            }
        };
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        handle.exit(code);
    });
    Ok(())
}

/// Shows `main` the first time (web app loaded, or the fallback timer), unless started in the tray.
fn reveal_main(app: &tauri::AppHandle) {
    let st = app.state::<AppState>();
    if st.tray_start.load(Ordering::SeqCst) || st.main_shown.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// How long `main` may stay hidden while the web app loads (offline: then the WebView's own error page shows).
const MAIN_REVEAL_FALLBACK: std::time::Duration = std::time::Duration::from_secs(12);

/// Delay of the vault sync start after launch.
const VAULT_START_DELAY: std::time::Duration = std::time::Duration::from_secs(3);

/// Window labels that get WDA_EXCLUDEFROMCAPTURE while stealth mode is on.
pub const STEALTH_WINDOWS: [&str; 3] = ["hud", "capture", "tray"];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `--selftest`: runs the meeting self-test and exits (selftest.rs). It must not touch the
    // installed app's registrations (single instance, kortex:// link, hotkeys, vault sync).
    let args: Vec<String> = std::env::args().collect();
    let selftest_cli = selftest::cli(&args);
    let cli = selftest_cli.is_some();
    let mut builder = tauri::Builder::default();
    if !cli {
        // First: a second start (e.g. by a kortex:// link) hands over to this one and exits.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // With the deep-link feature the link itself arrives through on_open_url below.
            if connect::from_args(argv).is_none() {
                let _ = commands::show_main(app.clone());
            }
        }));
    }
    let selftest_cli = std::sync::Mutex::new(selftest_cli);
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState { stealth: Mutex::new(true), hud_mode: Mutex::new("off".into()), ..Default::default() })
        .on_page_load(|webview, payload| {
            // `main` starts hidden (tauri.conf.json) and appears once the web app has loaded.
            if webview.label() == "main" && payload.event() == PageLoadEvent::Finished {
                let host = payload.url().host_str().unwrap_or_default();
                if matches!(payload.url().scheme(), "http" | "https") && host != "tauri.localhost" && !payload.url().as_str().starts_with("http://localhost:3400") {
                    reveal_main(webview.app_handle());
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Ok(dir) = app.path().app_local_data_dir() {
                let file = logfile::init(&dir.join("logs"));
                log::info!("Kortex {} started{}, log {}", env!("CARGO_PKG_VERSION"), if cli { " (self-test)" } else { "" }, file.display());
            }
            if let Some((opts, report)) = selftest_cli.lock().unwrap().take() {
                return setup_selftest(app, opts, report);
            }
            // kortex://connect from the web app (Einstellungen → "Mit Windows-App verbinden").
            #[cfg(any(windows, target_os = "linux"))]
            if let Err(e) = app.deep_link().register_all() {
                log::warn!("kortex:// scheme not registered: {e}");
            }
            {
                let h = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        commands::handle_link(&h, url.as_str());
                    }
                });
            }
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    commands::handle_link(&handle, url.as_str());
                }
            }
            let cfg = commands::load_config(&handle);
            // Language of the core's texts: the stored choice, else the Windows display language.
            log::info!("language: {}", i18n::init(cfg.locale.as_deref()).code());
            // Audio-Setup choice from the last run.
            {
                let st = handle.state::<AppState>();
                *st.input_device.lock().unwrap() = cfg.input_device.clone();
                *st.output_device.lock().unwrap() = cfg.output_device.clone();
            }
            // Main window: the web app (KORTEX_WEB_URL env, webUrl in desktop.json, or the build's own).
            // Without a usable server the bundled page stays and the settings window asks for one.
            let web = match cfg.web_url() {
                Ok(web) => Some(web),
                Err(e) => {
                    log::warn!("{e:#}; opening the settings for the server");
                    // After the first windows are up, like the vault setup below.
                    let h = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(VAULT_START_DELAY).await;
                        if let Err(e) = commands::open_window_inner(&h, "settings") {
                            log::warn!("open settings for the server setup: {e}");
                        }
                    });
                    None
                }
            };
            if let Some(web) = &web {
                // The web app's Orbit-Bar may start the native meeting recording (main_bridge.rs).
                main_bridge::register(&handle, web);
            }
            if let Some(main) = app.get_webview_window("main") {
                if let Some(web) = &web {
                    match format!("{web}/home").parse() {
                        Ok(url) => {
                            if let Err(e) = main.navigate(url) {
                                log::warn!("main window navigate failed: {e}");
                            }
                        }
                        Err(e) => log::warn!("invalid webUrl {web}: {e}"),
                    }
                }
                // "Mit Windows starten" passes --tray: come up quietly in the tray.
                if autostart::starts_in_tray(std::env::args()) {
                    handle.state::<AppState>().tray_start.store(true, Ordering::SeqCst);
                    let _ = main.hide();
                }
            }
            {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(MAIN_REVEAL_FALLBACK).await;
                    reveal_main(&h);
                });
            }
            reminders::spawn(handle.clone());
            // Vault sync starts a moment after the app (no extra work before the first window).
            {
                let h = handle.clone();
                let first_run = cfg.vault_path.is_none() && !cfg.vault_setup_done.unwrap_or(false);
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(VAULT_START_DELAY).await;
                    vault::start(&h);
                    // First start: open Einstellungen with the vault setup (not when started in the tray).
                    if first_run && !h.state::<AppState>().tray_start.load(Ordering::SeqCst) {
                        tokio::time::sleep(MAIN_REVEAL_FALLBACK.saturating_sub(VAULT_START_DELAY)).await;
                        let _ = commands::open_window_inner(&h, "settings");
                    }
                });
            }
            tray::create(&handle)?;
            // Minimize → pill / HUD, also when a window event is missed.
            window::spawn_watch(handle.clone());
            // A finished meeting (protocol done or failed) takes the automatic pill away again.
            {
                use tauri::Listener as _;
                let h = handle.clone();
                handle.listen_any("meeting:upload", move |e| {
                    if !e.payload().contains("\"uploading\"") {
                        window::after_recording(&h);
                    }
                });
                // The web app in `main` follows the native recording (Orbit-Bar chip, stop button),
                // whoever started it (tray, hotkey, HUD, auto-stop, the Orbit-Bar itself).
                let h = handle.clone();
                handle.listen_any("meeting:state", move |e| {
                    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                        v["type"] = "meeting".into();
                        main_bridge::notify_main(&h, v);
                    }
                });
            }
            // Each hotkey on its own; taken ones fall back or are reported (shortcut.rs).
            let _ = shortcut::register(&handle);
            // Stealth on by default: hide HUD + overlays from screen capture / screen share.
            for label in STEALTH_WINDOWS {
                if let Some(w) = app.get_webview_window(label) {
                    if let Err(e) = window::set_capture_excluded(&w, true) {
                        log::warn!("stealth for {label} failed: {e}");
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|w, event| {
            if w.label() == "hud" {
                // Dragged by the user: show it there again next time (window.rs).
                if let tauri::WindowEvent::Moved(pos) = event {
                    window::remember_hud_place(w.app_handle(), *pos);
                }
                return;
            }
            if w.label() != "main" {
                return;
            }
            match event {
                // Closing the main window keeps Kortex alive in the tray (prototype: "In den Tray minimieren").
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = w.hide();
                    window::sync_main(w.app_handle());
                }
                // Minimize and restore arrive as resizes: pill / HUD follow (window.rs; also polled).
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_) => window::sync_main(w.app_handle()),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_meeting_state,
            main_bridge::main_meeting_state,
            main_bridge::main_start_meeting,
            main_bridge::main_stop_meeting,
            main_bridge::main_web_recording,
            main_bridge::stop_web_recording,
            commands::start_recording,
            commands::stop_recording,
            commands::upload_recording,
            commands::account_status,
            commands::connect_account,
            commands::disconnect_account,
            commands::set_hud_mode,
            commands::set_stealth,
            commands::list_audio_devices,
            commands::select_audio_device,
            commands::get_autostart,
            commands::set_autostart,
            commands::test_recording,
            commands::quick_capture,
            commands::start_voice_note,
            commands::stop_voice_note,
            commands::connect_token,
            commands::meeting_clip,
            commands::meeting_task,
            commands::refresh_coaching,
            commands::open_in_main,
            commands::open_window,
            commands::show_main,
            commands::hide_to_tray,
            commands::quit_app,
            commands::launcher_search,
            commands::launcher_ask,
            commands::paste_text,
            commands::grab_selection,
            commands::close_launcher,
            commands::pending_connect,
            commands::confirm_connect,
            commands::dismiss_connect,
            commands::open_connect,
            commands::get_reminders,
            commands::set_reminders,
            commands::set_server,
            commands::get_locale,
            commands::set_locale,
            commands::vault_status,
            commands::vault_pick_folder,
            commands::vault_check_folder,
            commands::vault_set_folder,
            commands::vault_set_enabled,
            commands::vault_skip_setup,
            commands::vault_sync_now,
            commands::vault_open,
            commands::run_selftest,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kortex")
        .run(|app, event| {
            // Every way out (tray "Beenden", quit_app, OS shutdown): stop md-sync cleanly.
            if let tauri::RunEvent::Exit = event {
                vault::stop(app, true);
            }
        });
}
