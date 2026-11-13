//! Window helpers: stealth (exclude from screen capture), HUD geometry, and what the HUD does when
//! the main window is minimized.
//!
//! Minimize rules (0.6.2, device test 0.6.1: "the HUD pops up on every minimize"):
//! - main minimized or in the tray **during a recording**: the recording pill (also when the big
//!   HUD was open; it comes back with the main window);
//! - **without a recording nothing happens**: no HUD, no pill (the former setting "Beim Minimieren
//!   das Meeting-HUD zeigen" is gone; a HUD the user opened by hand stays as it is);
//! - main back: whatever was shown before the automatic switch.
//! - (0.6.3, device test 0.6.2) a recording that ended while the main window is away: the pill shows
//!   "Gespeichert" for a moment and then goes (`after_recording`); nothing stays on screen once no
//!   transcript runs and the user did not open the HUD.
//!
//! The main window's state is also polled (`spawn_watch`: 300 ms during a recording, 1 s otherwise),
//! so a missed `Resized` / `Focused` event cannot leave the pill out.

use std::time::Duration;

use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewWindow};

use crate::AppState;

/// Exclude a window from screen capture / screen share (Teams, Zoom, Meet, OBS) while keeping it
/// visible to the user: `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` (Windows 10 2004+).
/// `enabled = false` restores `WDA_NONE`.
#[cfg(windows)]
pub fn set_capture_excluded<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) -> anyhow::Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};

    // Tauri's HWND comes from its own `windows` crate version: pass the raw handle across.
    let hwnd = HWND(window.hwnd()?.0 as _);
    let affinity = if enabled { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    // SAFETY: hwnd belongs to a live Tauri window owned by this process.
    unsafe { SetWindowDisplayAffinity(hwnd, affinity)? };
    Ok(())
}

#[cfg(not(windows))]
pub fn set_capture_excluded<R: Runtime>(_window: &WebviewWindow<R>, _enabled: bool) -> anyhow::Result<()> {
    // TODO(macOS): NSWindow.sharingType = .none
    Ok(())
}

/// HUD window size per mode (matches the React layout: pill 48 px high, HUD 400 x 684).
pub fn hud_size(mode: &str) -> Option<(f64, f64)> {
    match mode {
        "pill" => Some((440.0, 64.0)),
        "hud" => Some((400.0, 684.0)),
        _ => None,
    }
}

/// Top-left of the HUD window: the user's last place (its top-right corner `anchor`, so pill and
/// HUD share the corner) when that is still on a screen, else 48 px from the right edge and 150 px
/// from the top of `monitor` (all physical px).
pub fn hud_position(anchor: Option<(i32, i32)>, width: i32, monitor: (i32, i32, i32, i32), screens: &[(i32, i32, i32, i32)], scale: f64) -> (i32, i32) {
    let on = |x: i32, y: i32| screens.iter().any(|&(mx, my, mw, mh)| x >= mx && x < mx + mw && y >= my && y < my + mh);
    if let Some((right, top)) = anchor {
        // A grip-sized part of the window must stay reachable.
        if on(right - width.min(80), top + 10) {
            return (right - width, top);
        }
    }
    let (mx, my, mw, _) = monitor;
    (mx + mw - width - (48.0 * scale) as i32, my + (150.0 * scale) as i32)
}

/// Show / resize / hide the HUD window ("qc" = the launcher instead).
pub fn apply_hud_mode<R: Runtime>(app: &tauri::AppHandle<R>, mode: &str) -> anyhow::Result<()> {
    let hud = app.get_webview_window("hud").ok_or_else(|| anyhow::anyhow!("hud window missing"))?;
    let capture = app.get_webview_window("capture");
    match (mode, hud_size(mode)) {
        ("qc", _) => {
            if let Some(c) = capture {
                c.center()?;
                c.show()?;
                c.set_focus()?;
            }
        }
        (_, Some((w, h))) => {
            hud.set_size(LogicalSize::new(w, h))?;
            let monitor = hud.current_monitor()?.or(hud.primary_monitor()?);
            if let Some(m) = monitor {
                let scale = m.scale_factor();
                let rect = |m: &tauri::Monitor| (m.position().x, m.position().y, m.size().width as i32, m.size().height as i32);
                let screens: Vec<_> = hud.available_monitors()?.iter().map(rect).collect();
                let anchor = *app.state::<AppState>().hud_anchor.lock().unwrap();
                let (x, y) = hud_position(anchor, (w * scale) as i32, rect(&m), &screens, scale);
                hud.set_position(PhysicalPosition::new(x, y))?;
            }
            hud.show()?;
            if let Some(c) = capture {
                c.hide()?;
            }
        }
        _ => {
            hud.hide()?;
            if let Some(c) = capture {
                c.hide()?;
            }
        }
    }
    if mode != "qc" {
        *app.state::<AppState>().hud_mode.lock().unwrap() = mode.to_string();
    }
    Ok(())
}

