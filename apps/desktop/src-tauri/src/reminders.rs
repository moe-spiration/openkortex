//! Windows notifications for due reminders and radar changes (`GET /api/reminders/due`).
//!
//! Only while Kortex runs (in the tray): one check shortly after the start, then every 15 minutes.
//! Settings → "Erinnerungen als Windows-Benachrichtigung" switches it off (`reminders` in desktop.json).
//! Each item is announced once per `id` + `remind_at` (a snoozed reminder comes back with a new
//! time); the announced keys survive a restart in `notified.json` next to desktop.json.

use crate::i18n::{t, tf};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Result;
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{config, launcher, live, secrets};

pub const INTERVAL: Duration = Duration::from_secs(15 * 60);
const FIRST_CHECK: Duration = Duration::from_secs(20);
const TIMEOUT: Duration = Duration::from_secs(20);
/// More new items than this at once become one summary notification.
const MAX_SINGLE: usize = 3;
/// Keys kept in notified.json (oldest dropped first).
const KEEP: usize = 500;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct DueItem {
    pub id: String,
    pub title: String,
    pub remind_at: String,
    pub kind: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DueResponse {
    #[serde(default)]
    items: Vec<DueItem>,
}

pub fn key(item: &DueItem) -> String {
    format!("{}@{}", item.id, item.remind_at)
}

/// Items not announced yet.
pub fn fresh<'a>(items: &'a [DueItem], seen: &HashSet<String>) -> Vec<&'a DueItem> {
    items.iter().filter(|i| !seen.contains(&key(i))).collect()
}

/// (title, body) of the notifications for `items`: one each, or a summary for many.
pub fn texts(items: &[&DueItem]) -> Vec<(String, String)> {
    let one = |i: &DueItem| {
        let title = if i.kind == "radar" { t("Kortex · Page changed") } else { t("Kortex · Reminder") };
        let body: String = i.title.trim().chars().take(180).collect();
        (title.to_string(), if body.is_empty() { t("Untitled").to_string() } else { body })
    };
    if items.len() <= MAX_SINGLE {
        return items.iter().map(|i| one(i)).collect();
    }
    let names: Vec<String> = items.iter().take(3).map(|i| i.title.trim().chars().take(60).collect()).collect();
    vec![(tf("Kortex · {n} reminders due", &[("n", &items.len())]), format!("{} …", names.join(" · ")))]
}

fn seen_path(config_dir: &Path) -> PathBuf {
    config_dir.join("notified.json")
}

pub fn load_seen(config_dir: &Path) -> Vec<String> {
    std::fs::read_to_string(seen_path(config_dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_seen(config_dir: &Path, mut keys: Vec<String>) -> Result<()> {
    if keys.len() > KEEP {
        keys.drain(..keys.len() - KEEP);
    }
    std::fs::create_dir_all(config_dir)?;
    let path = seen_path(config_dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&keys)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

/// One check: fetch, announce the new items, remember them. Returns how many were new.
pub async fn check_now(app: &AppHandle) -> Result<usize> {
    let dir = app.path().app_config_dir()?;
    let cfg = config::DesktopConfig::load(&config::config_path(&dir))?;
    if !cfg.reminders_enabled() || !secrets::is_connected(&dir, &secrets::default_store()) {
        return Ok(0);
    }
    let api = live::Api::new(&cfg, dir.clone())?;
    let value = launcher::get_json(&api, "/api/reminders/due", &[], TIMEOUT).await?;
    let res: DueResponse = serde_json::from_value(value)?;
    let mut keys = load_seen(&dir);
    let seen: HashSet<String> = keys.iter().cloned().collect();
    let new = fresh(&res.items, &seen);
    for (title, body) in texts(&new) {
        if let Err(e) = app.notification().builder().title(title).body(body).show() {
            log::warn!("notification failed: {e}");
        }
    }
    let n = new.len();
    if n > 0 {
        keys.extend(new.iter().map(|i| key(i)));
        save_seen(&dir, keys)?;
    }
    Ok(n)
}

/// Background loop for the lifetime of the app.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            if let Err(e) = check_now(&app).await {
                log::warn!("reminders: {e:#}");
            }
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, at: &str, kind: &str) -> DueItem {
        DueItem { id: id.into(), title: format!("Titel {id}"), remind_at: at.into(), kind: kind.into(), url: None }
    }

    #[test]
    fn parses_the_endpoint_contract() {
        let v = serde_json::json!({ "items": [
            { "id": "a", "title": "Steuer", "remind_at": "2026-11-03T08:00:00Z", "kind": "reminder" },
            { "id": "radar:b:2026-11-02", "title": "Preisliste", "remind_at": "2026-11-02T10:00:00Z", "kind": "radar", "url": "https://x.example" }
        ]});
        let r: DueResponse = serde_json::from_value(v).unwrap();
        assert_eq!(r.items.len(), 2);
        assert_eq!(r.items[1].url.as_deref(), Some("https://x.example"));
        let empty: DueResponse = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(empty.items.is_empty());
    }

    #[test]
    fn announces_each_item_once_and_again_after_a_snooze() {
        let items = vec![item("a", "t1", "reminder"), item("b", "t1", "radar")];
        let mut seen = HashSet::new();
        assert_eq!(fresh(&items, &seen).len(), 2);
        seen.insert(key(&items[0]));
        assert_eq!(fresh(&items, &seen), vec![&items[1]]);
        let snoozed = vec![item("a", "t2", "reminder")];
        assert_eq!(fresh(&snoozed, &seen).len(), 1);
    }

    #[test]
    fn texts_single_and_summary() {
        let a = item("a", "t", "reminder");
        let b = item("b", "t", "radar");
        let t = texts(&[&a, &b]);
        assert_eq!(t[0].0, "Kortex · Erinnerung");
        assert_eq!(t[1].0, "Kortex · Seite geändert");
        assert_eq!(t[1].1, "Titel b");
        let many: Vec<DueItem> = (0..5).map(|i| item(&i.to_string(), "t", "reminder")).collect();
        let refs: Vec<&DueItem> = many.iter().collect();
        let t = texts(&refs);
        assert_eq!(t.len(), 1);
        assert!(t[0].0.contains("5 Erinnerungen"));
    }

    #[test]
    fn seen_keys_survive_and_stay_bounded() {
        let dir = std::env::temp_dir().join(format!("kortex-seen-{}", std::process::id()));
        assert!(load_seen(&dir).is_empty());
        let keys: Vec<String> = (0..KEEP + 10).map(|i| format!("k{i}")).collect();
        save_seen(&dir, keys).unwrap();
        let back = load_seen(&dir);
        assert_eq!(back.len(), KEEP);
        assert_eq!(back.last().map(String::as_str), Some(format!("k{}", KEEP + 9).as_str()));
        let _ = std::fs::remove_dir_all(dir);
    }
}
