//! The account credential: a Supabase refresh token (storage and rotation) or a personal API token.
//!
//! - **Personal API token** (`kx_…`, web app → Einstellungen → Persönliche API-Tokens): the simple
//!   way in, no Supabase sign-in and no anon key. It works for capture (`/api/ingest`) and
//!   transcription (`/api/chat/transcribe`): quick capture, voice notes and record-then-upload
//!   meetings. Live meetings (session, coaching) need the Supabase sign-in.
//!
//! - Stored in the Windows Credential Manager (`keyring`, service `io.github.moe-spiration.openkortex`). Where the
//!   credential store fails, it falls back to `refreshToken` in desktop.json; a token found there is
//!   moved into the credential store on the next read (review N5 #17).
//! - Supabase rotates the refresh token on every use. All refreshes run one at a time behind an
//!   async mutex, and the rotated token is persisted right after `refresh()` succeeds, before the
//!   upload or capture that needed it runs (review N5 #1).

use crate::i18n::{t, tf};
use std::path::Path;

use anyhow::{anyhow, Result};

use crate::config::{self, config_path, DesktopConfig};
use crate::upload::{self, Session};

static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Access tokens are reused for a few minutes: a live meeting calls the API every few seconds, and
/// every refresh rotates (and persists) the refresh token. Supabase access tokens live 1 h.
const TOKEN_REUSE: std::time::Duration = std::time::Duration::from_secs(10 * 60);
static CACHED: std::sync::Mutex<Option<(String, std::time::Instant)>> = std::sync::Mutex::new(None);

fn cached_token() -> Option<String> {
    let c = CACHED.lock().unwrap_or_else(|p| p.into_inner());
    c.as_ref().filter(|(_, at)| at.elapsed() < TOKEN_REUSE).map(|(t, _)| t.clone())
}

fn set_cached(token: Option<String>) {
    *CACHED.lock().unwrap_or_else(|p| p.into_inner()) = token.map(|t| (t, std::time::Instant::now()));
}

/// Drops the reused access token (after a 401, sign-in or sign-out).
pub fn forget_access_token() {
    set_cached(None);
}

pub trait TokenStore: Send + Sync {
    fn get(&self) -> Result<Option<String>>;
    fn set(&self, token: &str) -> Result<()>;
    fn delete(&self) -> Result<()>;
}

/// Windows Credential Manager via `keyring`.
pub struct Keyring;

const SERVICE: &str = "io.github.moe-spiration.openkortex";
const ACCOUNT: &str = "supabase-refresh-token";

impl Keyring {
    fn entry() -> Result<keyring::Entry> {
        Ok(keyring::Entry::new(SERVICE, ACCOUNT)?)
    }
}