/// Applies a mode and tells every window (tray menu, HUD, pill).
pub fn switch_hud<R: Runtime>(app: &tauri::AppHandle<R>, mode: &str) {
    match apply_hud_mode(app, mode) {
        Ok(()) => {
            let _ = app.emit("hud:mode", serde_json::json!({ "mode": mode }));
        }
        Err(e) => log::warn!("hud mode {mode}: {e:#}"),
    }
}

/// The user dragged the HUD: remember its top-right corner (physical px) for the next show.
pub fn remember_hud_place<R: Runtime>(app: &tauri::AppHandle<R>, pos: PhysicalPosition<i32>) {
    let Some(hud) = app.get_webview_window("hud") else { return };
    if !hud.is_visible().unwrap_or(false) {
        return;
    }
    let width = hud.outer_size().map(|s| s.width as i32).unwrap_or(0);
    *app.state::<AppState>().hud_anchor.lock().unwrap() = Some((pos.x + width, pos.y));
}

/// The HUD mode to apply for an explicit request: while a recording runs and the main window is
/// away (minimized or in the tray), "off" becomes the recording pill, so a running recording is
/// always visible somewhere.
pub fn effective_mode(requested: &str, recording: bool, main_away: bool) -> &str {
    if requested == "off" && recording && main_away {
        "pill"
    } else {
        requested
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MainState {
    Shown,
    Minimized,
    /// Closed to the tray (or not shown yet: `main` starts hidden).
    #[default]
    Hidden,
}

pub fn main_state<R: Runtime>(app: &tauri::AppHandle<R>) -> MainState {
    match app.get_webview_window("main") {
        Some(w) if !w.is_visible().unwrap_or(true) => MainState::Hidden,
        Some(w) if w.is_minimized().unwrap_or(false) => MainState::Minimized,
        Some(_) => MainState::Shown,
        None => MainState::Hidden,
    }
}

/// Main window minimized or hidden to the tray.
pub fn main_away<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    main_state(app) != MainState::Shown
}

/// A recording runs that the pill stands for: the native meeting recording, or the web app's own
/// microphone recording in the main window (Orbit-Bar dictation, main_bridge.rs).
pub fn recording(st: &AppState) -> bool {
    st.recorder.lock().unwrap().is_some() || st.web_rec.lock().unwrap().is_some()
}

/// HUD mode when a recording starts (`None` = leave it). From the tray, a hotkey or the
/// Meeting-Center: the live HUD. From the Orbit-Bar in the main window (0.6.4, device test 0.6.3):
/// nothing while the main window is in front (its web app shows the meeting in the Orbit-Bar), the
/// recording pill while it is away; a HUD the user opened stays.
pub fn mode_on_start(from_main: bool, main_away: bool, mode: &str, hud_visible: bool) -> Option<&'static str> {
    let shown = |m: &str| hud_visible && mode == m;
    match (from_main, main_away) {
        (false, _) if shown("hud") => None,
        (false, _) => Some("hud"),
        (true, false) => None,
        (true, true) if shown("pill") || shown("hud") => None,
        (true, true) => Some("pill"),
    }
}

