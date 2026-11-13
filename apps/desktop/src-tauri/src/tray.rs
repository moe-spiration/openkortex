//! Tray icon. The prototype's tray menu is styled (icons, hints, status header), which native
//! Windows menus can't do, so a click shows the frameless `tray` window above the icon instead of
//! a native context menu. The window hides itself when it loses focus.

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, WindowEvent};

/// Tray window size in logical px (matches the React menu: 320 wide).
const MENU_W: f64 = 320.0;
const MENU_H: f64 = 400.0;

pub fn create(app: &AppHandle) -> anyhow::Result<()> {
    let icon = app.default_window_icon().cloned().ok_or_else(|| anyhow::anyhow!("no app icon"))?;
    TrayIconBuilder::with_id("kortex")
        .icon(icon)
        .tooltip(crate::i18n::PRODUCT_NAME)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left | MouseButton::Right, button_state: MouseButtonState::Up, position, .. } = event {
                let app = tray.app_handle();
                if let Some(menu) = app.get_webview_window("tray") {
                    let scale = menu.scale_factor().unwrap_or(1.0);
                    // Anchor bottom-right corner of the menu at the click point (taskbar at the bottom).
                    let x = position.x - MENU_W * scale;
                    let y = position.y - MENU_H * scale - 8.0 * scale;
                    let _ = menu.set_position(PhysicalPosition::new(x.max(0.0), y.max(0.0)));
                    let _ = menu.show();
                    let _ = menu.set_focus();
                }
            }
        })
        .build(app)?;

    if let Some(menu) = app.get_webview_window("tray") {
        let m = menu.clone();
        menu.on_window_event(move |e| {
            if let WindowEvent::Focused(false) = e {
                let _ = m.hide();
            }
        });
    }
    Ok(())
}

pub fn tooltip(recording: bool) -> &'static str {
    if recording {
        crate::i18n::t("Kortex · Recording (Ctrl+Shift+R stops)")
    } else {
        crate::i18n::PRODUCT_NAME
    }
}

/// Shows a running recording in the tray tooltip (the icon itself stays the app mark).
pub fn set_recording(app: &AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id("kortex") {
        let _ = tray.set_tooltip(Some(tooltip(recording)));
    }
}
