//! Narrow bridge between the web app in `main` and the core (0.6.4, device test 0.6.3: "a meeting
//! recorded through the main app and its Orbit-Bar: minimizing the main window must bring up the
//! live HUD as the pill").
//!
//! `main` shows the remote web app and gets no general capability (review N5 #8). It gets exactly
//! the commands in [`MAIN_COMMANDS`], and only for the configured web origin (runtime capability
//! `main-web`, [`register`]):
//! - `main_meeting_state` / `main_start_meeting` / `main_stop_meeting`: in the desktop app the
//!   Orbit-Bar's "Meeting aufnehmen" runs the native dual-channel recording (microphone and system
//!   sound, live transcript, coaching) instead of a browser microphone recording. Minimize and
//!   restore then switch the pill like for any native recording (window.rs);
//! - `main_web_recording`: the web app's own microphone recording (dictation in the Orbit-Bar)
//!   is reported, so a minimize shows the pill for it too; its stop button comes back here as
//!   `stop_web_recording`;
//! - `main_window` (0.6.8, Ruhe D1): `main` has no native frame (`decorations: false`), the web
//!   titlebar is the only head and draws minimise / maximise / close. "frame" announces that, the
//!   other actions are the buttons ("close" hides to the tray), "drag" moves the window. The web
//!   titlebar starts a move itself on a press on any free surface (apps/web window-drag.ts) through
//!   Tauri's own `start_dragging` ("drag" is its fallback); the double click maximises.
//!   `internal_toggle_maximize` stays granted for `data-tauri-drag-region`; nothing else of the
//!   window API is. A page that does not
//!   announce its frame within [`FRAME_FALLBACK`] (an older web app) gets the native frame back.
//!
//! Core → web app: [`notify_main`] dispatches a `kortex:desktop` DOM event in `main` (script eval,
//! no event permission for the remote page).

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::{self, MeetingState, StopResult};
use crate::{window, AppState};

type CmdResult<T> = Result<T, String>;

/// The only commands the remote web app in `main` may call.
pub const MAIN_COMMANDS: [&str; 5] = ["main_meeting_state", "main_start_meeting", "main_stop_meeting", "main_web_recording", "main_window"];

/// Tauri's own window commands behind `data-tauri-drag-region` (drag, double click maximises).
pub const MAIN_CORE_PERMISSIONS: [&str; 2] = ["core:window:allow-start-dragging", "core:window:allow-internal-toggle-maximize"];

/// How long a page in `main` may take to announce its own window buttons before the native frame
/// comes back (an older web app without them, or a page that failed to load).
pub const FRAME_FALLBACK: Duration = Duration::from_secs(10);

/// URL pattern of the web app's origin (`https://host[:port]/*`); None for anything that is not http(s).
pub fn remote_pattern(web: &str) -> Option<String> {
    let url = tauri::Url::parse(web).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Some(format!("{}://{host}{port}/*", url.scheme()))
}

/// Permission ids of [`MAIN_COMMANDS`] (tauri-build: `allow-<command in kebab case>`) plus the
/// two core window permissions of the drag region.
pub fn permissions() -> Vec<String> {
    MAIN_COMMANDS
        .iter()
        .map(|c| format!("allow-{}", c.replace('_', "-")))
        .chain(MAIN_CORE_PERMISSIONS.iter().map(|p| p.to_string()))
        .collect()
}

/// Grants the [`MAIN_COMMANDS`] to the `main` window while it shows the web app at `web`.
pub fn register(app: &AppHandle, web: &str) {
    let Some(pattern) = remote_pattern(web) else {
        log::warn!("main bridge: no http(s) web url ({web}), Orbit-Bar stays without desktop recording");
        return;
    };
    let mut cap = tauri::ipc::CapabilityBuilder::new("main-web").remote(pattern.clone()).window("main");
    for p in permissions() {
        cap = cap.permission(p);
    }
    match app.add_capability(cap) {
        Ok(()) => log::info!("main bridge for {pattern}"),
        Err(e) => log::warn!("main bridge not registered: {e}"),
    }
}