/// What the HUD does when the main window changes to `main`: the new mode and the mode to restore
/// once the main window is back (`None` = nothing to restore). `None` overall = leave it.
pub fn on_main_change(main: MainState, recording: bool, mode: &str, restore: Option<&str>) -> Option<(String, Option<String>)> {
    match main {
        MainState::Shown => restore.map(|r| (r.to_string(), None)),
        _ if recording && mode != "pill" => Some(("pill".into(), Some(restore.unwrap_or(mode).to_string()))),
        // Without a recording, minimizing shows nothing (device test 0.6.1).
        _ => None,
    }
}

/// Reacts to a change of the main window's state (minimized, restored, to the tray). Called from
/// its window events and the watcher; does nothing when the state did not change.
pub fn sync_main<R: Runtime>(app: &tauri::AppHandle<R>) {
    apply_main(app, false);
}

/// `force`: also when the main window did not change (a web recording started while it is away).
pub fn apply_main<R: Runtime>(app: &tauri::AppHandle<R>, force: bool) {
    let now = main_state(app);
    let st = app.state::<AppState>();
    {
        let mut last = st.main_state.lock().unwrap();
        if *last == now && !force {
            return;
        }
        *last = now;
    }
    let recording = recording(&st);
    let mode = st.hud_mode.lock().unwrap().clone();
    let restore = st.hud_restore.lock().unwrap().clone();
    if let Some((next, keep)) = on_main_change(now, recording, &mode, restore.as_deref()) {
        log::info!("main window {now:?}: HUD {mode} -> {next} (recording {recording})");
        *st.hud_restore.lock().unwrap() = keep;
        if next != mode {
            switch_hud(app, &next);
        }
    }
}

/// How long the pill shows the result ("Gespeichert") after a recording, before it goes.
pub const PILL_LINGER: Duration = Duration::from_secs(4);

/// After a recording ended (result known): should the automatic pill go? Only the pill, only while
/// no new recording runs and the main window is still away. A HUD the user opened stays.
pub fn pill_should_go(recording: bool, mode: &str, main_away: bool) -> bool {
    !recording && mode == "pill" && main_away
}

/// Called once a recording's result is known (protocol done, failed, or local only): the pill
/// lingers for `PILL_LINGER`, then hides. What to restore when the main window returns stays.
pub fn after_recording<R: Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(PILL_LINGER).await;
        let st = app.state::<AppState>();
        let recording = recording(&st);
        let mode = st.hud_mode.lock().unwrap().clone();
        if pill_should_go(recording, &mode, main_away(&app)) {
            log::info!("recording over: pill off");
            switch_hud(&app, "off");
        }
    });
}

/// Poll interval of the main window's state: fast only while a minimize can switch something.
pub fn watch_interval(recording: bool, restore_pending: bool) -> Duration {
    if recording || restore_pending {
        Duration::from_millis(300)
    } else {
        Duration::from_millis(1000)
    }
}

