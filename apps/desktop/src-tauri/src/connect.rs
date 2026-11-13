//! `kortex://connect?token=kx_…&web=https://…`: the web app's "Mit Windows-App verbinden" hands a
//! fresh personal API token to the desktop (tauri-plugin-deep-link).
//!
//! Any web page can open a `kortex://` link, so a link never connects by itself: it is parked as
//! pending, the settings window opens and shows "Verbinden mit <web>?", and only the user's click
//! there stores the token (otherwise a foreign page could point the app at someone else's account).

use crate::i18n::{t, tf};
use anyhow::{bail, Context, Result};
use serde::Serialize;

use crate::config::secure_base_url;
use crate::secrets::is_personal_token;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ConnectLink {
    /// Never sent to the frontend (`skip`): the settings window only sees the web origin.
    #[serde(skip)]
    pub token: String,
    /// Web app that issued the token (becomes `webUrl`); None = keep the configured one.
    pub web: Option<String>,
}

/// Parses and checks a deep link. Accepts `kortex://connect?…` and `kortex:connect?…`.
pub fn parse(raw: &str) -> Result<ConnectLink> {
    let url = reqwest::Url::parse(raw.trim()).context(t("invalid link"))?;
    if url.scheme() != "kortex" {
        bail!(t("not a kortex:// link"));
    }
    let target = url.host_str().unwrap_or_else(|| url.path().trim_matches('/'));
    if target != "connect" {
        bail!(tf("unknown link: kortex://{target}", &[("target", &target)]));
    }
    let mut token = None;
    let mut web = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "token" => token = Some(v.trim().to_string()),
            "web" if !v.trim().is_empty() => web = Some(secure_base_url(&v)?),
            _ => {}
        }
    }
    let token = token.filter(|t| is_personal_token(t)).context(t("The link contains no valid Kortex token"))?;
    Ok(ConnectLink { token, web })
}

/// First `kortex://` argument of a process command line (second start, cold start by the link).
pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().find(|a| a.to_ascii_lowercase().starts_with("kortex:"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "kx_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

    #[test]
    fn parses_the_connect_link() {
        assert_eq!(TOKEN.len(), 46);
        let l = parse(&format!("kortex://connect?token={TOKEN}&web=https%3A%2F%2Fkortex.example.com%2F")).unwrap();
        assert_eq!(l.token, TOKEN);
        assert_eq!(l.web.as_deref(), Some("https://kortex.example.com"));
        let l = parse(&format!("kortex://connect/?token={TOKEN}")).unwrap();
        assert_eq!(l.web, None);
        assert!(parse(&format!("kortex://connect?token={TOKEN}&web=http://localhost:3000")).is_ok());
    }

    #[test]
    fn refuses_bad_links() {
        assert!(parse("kortex://connect").is_err());
        assert!(parse("kortex://connect?token=abc").is_err());
        assert!(parse(&format!("kortex://other?token={TOKEN}")).is_err());
        assert!(parse(&format!("https://connect?token={TOKEN}")).is_err());
        // Never a clear-text web URL (the token would travel unencrypted).
        assert!(parse(&format!("kortex://connect?token={TOKEN}&web=http://evil.example")).is_err());
    }

    #[test]
    fn token_stays_out_of_the_frontend_payload() {
        let l = parse(&format!("kortex://connect?token={TOKEN}")).unwrap();
        assert!(!serde_json::to_string(&l).unwrap().contains("kx_"));
    }

    #[test]
    fn finds_the_link_in_the_arguments() {
        let args = vec!["kortex.exe".to_string(), "--tray".into(), format!("kortex://connect?token={TOKEN}")];
        assert!(from_args(args).unwrap().starts_with("kortex://connect"));
        assert_eq!(from_args(vec!["kortex.exe".to_string()]), None);
    }
}
