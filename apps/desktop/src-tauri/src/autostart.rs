//! "Mit Windows starten" (Einstellungen): a `Kortex` value under
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` that starts the app with `--tray`, so it
//! comes up hidden in the tray (hotkeys and HUD ready, no main window). Per user, no admin rights.

use std::path::Path;

pub const TRAY_ARG: &str = "--tray";
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const VALUE: &str = "Kortex";

/// The command line stored in the Run key.
pub fn run_command(exe: &Path) -> String {
    format!("\"{}\" {TRAY_ARG}", exe.display())
}

/// Started by the Run key (or by hand with `--tray`): stay in the tray.
pub fn starts_in_tray<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().skip(1).any(|a| a == TRAY_ARG)
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn is_enabled() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let (key, value) = (wide(RUN_KEY), wide(VALUE));
    let mut size = 0u32;
    // SAFETY: valid NUL-terminated strings; only the size is queried.
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, PCWSTR(key.as_ptr()), PCWSTR(value.as_ptr()), RRF_RT_REG_SZ, None, None, Some(&mut size)) };
    r.is_ok()
}

#[cfg(windows)]
pub fn set_enabled(enabled: bool) -> anyhow::Result<()> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let (key, value) = (wide(RUN_KEY), wide(VALUE));
    if enabled {
        let data = wide(&run_command(&std::env::current_exe()?));
        // SAFETY: `data` is a NUL-terminated UTF-16 string of `data.len() * 2` bytes.
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(key.as_ptr()),
                PCWSTR(value.as_ptr()),
                REG_SZ.0,
                Some(data.as_ptr().cast()),
                (data.len() * 2) as u32,
            )
            .ok()?;
        }
    } else {
        // SAFETY: valid NUL-terminated strings.
        let r = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, PCWSTR(key.as_ptr()), PCWSTR(value.as_ptr())) };
        if r != ERROR_FILE_NOT_FOUND {
            r.ok()?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn is_enabled() -> bool {
    false
}

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool) -> anyhow::Result<()> {
    anyhow::bail!(crate::i18n::t("Autostart is only available on Windows so far"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_key_command_quotes_the_path_and_starts_in_the_tray() {
        let cmd = run_command(Path::new(r"C:\Program Files\Kortex\kortex-desktop.exe"));
        assert_eq!(cmd, r#""C:\Program Files\Kortex\kortex-desktop.exe" --tray"#);
        assert!(starts_in_tray(["kortex-desktop.exe".to_string(), "--tray".to_string()]));
        assert!(!starts_in_tray(["kortex-desktop.exe".to_string()]));
        // argv[0] never counts, even if it were literally "--tray".
        assert!(!starts_in_tray(["--tray".to_string()]));
    }
}