/// Polls the main window's state (window events alone proved unreliable). Each poll costs two
/// round trips to the UI thread, so it only runs fast during a recording.
pub fn spawn_watch<R: Runtime>(app: tauri::AppHandle<R>) {
    std::thread::Builder::new()
        .name("kortex-main-watch".into())
        .spawn(move || loop {
            let (recording, restore) = {
                let st = app.state::<AppState>();
                let recording = recording(&st);
                let restore = st.hud_restore.lock().unwrap().is_some();
                (recording, restore)
            };
            std::thread::sleep(watch_interval(recording, restore));
            sync_main(&app);
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;
    use MainState::*;

    #[test]
    fn off_becomes_the_pill_only_while_recording_with_the_main_window_away() {
        assert_eq!(effective_mode("off", true, true), "pill");
        assert_eq!(effective_mode("off", true, false), "off");
        assert_eq!(effective_mode("off", false, true), "off");
        assert_eq!(effective_mode("hud", true, true), "hud");
        assert_eq!(effective_mode("pill", false, false), "pill");
    }

    #[test]
    fn a_meeting_from_the_orbit_bar_shows_the_pill_only_once_the_main_window_is_away() {
        // Device test 0.6.3: started in the main window, minimized -> the pill, not the big HUD.
        assert_eq!(mode_on_start(true, false, "off", false), None);
        assert_eq!(mode_on_start(true, true, "off", false), Some("pill"));
        // A HUD the user opened stays as it is.
        assert_eq!(mode_on_start(true, true, "hud", true), None);
        assert_eq!(mode_on_start(true, true, "pill", true), None);
        // Tray, hotkey, Meeting-Center: the live HUD as before.
        assert_eq!(mode_on_start(false, false, "off", false), Some("hud"));
        assert_eq!(mode_on_start(false, true, "pill", true), Some("hud"));
        assert_eq!(mode_on_start(false, false, "hud", true), None);
        // Then minimizing goes the usual way: pill, and back to nothing with the main window.
        assert_eq!(on_main_change(Minimized, true, "off", None), m("pill", Some("off")));
        assert_eq!(on_main_change(Shown, true, "pill", Some("off")), m("off", None));
    }

    #[test]
    fn hud_sizes() {
        assert_eq!(hud_size("pill"), Some((440.0, 64.0)));
        assert_eq!(hud_size("off"), None);
    }

    fn m(next: &str, restore: Option<&str>) -> Option<(String, Option<String>)> {
        Some((next.to_string(), restore.map(String::from)))
    }

    #[test]
    fn minimizing_during_a_recording_shows_the_pill_even_over_the_open_hud() {
        assert_eq!(on_main_change(Minimized, true, "hud", None), m("pill", Some("hud")));
        assert_eq!(on_main_change(Hidden, true, "off", None), m("pill", Some("off")));
        // Back: the HUD that was open before.
        assert_eq!(on_main_change(Shown, true, "pill", Some("hud")), m("hud", None));
        // Already the pill (chosen by the user): nothing to undo later.
        assert_eq!(on_main_change(Minimized, true, "pill", None), None);
        assert_eq!(on_main_change(Shown, true, "pill", None), None);
    }

    #[test]
    fn minimizing_without_a_recording_shows_nothing() {
        // Device test 0.6.1: no HUD, no pill popping up without a recording.
        assert_eq!(on_main_change(Minimized, false, "off", None), None);
        assert_eq!(on_main_change(Hidden, false, "off", None), None);
        // HUD opened by hand: leave it.
        assert_eq!(on_main_change(Minimized, false, "hud", None), None);
        // A recording ended while minimized: restoring brings back what was there before.
        assert_eq!(on_main_change(Shown, false, "pill", Some("off")), m("off", None));
    }

    #[test]
    fn the_pill_goes_after_a_recording_only_when_nothing_else_wants_it() {
        assert!(pill_should_go(false, "pill", true));
        // A new recording, a HUD the user opened, or the main window back: leave it.
        assert!(!pill_should_go(true, "pill", true));
        assert!(!pill_should_go(false, "hud", true));
        assert!(!pill_should_go(false, "pill", false));
        assert!(!pill_should_go(false, "off", true));
    }

    #[test]
    fn a_recording_started_while_minimized_keeps_the_restore_mode() {
        assert_eq!(on_main_change(Hidden, true, "hud", Some("off")), m("pill", Some("off")));
    }

    #[test]
    fn the_watcher_polls_fast_only_while_a_minimize_can_switch_something() {
        assert_eq!(watch_interval(true, false), Duration::from_millis(300));
        assert_eq!(watch_interval(false, true), Duration::from_millis(300));
        assert_eq!(watch_interval(false, false), Duration::from_millis(1000));
    }

    #[test]
    fn the_hud_returns_to_where_the_user_dragged_it_if_that_is_on_screen() {
        let primary = (0, 0, 1920, 1080);
        let screens = [primary, (1920, 0, 2560, 1440)];
        // Default: 48 px from the right, 150 px from the top of the monitor it is on.
        assert_eq!(hud_position(None, 400, primary, &screens, 1.0), (1920 - 400 - 48, 150));
        assert_eq!(hud_position(None, 600, (1920, 0, 2560, 1440), &screens, 1.5), (1920 + 2560 - 600 - 72, 225));
        // Dragged onto the second screen: pill and HUD share the top-right corner.
        assert_eq!(hud_position(Some((3000, 300)), 440, primary, &screens, 1.0), (2560, 300));
        // Screen gone: back to the default place.
        assert_eq!(hud_position(Some((6000, 300)), 440, primary, &screens, 1.0), (1920 - 440 - 48, 150));
    }
}