/// Script that hands `payload` to the web app as `window` event `kortex:desktop`.
pub fn event_script(payload: &serde_json::Value) -> String {
    format!("window.dispatchEvent(new CustomEvent(\"kortex:desktop\",{{detail:{payload}}}));")
}

/// Tells the web app in `main` something (fire and forget; a page without listener ignores it).
pub fn notify_main(app: &AppHandle, payload: serde_json::Value) {
    if let Some(main) = app.get_webview_window("main") {
        if let Err(e) = main.eval(event_script(&payload)) {
            log::warn!("main bridge notify: {e}");
        }
    }
}

#[tauri::command]
pub fn main_meeting_state(app: AppHandle, state: State<'_, AppState>) -> MeetingState {
    commands::get_meeting_state(app, state)
}

/// Orbit-Bar "Meeting aufnehmen" in the desktop app: the native meeting recording.
#[tauri::command]
pub fn main_start_meeting(app: AppHandle, state: State<'_, AppState>) -> CmdResult<MeetingState> {
    log::info!("meeting started from the web app");
    commands::start_recording_from(&app, &state, true)
}

#[tauri::command]
pub fn main_stop_meeting(app: AppHandle, state: State<'_, AppState>) -> CmdResult<StopResult> {
    commands::stop_recording_inner(&app, &state)
}

/// The web app started (`active`) or ended its own microphone recording.
#[tauri::command]
pub fn main_web_recording(app: AppHandle, state: State<'_, AppState>, active: bool) -> CmdResult<()> {
    let changed = {
        let mut slot = state.web_rec.lock().unwrap();
        match (active, slot.is_some()) {
            (true, false) => {
                *slot = Some(std::time::Instant::now());
                true
            }
            (false, true) => {
                *slot = None;
                true
            }
            _ => false,
        }
    };
    if !changed {
        return Ok(());
    }
    log::info!("web recording {}", if active { "started" } else { "ended" });
    let _ = app.emit("webrec:state", serde_json::json!({ "recording": active }));
    if active {
        // Already minimized (hotkey in the web app): the pill right away.
        window::apply_main(&app, true);
    } else if state.recorder.lock().unwrap().is_none() {
        // The pill shows "Gespeichert" for a moment and goes while the main window is still away.
        window::after_recording(&app);
    }
    Ok(())
}

/// The pill's stop button during a web recording: the web app stops and saves it.
#[tauri::command]
pub fn stop_web_recording(app: AppHandle) -> CmdResult<()> {
    notify_main(&app, serde_json::json!({ "type": "stop-web-recording" }));
    Ok(())
}

/// What a click on the web titlebar asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowAction {
    /// The page draws its own window buttons: the native frame goes.
    Frame,
    Minimize,
    ToggleMaximize,
    /// Like the native close button: Kortex keeps running in the tray.
    Close,
    /// Move the window with the mouse (the native move loop, Aero Snap): the web titlebar's fallback when
    /// Tauri's own `start_dragging` is not reachable (Ruhe round 2).
    Drag,
}

impl WindowAction {
    pub fn parse(action: &str) -> Option<Self> {
        match action {
            "frame" => Some(Self::Frame),
            "minimize" => Some(Self::Minimize),
            "toggle_maximize" => Some(Self::ToggleMaximize),
            "close" => Some(Self::Close),
            "drag" => Some(Self::Drag),
            _ => None,
        }
    }
}

/// Window buttons of the web titlebar (and of the bundled page `main` shows while it loads).
#[tauri::command]
pub fn main_window(app: AppHandle, state: State<'_, AppState>, action: String) -> CmdResult<()> {
    let act = WindowAction::parse(&action).ok_or_else(|| format!("unknown window action {action}"))?;
    let main = app.get_webview_window("main").ok_or("main window missing")?;
    let err = |e: tauri::Error| e.to_string();
    match act {
        WindowAction::Frame => {
            state.custom_frame.store(true, Ordering::SeqCst);
            main.set_decorations(false).map_err(err)?;
        }
        WindowAction::Minimize => main.minimize().map_err(err)?,
        WindowAction::ToggleMaximize => {
            if main.is_maximized().map_err(err)? {
                main.unmaximize().map_err(err)?;
            } else {
                main.maximize().map_err(err)?;
            }
        }
        WindowAction::Close => {
            main.hide().map_err(err)?;
            window::sync_main(&app);
        }
        WindowAction::Drag => main.start_dragging().map_err(err)?,
    }
    Ok(())
}