impl TokenStore for Keyring {
    fn get(&self) -> Result<Option<String>> {
        match Self::entry()?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    fn set(&self, token: &str) -> Result<()> {
        Ok(Self::entry()?.set_password(token)?)
    }
    fn delete(&self) -> Result<()> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

pub fn default_store() -> Keyring {
    Keyring
}

/// The stored refresh token (credential store first, then the desktop.json fallback, migrating it).
pub fn load(config_dir: &Path, store: &dyn TokenStore) -> Result<Option<String>> {
    let from_store = match store.get() {
        Ok(t) => t,
        Err(e) => {
            log::warn!("credential store unavailable, using desktop.json: {e:#}");
            return Ok(DesktopConfig::load(&config_path(config_dir))?.refresh_token);
        }
    };
    if from_store.is_some() {
        return Ok(from_store);
    }
    let file = DesktopConfig::load(&config_path(config_dir))?.refresh_token;
    if let Some(t) = &file {
        if store.set(t).is_ok() {
            config::update(config_dir, |c| c.refresh_token = None)?;
        }
    }
    Ok(file)
}

/// Saves (or with `None` removes) the refresh token; `email` updates the shown account.
pub fn save(config_dir: &Path, store: &dyn TokenStore, token: Option<&str>, email: Option<Option<String>>) -> Result<()> {
    let in_store = match token {
        Some(t) => store.set(t).is_ok(),
        None => store.delete().is_ok(),
    };
    config::update(config_dir, |c| {
        c.refresh_token = if in_store { None } else { token.map(String::from) };
        if let Some(e) = email {
            c.email = e;
        }
    })
}

/// `kx_` + 43 base64url characters, the format of the web app's personal API tokens.
pub fn is_personal_token(t: &str) -> bool {
    t.len() == 46 && t.starts_with("kx_") && t[3..].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// true when the stored credential is a personal API token (no live meetings with it).
pub fn uses_personal_token(config_dir: &Path, store: &dyn TokenStore) -> bool {
    load(config_dir, store).ok().flatten().is_some_and(|t| is_personal_token(&t))
}

pub fn is_connected(config_dir: &Path, store: &dyn TokenStore) -> bool {
    load(config_dir, store).map(|t| t.is_some()).unwrap_or(false)
}

fn persist(config_dir: &Path, store: &dyn TokenStore, s: &Session) {
    let email = s.email.clone().map(Some);
    if let Err(e) = save(config_dir, store, Some(&s.refresh_token), email) {
        // The old token is spent already; nothing better to do than to report it.
        log::error!("could not persist the rotated refresh token: {e:#}");
    }
}

/// A fresh access token for the connected account. Refreshes one at a time and persists the
/// rotated refresh token immediately.
pub async fn access_token(config_dir: &Path, store: &dyn TokenStore) -> Result<String> {
    let _guard = REFRESH_LOCK.lock().await;
    if let Some(t) = cached_token() {
        return Ok(t);
    }
    let cfg = DesktopConfig::load(&config_path(config_dir))?;
    let rt = load(config_dir, store)?.ok_or_else(|| anyhow!(t("No account connected (Settings → Connect account)")))?;
    if is_personal_token(&rt) {
        // Used as the bearer itself: nothing to refresh or rotate.
        return Ok(rt);
    }
    let session = upload::refresh(&cfg, &rt).await?;
    persist(config_dir, store, &session);
    set_cached(Some(session.access_token.clone()));
    Ok(session.access_token)
}

/// "Konto verbinden": password sign-in, then the refresh token goes to the credential store.
pub async fn sign_in(config_dir: &Path, store: &dyn TokenStore, email: &str, password: &str) -> Result<()> {
    let _guard = REFRESH_LOCK.lock().await;
    let cfg = DesktopConfig::load(&config_path(config_dir))?;
    forget_access_token();
    let mut session = upload::sign_in(&cfg, email, password).await?;
    session.email = session.email.or(Some(email.to_string()));
    save(config_dir, store, Some(&session.refresh_token), Some(session.email.clone()))
}

/// "Mit API-Token verbinden": checks the token against `GET /api/ingest` (answers with the token's
/// name), then stores it in place of a refresh token. Returns the label shown as the account.
pub async fn connect_token(config_dir: &Path, store: &dyn TokenStore, token: &str) -> Result<String> {
    let token = token.trim();
    if !is_personal_token(token) {
        anyhow::bail!(t("This is not a Kortex API token (kx_…, Settings → Personal API tokens)"));
    }
    let _guard = REFRESH_LOCK.lock().await;
    let cfg = DesktopConfig::load(&config_path(config_dir))?;
    let name = upload::check_token(&cfg, token).await?;
    forget_access_token();
    let label = tf("API token “{name}”", &[("name", &name)]);
    save(config_dir, store, Some(token), Some(Some(label.clone())))?;
    Ok(label)
}

pub async fn sign_out(config_dir: &Path, store: &dyn TokenStore) -> Result<()> {
    let _guard = REFRESH_LOCK.lock().await;
    forget_access_token();
    save(config_dir, store, None, Some(None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Memory {
        token: Mutex<Option<String>>,
        broken: bool,
    }

    impl TokenStore for Memory {
        fn get(&self) -> Result<Option<String>> {
            if self.broken {
                anyhow::bail!("no credential store");
            }
            Ok(self.token.lock().unwrap().clone())
        }
        fn set(&self, t: &str) -> Result<()> {
            if self.broken {
                anyhow::bail!("no credential store");
            }
            *self.token.lock().unwrap() = Some(t.into());
            Ok(())
        }
        fn delete(&self) -> Result<()> {
            if self.broken {
                anyhow::bail!("no credential store");
            }
            *self.token.lock().unwrap() = None;
            Ok(())
        }
    }

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("kortex-secrets-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn keeps_the_token_out_of_the_file_when_the_store_works() {
        let d = dir("store");
        let store = Memory::default();
        save(&d, &store, Some("rt-1"), Some(Some("a@b.c".into()))).unwrap();
        let file = DesktopConfig::load(&config_path(&d)).unwrap();
        assert_eq!((file.refresh_token, file.email.as_deref()), (None, Some("a@b.c")));
        assert_eq!(load(&d, &store).unwrap().as_deref(), Some("rt-1"));
        // Rotation overwrites, sign-out removes.
        persist(&d, &store, &Session { access_token: "at".into(), refresh_token: "rt-2".into(), email: None });
        assert_eq!(load(&d, &store).unwrap().as_deref(), Some("rt-2"));
        assert_eq!(DesktopConfig::load(&config_path(&d)).unwrap().email.as_deref(), Some("a@b.c"));
        save(&d, &store, None, Some(None)).unwrap();
        assert!(!is_connected(&d, &store));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn recognises_personal_tokens() {
        let ok = format!("kx_{}", "A1b2_-".repeat(8).chars().take(43).collect::<String>());
        assert!(is_personal_token(&ok));
        assert!(!is_personal_token("kx_short"));
        assert!(!is_personal_token(&format!("{ok}x")));
        assert!(!is_personal_token(&format!("kx_{}", "a.b".repeat(15).chars().take(43).collect::<String>())));
        assert!(!is_personal_token("eyJhbGciOi.payload.sig"));
    }

    #[tokio::test]
    async fn a_personal_token_is_its_own_access_token() {
        let d = dir("pat");
        let store = Memory::default();
        let t = format!("kx_{}", "x".repeat(43));
        save(&d, &store, Some(&t), Some(Some("API-Token Desktop".into()))).unwrap();
        assert!(uses_personal_token(&d, &store));
        forget_access_token();
        assert_eq!(access_token(&d, &store).await.unwrap(), t);
        save(&d, &store, Some("rt-1"), None).unwrap();
        assert!(!uses_personal_token(&d, &store));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn falls_back_to_the_file_and_migrates_later() {
        let d = dir("fallback");
        let broken = Memory { broken: true, ..Default::default() };
        save(&d, &broken, Some("rt-file"), None).unwrap();
        assert_eq!(DesktopConfig::load(&config_path(&d)).unwrap().refresh_token.as_deref(), Some("rt-file"));
        assert_eq!(load(&d, &broken).unwrap().as_deref(), Some("rt-file"));
        // Credential store works again: the token moves out of desktop.json.
        let store = Memory::default();
        assert_eq!(load(&d, &store).unwrap().as_deref(), Some("rt-file"));
        assert_eq!(store.token.lock().unwrap().as_deref(), Some("rt-file"));
        assert_eq!(DesktopConfig::load(&config_path(&d)).unwrap().refresh_token, None);
        let _ = std::fs::remove_dir_all(d);
    }

    /// Real Windows Credential Manager round trip (opt-in, touches the user's credential store).
    #[test]
    #[ignore = "uses the real credential store; run with --ignored"]
    fn keyring_round_trip() {
        let e = keyring::Entry::new("io.github.moe-spiration.openkortex.test", "round-trip").unwrap();
        e.set_password("secret-value").unwrap();
        assert_eq!(e.get_password().unwrap(), "secret-value");
        e.delete_credential().unwrap();
        assert!(matches!(e.get_password(), Err(keyring::Error::NoEntry)));
    }
}
