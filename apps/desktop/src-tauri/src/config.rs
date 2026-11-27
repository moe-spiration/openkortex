//! Desktop settings, stored as JSON in the app config dir (`%APPDATA%\io.github.moe-spiration.openkortex\desktop.json`).
//!
//! Nothing secret is compiled in, and no server address either: the web URL, the Supabase URL and
//! the anon key (public by design) come from this file or the environment. A build may name its own
//! Kortex (`KORTEX_DEFAULT_WEB_URL` / `KORTEX_DEFAULT_SUPABASE_URL` at compile time, see build.rs);
//! without one the app asks for the server on first start (`set_server`, commands.rs). The refresh token of the
//! signed-in account lives in the Windows Credential Manager (see `secrets.rs`); this file only
//! keeps it as a fallback where the credential store is unavailable.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::i18n::{t, tf};

/// The Kortex this build is preconfigured for; None = the user enters the server on first start.
pub const DEFAULT_WEB_URL: Option<&str> = option_env!("KORTEX_DEFAULT_WEB_URL");
pub const DEFAULT_SUPABASE_URL: Option<&str> = option_env!("KORTEX_DEFAULT_SUPABASE_URL");

/// Shown wherever a server is needed and none is set up yet.
pub fn no_server() -> &'static str {
    t("No Kortex server set up (Settings → Server)")
}

/// Serializes read-modify-write of desktop.json within the process (review N5 #17).
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopConfig {
    /// Web app loaded in the main window and used for the API (`/api/chat/transcribe`, `/api/ingest`).
    pub web_url: Option<String>,
    pub supabase_url: Option<String>,
    pub supabase_anon_key: Option<String>,
    /// Account signed in from the desktop.
    pub email: Option<String>,
    /// Fallback only: the refresh token when the credential store is not available.
    pub refresh_token: Option<String>,
    /// Upload recordings after "Aufnahme beenden" (default true when an account is connected).
    pub auto_upload: Option<bool>,
    /// Audio-Setup: microphone and loopback source (cpal names); None = system default.
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    /// Windows notifications for due reminders and radar changes (default on, reminders.rs).
    pub reminders: Option<bool>,
    /// Vault folder synced by the md-sync sidecar (vault.rs); None = not set up yet.
    pub vault_path: Option<String>,
    /// Vault sync on/off (default on once a folder is chosen).
    pub vault_sync: Option<bool>,
    /// First-run vault setup was shown and answered or postponed (no second automatic prompt).
    pub vault_setup_done: Option<bool>,
    /// Language of the app's own texts ("en" | "de", i18n.rs); None = the Windows display language.
    pub locale: Option<String>,
    /// Size of the former resizable HUD (0.6.5 to 0.6.7). Read and kept, no longer used: the meeting
    /// bar sizes itself to its content (window.rs).
    pub hud_size: Option<[f64; 2]>,
    /// Light or dark windows: "light" | "dark"; None or "system" = follow Windows (commands.rs `set_theme`).
    pub theme: Option<String>,
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty() && !v.starts_with('<'))
}

/// Only `https://` anywhere, `http://` only for localhost / 127.0.0.1 / [::1] (review N5 #7):
/// the password and bearer tokens must never travel in clear text over the network.
pub fn secure_base_url(raw: &str) -> Result<String> {
    let s = raw.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(s).with_context(|| tf("invalid URL: {url}", &[("url", &s)]))?;
    let local = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("::1"));
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        other => bail!(tf("{url}: only https:// (or http://localhost) is allowed, not {scheme}://", &[("url", &s), ("scheme", &other)])),
    }
    if url.host_str().is_none() {
        bail!(tf("{url}: host is missing", &[("url", &s)]));
    }
    Ok(s.to_string())
}

impl DesktopConfig {
    /// The configured web URL before validation: environment, desktop.json, then the build's own.
    fn raw_web_url(&self) -> Option<String> {
        env("KORTEX_WEB_URL").or_else(|| self.web_url.clone()).or_else(|| DEFAULT_WEB_URL.map(String::from))
    }

    /// False until a server is known (first start of a build without its own Kortex).
    pub fn has_server(&self) -> bool {
        self.raw_web_url().is_some()
    }

    pub fn web_url(&self) -> Result<String> {
        match self.raw_web_url() {
            Some(url) => secure_base_url(&url),
            None => bail!(no_server()),
        }
    }