/// A page starts loading in `main`: its "frame" is still to come (the previous page's no longer counts).
///
/// Ruhe round 2: 0.6.8 reset the flag only when the load had finished, but the web app hydrates and
/// announces "frame" before that, so the reset could swallow the announcement and the native frame came
/// back after 10 s. The reset now happens at the start of the load, the watcher at its end.
pub fn page_started(app: &AppHandle) {
    let st = app.state::<AppState>();
    st.custom_frame.store(false, Ordering::SeqCst);
    st.frame_gen.fetch_add(1, Ordering::SeqCst);
}

/// A page finished loading in `main`: it has [`FRAME_FALLBACK`] to announce its window buttons,
/// else the native frame comes back (the window must never be left without a way to close it).
/// A "frame" that came between [`page_started`] and now counts.
pub fn watch_frame(app: &AppHandle) {
    let st = app.state::<AppState>();
    let generation = st.frame_gen.load(Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FRAME_FALLBACK).await;
        let st = app.state::<AppState>();
        if !needs_native_frame(st.frame_gen.load(Ordering::SeqCst), generation, st.custom_frame.load(Ordering::SeqCst)) {
            return;
        }
        log::info!("main: the page drew no window buttons, native frame back");
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_decorations(true);
        }
    });
}

/// The fallback acts only for the latest page load and only when that page announced no frame.
pub fn needs_native_frame(current_gen: u64, watched_gen: u64, custom_frame: bool) -> bool {
    current_gen == watched_gen && !custom_frame
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_web_origin_gets_the_bridge() {
        assert_eq!(remote_pattern("https://kortex.example.com").as_deref(), Some("https://kortex.example.com/*"));
        assert_eq!(remote_pattern("https://kortex.example.com/home").as_deref(), Some("https://kortex.example.com/*"));
        assert_eq!(remote_pattern("http://localhost:3000").as_deref(), Some("http://localhost:3000/*"));
        assert_eq!(remote_pattern("tauri://localhost"), None);
        assert_eq!(remote_pattern("not a url"), None);
    }

    #[test]
    fn five_commands_and_the_drag_region_and_nothing_else() {
        assert_eq!(
            permissions(),
            [
                "allow-main-meeting-state",
                "allow-main-start-meeting",
                "allow-main-stop-meeting",
                "allow-main-web-recording",
                "allow-main-window",
                "core:window:allow-start-dragging",
                "core:window:allow-internal-toggle-maximize",
            ]
        );
    }

    #[test]
    fn the_titlebar_actions_are_a_closed_list() {
        assert_eq!(WindowAction::parse("frame"), Some(WindowAction::Frame));
        assert_eq!(WindowAction::parse("minimize"), Some(WindowAction::Minimize));
        assert_eq!(WindowAction::parse("toggle_maximize"), Some(WindowAction::ToggleMaximize));
        assert_eq!(WindowAction::parse("close"), Some(WindowAction::Close));
        assert_eq!(WindowAction::parse("drag"), Some(WindowAction::Drag));
        assert_eq!(WindowAction::parse("set_size"), None);
        assert_eq!(WindowAction::parse(""), None);
    }

    #[test]
    fn the_native_frame_comes_back_only_for_the_latest_page_without_its_own_buttons() {
        assert!(needs_native_frame(3, 3, false));
        // The page announced its buttons.
        assert!(!needs_native_frame(3, 3, true));
        // Another page load started in between: its own watcher decides.
        assert!(!needs_native_frame(4, 3, false));
    }

    #[test]
    fn the_event_script_carries_the_payload_as_json() {
        let s = event_script(&serde_json::json!({ "type": "meeting", "recording": true, "title": "a\"b</script>" }));
        assert!(s.starts_with("window.dispatchEvent(new CustomEvent(\"kortex:desktop\",{detail:{"));
        assert!(s.contains(r#""title":"a\"b</script>""#));
        assert!(s.ends_with("}));"));
    }
}
