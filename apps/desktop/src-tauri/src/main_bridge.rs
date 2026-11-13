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
//!   `stop_web_recording`.
//!
//! Core → web app: [`notify_main`] dispatches a `kortex:desktop` DOM event in `main` (script eval,
//! no event permission for the remote page).

use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::{self, MeetingState, StopResult};
use crate::{window, AppState};

type CmdResult<T> = Result<T, String>;

/// The only commands the remote web app in `main` may call.
pub const MAIN_COMMANDS: [&str; 4] = ["main_meeting_state", "main_start_meeting", "main_stop_meeting", "main_web_recording"];

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

/// Permission ids of [`MAIN_COMMANDS`] (tauri-build: `allow-<command in kebab case>`).
pub fn permissions() -> Vec<String> {
    MAIN_COMMANDS.iter().map(|c| format!("allow-{}", c.replace('_', "-"))).collect()
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
    fn four_commands_and_nothing_else() {
        assert_eq!(
            permissions(),
            ["allow-main-meeting-state", "allow-main-start-meeting", "allow-main-stop-meeting", "allow-main-web-recording"]
        );
    }

    #[test]
    fn the_event_script_carries_the_payload_as_json() {
        let s = event_script(&serde_json::json!({ "type": "meeting", "recording": true, "title": "a\"b</script>" }));
        assert!(s.starts_with("window.dispatchEvent(new CustomEvent(\"kortex:desktop\",{detail:{"));
        assert!(s.contains(r#""title":"a\"b</script>""#));
        assert!(s.ends_with("}));"));
    }
}
