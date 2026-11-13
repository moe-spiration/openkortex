//! Global hotkeys (prototype Einstellungen → "Globale Hotkeys").
//!
//!   Alt+Space         Launcher: Quick Capture, Fragen, `?` Suche, `>` Prompts (toggle the capture overlay)
//!   Alt+Shift+Space   Markierung festhalten (copies the selection of the active app into the launcher)
//!   Ctrl+Shift+H      Live-HUD ein oder aus
//!   Ctrl+Shift+R      Aufnahme starten oder beenden
//!   Ctrl+Shift+N      Notiz mit Zeitstempel (focus the HUD note input)
//!   Ctrl+Shift+Space  Gedanke festhalten (voice note in the capture overlay)
//!
//! Every hotkey is registered on its own (audit D-06): before 0.6.1 one taken combination (e.g.
//! Alt+Space by PowerToys Run) made the whole registration fail and all six were dead. A taken
//! hotkey falls back to its alternative (Ctrl+Alt+…); what could not be registered is logged and
//! shown once as a Windows notification.
//!
//! Note: Alt+Space is the Windows system-menu shortcut; registering it globally overrides that
//! for all apps while Kortex runs (same trade-off as PowerToys Run).

use crate::i18n::{t, tf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{commands, inject, window, AppState};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Quick,
    Grab,
    Hud,
    Record,
    Note,
    Voice,
}

/// (action, label, primary, fallback)
pub fn bindings() -> Vec<(Action, &'static str, Shortcut, Option<(Shortcut, &'static str)>)> {
    let ca = Modifiers::CONTROL | Modifiers::ALT;
    let cs = Modifiers::CONTROL | Modifiers::SHIFT;
    vec![
        (Action::Quick, "Alt+Space", Shortcut::new(Some(Modifiers::ALT), Code::Space), Some((Shortcut::new(Some(ca), Code::Space), "Ctrl+Alt+Space"))),
        (Action::Grab, "Alt+Shift+Space", Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Space), Some((Shortcut::new(Some(ca | Modifiers::SHIFT), Code::Space), "Ctrl+Alt+Shift+Space"))),
        (Action::Hud, "Ctrl+Shift+H", Shortcut::new(Some(cs), Code::KeyH), Some((Shortcut::new(Some(ca), Code::KeyH), "Ctrl+Alt+H"))),
        (Action::Record, "Ctrl+Shift+R", Shortcut::new(Some(cs), Code::KeyR), Some((Shortcut::new(Some(ca), Code::KeyR), "Ctrl+Alt+R"))),
        (Action::Note, "Ctrl+Shift+N", Shortcut::new(Some(cs), Code::KeyN), Some((Shortcut::new(Some(ca), Code::KeyN), "Ctrl+Alt+N"))),
        (Action::Voice, "Ctrl+Shift+Space", Shortcut::new(Some(cs), Code::Space), Some((Shortcut::new(Some(ca | Modifiers::SHIFT), Code::KeyV), "Ctrl+Alt+Shift+V"))),
    ]
}

/// The user-facing note about hotkeys that are taken (None = all fine).
pub fn conflict_note(moved: &[(&str, &str)], missing: &[&str]) -> Option<String> {
    if moved.is_empty() && missing.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for (from, to) in moved {
        parts.push(tf("{from} is taken, Kortex uses {to}", &[("from", from), ("to", to)]));
    }
    if !missing.is_empty() {
        parts.push(tf("not available: {keys}", &[("keys", &missing.join(", "))]));
    }
    Some(parts.join("; "))
}

/// Registers every hotkey on its own; returns the conflict note (also shown as a notification).
pub fn register(app: &AppHandle) -> Option<String> {
    let (mut moved, mut missing) = (Vec::new(), Vec::new());
    for (action, label, primary, fallback) in bindings() {
        let handler = move |app: &AppHandle, _sc: &Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent| {
            if event.state() == ShortcutState::Pressed {
                if let Err(e) = run(app, action) {
                    log::warn!("hotkey {action:?} failed: {e:#}");
                }
            }
        };
        match app.global_shortcut().on_shortcut(primary, handler) {
            Ok(()) => continue,
            Err(e) => log::warn!("hotkey {label} not registered: {e}"),
        }
        let Some((alt, alt_label)) = fallback else {
            missing.push(label);
            continue;
        };
        match app.global_shortcut().on_shortcut(alt, handler) {
            Ok(()) => {
                log::info!("hotkey {label} taken, using {alt_label}");
                moved.push((label, alt_label));
            }
            Err(e) => {
                log::warn!("hotkey {alt_label} not registered either: {e}");
                missing.push(label);
            }
        }
    }
    let note = conflict_note(&moved, &missing);
    if let Some(n) = &note {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(t("Kortex: hotkey taken")).body(n).show();
    }
    note
}