    pub fn supabase_url(&self) -> Result<String> {
        match env("KORTEX_SUPABASE_URL").or_else(|| self.supabase_url.clone()).or_else(|| DEFAULT_SUPABASE_URL.map(String::from)) {
            Some(url) => secure_base_url(&url),
            None => bail!(no_server()),
        }
    }

    pub fn anon_key(&self) -> Option<String> {
        env("KORTEX_SUPABASE_ANON_KEY").or_else(|| self.supabase_anon_key.clone()).or_else(|| option_env!("KORTEX_SUPABASE_ANON_KEY").map(String::from))
    }

    pub fn auto_upload(&self) -> bool {
        self.auto_upload.unwrap_or(true)
    }

    pub fn reminders_enabled(&self) -> bool {
        self.reminders.unwrap_or(true)
    }

    pub fn vault_sync_enabled(&self) -> bool {
        self.vault_sync.unwrap_or(true)
    }

    pub fn load(path: &Path) -> Result<Self> {
        match std::fs::read_to_string(path) {
            Ok(s) => serde_json::from_str(&s).with_context(|| format!("parse {}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
        }
    }

    /// Atomic write (temp file + rename).
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

pub fn config_path(config_dir: &Path) -> PathBuf {
    config_dir.join("desktop.json")
}

/// Load, change and save desktop.json under the process-wide lock.
pub fn update<T>(config_dir: &Path, change: impl FnOnce(&mut DesktopConfig) -> T) -> Result<T> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = config_path(config_dir);
    let mut cfg = DesktopConfig::load(&path)?;
    let out = change(&mut cfg);
    cfg.save(&path)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_round_trip() {
        let c = DesktopConfig::default();
        // A build without its own Kortex has no server until the user enters one.
        match DEFAULT_SUPABASE_URL {
            Some(url) => assert_eq!(c.supabase_url().unwrap(), url),
            None => assert!(c.supabase_url().is_err()),
        }
        assert_eq!(c.has_server(), DEFAULT_WEB_URL.is_some() || env("KORTEX_WEB_URL").is_some());
        let own = DesktopConfig { web_url: Some("https://kortex.example.com/".into()), ..Default::default() };
        assert!(own.has_server());
        assert!(c.auto_upload());
        assert!(c.reminders_enabled());
        assert!(!DesktopConfig { reminders: Some(false), ..Default::default() }.reminders_enabled());
        let dir = std::env::temp_dir().join(format!("kortex-cfg-{}", std::process::id()));
        let path = config_path(&dir);
        assert_eq!(DesktopConfig::load(&path).unwrap(), DesktopConfig::default());
        let c = DesktopConfig { web_url: Some("http://localhost:3000/".into()), email: Some("a@b.c".into()), ..Default::default() };
        c.save(&path).unwrap();
        let back = DesktopConfig::load(&path).unwrap();
        assert_eq!(back, c);
        assert_eq!(back.web_url().unwrap(), "http://localhost:3000");
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"webUrl\""));
        update(&dir, |c| c.email = Some("x@y.z".into())).unwrap();
        assert_eq!(DesktopConfig::load(&path).unwrap().email.as_deref(), Some("x@y.z"));
        // Device choice survives a restart and keeps the other fields.
        update(&dir, |c| c.input_device = Some("Mikrofon (Shure MV7)".into())).unwrap();
        let back = DesktopConfig::load(&path).unwrap();
        assert_eq!(back.input_device.as_deref(), Some("Mikrofon (Shure MV7)"));
        assert_eq!(back.email.as_deref(), Some("x@y.z"));
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"inputDevice\""));
        // Older files without the field still load.
        std::fs::write(&path, r#"{"webUrl":"https://kortex.example.com"}"#).unwrap();
        assert_eq!(DesktopConfig::load(&path).unwrap().input_device, None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_https_or_localhost() {
        assert_eq!(secure_base_url("https://kortex.example.com/").unwrap(), "https://kortex.example.com");
        assert!(secure_base_url("http://127.0.0.1:3000").is_ok());
        assert!(secure_base_url("http://[::1]:3000").is_ok());
        assert!(secure_base_url("http://kortex.example.com").is_err());
        assert!(secure_base_url("http://localhost.evil.com").is_err());
        assert!(secure_base_url("ftp://kortex.example.com").is_err());
        assert!(secure_base_url("kortex.example.com").is_err());
        let bad = DesktopConfig { supabase_url: Some("http://supabase.example".into()), ..Default::default() };
        assert!(bad.supabase_url().is_err());
    }
}
