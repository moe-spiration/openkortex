//! Launcher glue to the app the user was working in (Windows): remember the foreground window
//! before the Alt+Space overlay opens, give focus back to it, paste a text into it and copy its
//! selection, both through the clipboard with simulated Ctrl+V / Ctrl+C (`SendInput`). The user's
//! clipboard is snapshotted before and restored afterwards, so a paste or a selection grab does
//! not overwrite what they had copied.
//!
//! Only plain memory (HGLOBAL) clipboard formats can be restored; GDI handle formats (CF_BITMAP,
//! metafiles, palettes, owner display) are skipped, Windows synthesizes CF_BITMAP from CF_DIB.
//! Our own clipboard writes are marked to stay out of the clipboard history (Win+V) and the cloud
//! clipboard.
//!
//! Pure helpers (formats, key sequences, text cleanup) are unit-tested on every platform; the
//! Win32 calls compile on Windows only and are no-ops elsewhere.

use crate::i18n::t;
use std::time::Duration;

/// Selections larger than this are cut (a quick capture, not a document import).
pub const MAX_SELECTION_CHARS: usize = 100_000;
/// How long a grab waits for the target app to put the selection on the clipboard.
pub const COPY_WAIT: Duration = Duration::from_millis(600);
/// How long the target app gets to read the clipboard after Ctrl+V before it is restored.
pub const PASTE_SETTLE: Duration = Duration::from_millis(300);
/// Time for the target window to become foreground before keys are sent.
pub const FOCUS_SETTLE: Duration = Duration::from_millis(80);
/// How long we wait for the user to let go of the hotkey's modifiers.
pub const RELEASE_WAIT: Duration = Duration::from_millis(1500);

pub const VK_C: u16 = 0x43;
pub const VK_V: u16 = 0x56;
/// Unassigned virtual key: tapping it while Alt is held keeps the target app from opening its menu
/// bar when Alt is released (the hotkey's Space never reached it).
pub const VK_MASK: u16 = 0xE8;

const CF_TEXT: u32 = 1;
const CF_UNICODETEXT: u32 = 13;
const CF_LOCALE: u32 = 16;

/// Clipboard formats whose data is not plain HGLOBAL memory and therefore cannot be copied byte
/// for byte: CF_BITMAP, CF_METAFILEPICT, CF_PALETTE, CF_ENHMETAFILE, CF_OWNERDISPLAY, CF_DSPBITMAP,
/// CF_DSPMETAFILEPICT, CF_DSPENHMETAFILE and the private GDI object range 0x300..=0x3FF.
pub fn is_restorable_format(format: u32) -> bool {
    !matches!(format, 0 | 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E | 0x300..=0x3FF)
}

/// Key events (virtual key, key-up) for Ctrl+<vk>: Ctrl down, key down, key up, Ctrl up.
pub fn ctrl_combo(vk: u16) -> [(u16, bool); 4] {
    const CTRL: u16 = 0x11;
    [(CTRL, false), (vk, false), (vk, true), (CTRL, true)]
}

/// NUL-terminated UTF-16 for CF_UNICODETEXT.
pub fn to_utf16z(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// CF_UNICODETEXT memory back to a String (stops at the first NUL).
pub fn from_utf16z(units: &[u16]) -> String {
    let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
    String::from_utf16_lossy(&units[..end])
}

/// Copied text as a capture: CRLF → LF, trailing whitespace off, cut at MAX_SELECTION_CHARS;
/// None when nothing but whitespace was selected.
pub fn clean_selection(raw: &str) -> Option<String> {
    let text = raw.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim_end();
    let text = text.trim_start_matches('\n');
    if text.trim().is_empty() {
        return None;
    }
    Some(text.chars().take(MAX_SELECTION_CHARS).collect())
}

/// One clipboard format and its bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipEntry {
    pub format: u32,
    pub data: Vec<u8>,
}

/// Everything restorable that was on the clipboard.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClipSnapshot {
    pub entries: Vec<ClipEntry>,
}

impl ClipSnapshot {
    /// The entries worth writing back: restorable formats, and CF_TEXT / CF_LOCALE only when there
    /// is no CF_UNICODETEXT (Windows synthesizes them from it).
    pub fn to_restore(&self) -> Vec<&ClipEntry> {
        let has_unicode = self.entries.iter().any(|e| e.format == CF_UNICODETEXT);
        self.entries
            .iter()
            .filter(|e| is_restorable_format(e.format))
            .filter(|e| !(has_unicode && (e.format == CF_TEXT || e.format == CF_LOCALE)))
            .collect()
    }
}