fn run(app: &AppHandle, action: Action) -> anyhow::Result<()> {
    match action {
        Action::Quick => {
            toggle_capture(app)?;
            app.emit("shortcut:quick-capture", serde_json::json!({}))?;
        }
        Action::Grab => grab_selection(app),
        Action::Hud => {
            let visible = app.get_webview_window("hud").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
            let recording = app.state::<AppState>().recorder.lock().unwrap().is_some();
            // A running recording with the main window away keeps the pill (window.rs).
            let mode = window::effective_mode(if visible { "off" } else { "hud" }, recording, window::main_away(app));
            *app.state::<AppState>().hud_restore.lock().unwrap() = None;
            window::apply_hud_mode(app, mode)?;
            app.emit("hud:mode", serde_json::json!({ "mode": mode }))?;
        }
        Action::Record => {
            let st = app.state::<AppState>();
            let recording = st.recorder.lock().unwrap().is_some();
            if recording {
                commands::stop_recording_inner(app, &st).map_err(anyhow::Error::msg)?;
            } else {
                commands::start_recording_inner(app, &st).map_err(anyhow::Error::msg)?;
            }
            app.emit("shortcut:record", serde_json::json!({ "recording": !recording }))?;
        }
        Action::Note => {
            app.emit("shortcut:note", serde_json::json!({}))?;
        }
        Action::Voice => {
            // Show (not toggle) the launcher: pressing it again stops the running voice note there.
            show_capture(app)?;
            app.emit("shortcut:voice-note", serde_json::json!({}))?;
        }
    }
    Ok(())
}

fn show_capture(app: &AppHandle) -> anyhow::Result<()> {
    if let Some(w) = app.get_webview_window("capture") {
        if !w.is_visible()? {
            commands::remember_foreground(app);
            commands::show_launcher(app)?;
        }
    }
    Ok(())
}

fn toggle_capture(app: &AppHandle) -> anyhow::Result<()> {
    if let Some(w) = app.get_webview_window("capture") {
        if w.is_visible()? {
            w.hide()?;
        } else {
            // Before the overlay takes the focus: the window a prompt is pasted into later.
            commands::remember_foreground(app);
            commands::show_launcher(app)?;
        }
    }
    Ok(())
}

/// Alt+Shift+Space: copies the active app's selection (clipboard kept) and opens the launcher
/// with it, ready to capture (`launcher:selection`).
fn grab_selection(app: &AppHandle) {
    // Alt is still held: keep the target app from opening its menu bar when it is released.
    inject::mask_alt();
    let prev = inject::foreign_foreground();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let payload = match commands::grab_selection_inner(&app, prev).await {
            Ok(sel) => serde_json::to_value(&sel).unwrap_or_default(),
            Err(message) => {
                // Still open the launcher so the message is visible.
                *app.state::<AppState>().launcher_prev.lock().unwrap() = prev;
                let _ = commands::show_launcher(&app);
                serde_json::json!({ "text": null, "source": null, "message": message })
            }
        };
        let _ = app.emit("launcher:selection", payload);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_hotkey_has_a_distinct_fallback() {
        let b = bindings();
        assert_eq!(b.len(), 6);
        let mut all: Vec<Shortcut> = b.iter().map(|x| x.2.clone()).collect();
        all.extend(b.iter().filter_map(|x| x.3.as_ref().map(|f| f.0.clone())));
        let n = all.len();
        all.sort_by_key(|s| s.id());
        all.dedup_by_key(|s| s.id());
        assert_eq!(all.len(), n, "primary and fallback shortcuts must not collide");
    }

    #[test]
    fn the_note_names_moved_and_missing_hotkeys() {
        assert_eq!(conflict_note(&[], &[]), None);
        assert_eq!(
            conflict_note(&[("Alt+Space", "Ctrl+Alt+Space")], &["Ctrl+Shift+N"]).unwrap(),
            "Alt+Space ist belegt, Kortex nutzt Ctrl+Alt+Space; nicht verfügbar: Ctrl+Shift+N"
        );
    }
}