/// Window title for the capture's source line ("Markierung aus …"), without the app suffix noise.
pub fn source_label(title: &str) -> Option<String> {
    let t = title.trim();
    if t.is_empty() {
        return None;
    }
    Some(t.chars().take(120).collect())
}

pub use platform::*;

#[cfg(windows)]
mod platform {
    use super::*;
    use anyhow::{anyhow, bail, Result};
    use windows::core::w;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, SetForegroundWindow, ShowWindow,
        SW_RESTORE,
    };

    fn hwnd(raw: isize) -> HWND {
        HWND(raw as _)
    }

    /// The current foreground window, unless it belongs to Kortex itself.
    pub fn foreign_foreground() -> Option<isize> {
        // SAFETY: plain Win32 queries without pointers we own.
        unsafe {
            let w = GetForegroundWindow();
            if w.0.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(w, Some(&mut pid as *mut u32));
            (pid != std::process::id()).then_some(w.0 as isize)
        }
    }

    pub fn window_title(raw: isize) -> String {
        let mut buf = [0u16; 256];
        // SAFETY: buf outlives the call; GetWindowTextW writes at most buf.len() units.
        let n = unsafe { GetWindowTextW(hwnd(raw), &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    /// Gives the foreground back to `raw` (restored when minimized). false when it is gone.
    pub fn focus(raw: isize) -> bool {
        // SAFETY: the handle is checked with IsWindow first; the calls only take it by value.
        unsafe {
            let w = hwnd(raw);
            if !IsWindow(Some(w)).as_bool() {
                return false;
            }
            if IsIconic(w).as_bool() {
                let _ = ShowWindow(w, SW_RESTORE);
            }
            SetForegroundWindow(w).as_bool()
        }
    }

    fn key_input(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send(keys: &[(u16, bool)]) -> Result<()> {
        let inputs: Vec<INPUT> = keys.iter().map(|&(vk, up)| key_input(vk, up)).collect();
        // SAFETY: `inputs` is a valid slice of INPUT structs for the duration of the call.
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            bail!(crate::i18n::tf("Keystroke was blocked (SendInput: {sent}/{total})", &[("sent", &sent), ("total", &inputs.len())]));
        }
        Ok(())
    }

    /// Taps the unassigned mask key (see VK_MASK).
    pub fn mask_alt() {
        let _ = send(&[(VK_MASK, false), (VK_MASK, true)]);
    }

    fn modifiers_down() -> bool {
        [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
            .iter()
            // SAFETY: GetAsyncKeyState only reads key state.
            .any(|vk| unsafe { GetAsyncKeyState(vk.0 as i32) } < 0)
    }

    /// Waits until no modifier is held (the hotkey's Alt/Shift would turn Ctrl+C into something else).
    pub fn wait_modifiers_released(max: Duration) {
        let start = std::time::Instant::now();
        while modifiers_down() && start.elapsed() < max {
            std::thread::sleep(Duration::from_millis(15));
        }
    }

    /// Open/close guard; another app may hold the clipboard for a moment, so opening retries.
    struct Clipboard;
    impl Clipboard {
        fn open() -> Result<Self> {
            for _ in 0..20 {
                // SAFETY: no owner window; closed again in Drop.
                if unsafe { OpenClipboard(None) }.is_ok() {
                    return Ok(Clipboard);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(anyhow!(t("The clipboard is currently in use by another app")))
        }
    }
    impl Drop for Clipboard {
        fn drop(&mut self) {
            // SAFETY: we opened it in `open`.
            let _ = unsafe { CloseClipboard() };
        }
    }

    pub fn sequence() -> u32 {
        // SAFETY: plain query.
        unsafe { GetClipboardSequenceNumber() }
    }

    fn read_bytes(format: u32) -> Option<Vec<u8>> {
        // SAFETY: the clipboard is open; the HGLOBAL stays owned by the clipboard and is only read
        // between GlobalLock and GlobalUnlock.
        unsafe {
            let h = GetClipboardData(format).ok()?;
            let g = HGLOBAL(h.0);
            let size = GlobalSize(g);
            let ptr = GlobalLock(g) as *const u8;
            if ptr.is_null() {
                return None;
            }
            let data = std::slice::from_raw_parts(ptr, size).to_vec();
            let _ = GlobalUnlock(g);
            Some(data)
        }
    }

    fn write_bytes(format: u32, data: &[u8]) -> Result<()> {
        // SAFETY: the clipboard is open and emptied by the caller; on success SetClipboardData owns
        // the allocation, so it is not freed here.
        unsafe {
            let g = GlobalAlloc(GMEM_MOVEABLE, data.len().max(1))?;
            let ptr = GlobalLock(g) as *mut u8;
            if ptr.is_null() {
                bail!(t("GlobalLock failed"));
            }
            std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, data.len());
            let _ = GlobalUnlock(g);
            SetClipboardData(format, Some(HANDLE(g.0)))?;
        }
        Ok(())
    }

    /// Keeps our clipboard writes out of the clipboard history (Win+V) and the cloud clipboard.
    fn mark_private() {
        // SAFETY: the clipboard is open; the format names are static wide strings.
        unsafe {
            let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
            let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
            let cloud = RegisterClipboardFormatW(w!("CanUploadToCloudClipboard"));
            let zero = 0u32.to_le_bytes();
            for (f, data) in [(exclude, &zero[..]), (history, &zero[..]), (cloud, &zero[..])] {
                if f != 0 {
                    let _ = write_bytes(f, data);
                }
            }
        }
    }

    pub fn snapshot() -> Result<ClipSnapshot> {
        let _cb = Clipboard::open()?;
        let mut entries = Vec::new();
        let mut format = 0u32;
        loop {
            // SAFETY: the clipboard is open.
            format = unsafe { EnumClipboardFormats(format) };
            if format == 0 {
                break;
            }
            if !is_restorable_format(format) {
                continue;
            }
            if let Some(data) = read_bytes(format) {
                entries.push(ClipEntry { format, data });
            }
        }
        Ok(ClipSnapshot { entries })
    }

    pub fn restore(snap: &ClipSnapshot) -> Result<()> {
        let _cb = Clipboard::open()?;
        // SAFETY: the clipboard is open.
        unsafe { EmptyClipboard()? };
        for e in snap.to_restore() {
            if let Err(err) = write_bytes(e.format, &e.data) {
                log::warn!("clipboard format {} not restored: {err:#}", e.format);
            }
        }
        if !snap.entries.is_empty() {
            mark_private();
        }
        Ok(())
    }

    /// Puts `text` on the clipboard. `private` keeps it out of the clipboard history.
    pub fn set_text(text: &str, private: bool) -> Result<()> {
        let _cb = Clipboard::open()?;
        // SAFETY: the clipboard is open.
        unsafe { EmptyClipboard()? };
        let units = to_utf16z(text);
        let bytes: Vec<u8> = units.iter().flat_map(|u| u.to_le_bytes()).collect();
        write_bytes(CF_UNICODETEXT, &bytes)?;
        if private {
            mark_private();
        }
        Ok(())
    }

    pub fn get_text() -> Option<String> {
        let _cb = Clipboard::open().ok()?;
        let bytes = read_bytes(CF_UNICODETEXT)?;
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        Some(from_utf16z(&units))
    }

    /// Focuses `target` and pastes `text` there with Ctrl+V; the previous clipboard comes back
    /// afterwards. Blocking (sleeps), run it off the main thread.
    pub fn paste_into(target: Option<isize>, text: &str) -> Result<()> {
        let snap = snapshot().unwrap_or_default();
        set_text(text, true)?;
        if let Some(t) = target {
            if !focus(t) {
                log::warn!("previous window could not be focused, pasting into the foreground window");
            }
        }
        std::thread::sleep(FOCUS_SETTLE);
        wait_modifiers_released(RELEASE_WAIT);
        let sent = send(&ctrl_combo(VK_V));
        std::thread::sleep(PASTE_SETTLE);
        if let Err(e) = restore(&snap) {
            log::warn!("clipboard not restored: {e:#}");
        }
        sent
    }

    /// Copies the selection of `target` (or the current foreground window) with Ctrl+C and gives
    /// back its text; the clipboard is restored. Ok(None) when nothing text-like was selected.
    pub fn copy_selection(target: Option<isize>) -> Result<Option<String>> {
        wait_modifiers_released(RELEASE_WAIT);
        if let Some(t) = target {
            focus(t);
            std::thread::sleep(FOCUS_SETTLE);
        }
        let snap = snapshot().unwrap_or_default();
        let before = sequence();
        send(&ctrl_combo(VK_C))?;
        let start = std::time::Instant::now();
        while sequence() == before && start.elapsed() < COPY_WAIT {
            std::thread::sleep(Duration::from_millis(15));
        }
        if sequence() == before {
            // The app did not copy anything: nothing selected, or it ignores Ctrl+C.
            return Ok(None);
        }
        // Some apps write the clipboard in several steps; give them a moment.
        std::thread::sleep(Duration::from_millis(40));
        let text = get_text();
        if let Err(e) = restore(&snap) {
            log::warn!("clipboard not restored: {e:#}");
        }
        Ok(text.as_deref().and_then(clean_selection))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    use anyhow::{bail, Result};

    // TODO(macOS): NSPasteboard + CGEvent (Cmd+C / Cmd+V) once the desktop app ships there.
    pub fn foreign_foreground() -> Option<isize> {
        None
    }
    pub fn window_title(_raw: isize) -> String {
        String::new()
    }
    pub fn focus(_raw: isize) -> bool {
        false
    }
    pub fn mask_alt() {}
    pub fn wait_modifiers_released(_max: Duration) {}
    pub fn snapshot() -> Result<ClipSnapshot> {
        Ok(ClipSnapshot::default())
    }
    pub fn restore(_snap: &ClipSnapshot) -> Result<()> {
        Ok(())
    }
    pub fn set_text(_text: &str, _private: bool) -> Result<()> {
        bail!(t("Clipboard only on Windows"))
    }
    pub fn paste_into(_target: Option<isize>, _text: &str) -> Result<()> {
        bail!(t("Pasting only on Windows"))
    }
    pub fn copy_selection(_target: Option<isize>) -> Result<Option<String>> {
        bail!(t("Grabbing the selection only on Windows"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gdi_handle_formats_are_not_restored() {
        for f in [2, 3, 9, 14, 0x80, 0x82, 0x83, 0x8E, 0x300, 0x3FF] {
            assert!(!is_restorable_format(f), "{f:#x}");
        }
        for f in [1, 7, 8, 13, 15, 16, 17, 0xC000, 0xC123] {
            assert!(is_restorable_format(f), "{f:#x}");
        }
    }

    #[test]
    fn ctrl_combo_presses_and_releases_in_order() {
        assert_eq!(ctrl_combo(VK_V), [(0x11, false), (0x56, false), (0x56, true), (0x11, true)]);
        assert_eq!(ctrl_combo(VK_C)[1], (0x43, false));
    }

    #[test]
    fn utf16_round_trip_stops_at_nul() {
        let units = to_utf16z("Grüße 👋");
        assert_eq!(*units.last().unwrap(), 0);
        assert_eq!(from_utf16z(&units), "Grüße 👋");
        assert_eq!(from_utf16z(&[0x41, 0, 0x42]), "A");
        assert_eq!(from_utf16z(&[0x41, 0x42]), "AB");
    }

    #[test]
    fn selections_are_cleaned_and_capped() {
        assert_eq!(clean_selection("  \r\n \t "), None);
        assert_eq!(clean_selection(""), None);
        assert_eq!(clean_selection("\r\nZeile 1\r\nZeile 2\r\n\r\n").as_deref(), Some("Zeile 1\nZeile 2"));
        assert_eq!(clean_selection("  eingerückt").as_deref(), Some("  eingerückt"));
        let long = "ä".repeat(MAX_SELECTION_CHARS + 10);
        assert_eq!(clean_selection(&long).unwrap().chars().count(), MAX_SELECTION_CHARS);
    }

    #[test]
    fn restore_skips_synthesized_text_formats_next_to_unicode() {
        let e = |format: u32| ClipEntry { format, data: vec![1] };
        let snap = ClipSnapshot { entries: vec![e(13), e(1), e(16), e(0xC0AB), e(2)] };
        let formats: Vec<u32> = snap.to_restore().iter().map(|x| x.format).collect();
        assert_eq!(formats, vec![13, 0xC0AB]);
        let ansi_only = ClipSnapshot { entries: vec![e(1), e(16)] };
        assert_eq!(ansi_only.to_restore().len(), 2);
    }

    #[test]
    fn source_label_trims_and_caps() {
        assert_eq!(source_label("  "), None);
        assert_eq!(source_label(" Inbox – Outlook ").as_deref(), Some("Inbox – Outlook"));
        assert_eq!(source_label(&"x".repeat(300)).unwrap().len(), 120);
    }
}
