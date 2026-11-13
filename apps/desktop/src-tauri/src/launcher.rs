//! Alt+Space launcher backend: vault search (`GET /api/search`) and the short copilot answer
//! (`POST /api/chat`, brief) for the overlay, with the connected account's token. The overlay's
//! webview cannot call the web app itself (CSP `connect-src` is local only), so this goes through
//! Rust like every other API call.

use crate::i18n::t;
use std::time::Duration;

use anyhow::{bail, Result};
use serde::Serialize;

use crate::live::Api;
use crate::{secrets, upload};

pub const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
pub const ASK_TIMEOUT: Duration = Duration::from_secs(90);
/// Sources handed to the copilot for a launcher answer.
pub const ASK_MATCH_COUNT: u32 = 6;

/// One cited source of a launcher answer.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AskSource {
    pub n: u32,
    pub item_id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct AskAnswer {
    pub text: String,
    pub model: Option<String>,
    pub sources: Vec<AskSource>,
}

/// Reads an AI SDK UI message stream (SSE, `data: {json}` lines): the answer is the concatenated
/// `text-delta`s, the sources come from `data-citations`. An `error` part fails the whole answer.
pub fn parse_ui_stream(body: &str) -> Result<AskAnswer> {
    let mut out = AskAnswer::default();
    for line in body.lines() {
        let Some(data) = line.strip_prefix("data:") else { continue };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else { continue };
        match v["type"].as_str() {
            Some("text-delta") => out.text.push_str(v["delta"].as_str().unwrap_or_default()),
            Some("data-citations") => {
                out.model = v["data"]["model"].as_str().map(String::from);
                out.sources = v["data"]["citations"]
                    .as_array()
                    .map(|cs| {
                        cs.iter()
                            .filter_map(|c| {
                                Some(AskSource {
                                    n: c["n"].as_u64()? as u32,
                                    item_id: c["item_id"].as_str()?.to_string(),
                                    title: c["title"].as_str().unwrap_or_default().to_string(),
                                    kind: c["type"].as_str().unwrap_or_default().to_string(),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
            }
            Some("error") => bail!("{}", v["errorText"].as_str().unwrap_or(t("The copilot is not reachable right now"))),
            _ => {}
        }
    }
    out.text = out.text.trim().to_string();
    if out.text.is_empty() {
        bail!(t("No answer received"));
    }
    Ok(out)
}

/// Query string pairs for `GET /api/search` (empty values are left out).
pub fn search_params(q: &str, kind: Option<&str>, limit: u32, content: bool) -> Vec<(&'static str, String)> {
    let mut p = vec![("q", q.trim().to_string()), ("limit", limit.clamp(1, 50).to_string())];
    if let Some(k) = kind.map(str::trim).filter(|k| !k.is_empty()) {
        p.push(("type", k.to_string()));
    }
    if content {
        p.push(("content", "1".into()));
    }
    p
}

/// GET with the account's token; one retry with a fresh token after a 401 (like `Api::post`).
pub async fn get_json(api: &Api, path: &str, query: &[(&str, String)], timeout: Duration) -> Result<serde_json::Value> {
    for attempt in 0..2 {
        let token = api.token().await?;
        let res = upload::http_client(timeout)?.get(format!("{}{path}", api.web)).query(query).bearer_auth(&token).send().await?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if status.as_u16() == 401 && attempt == 0 && !secrets::is_personal_token(&token) {
            secrets::forget_access_token();
            continue;
        }
        if !status.is_success() {
            bail!("{} ({status})", upload::api_message(&text));
        }
        return Ok(serde_json::from_str(&text).unwrap_or_default());
    }
    bail!(t("not signed in"))
}

pub async fn search(api: &Api, q: &str, kind: Option<&str>, limit: u32, content: bool) -> Result<serde_json::Value> {
    get_json(api, "/api/search", &search_params(q, kind, limit, content), SEARCH_TIMEOUT).await
}

/// Why "Fragen" is refused for good with this account (an older token without the `ask` scope).
pub fn ask_refusal(status: Option<u16>, personal_token: bool) -> Option<&'static str> {
    match status {
        Some(401 | 403) if personal_token => Some(t(
            "This API token may not ask. In the web app under Settings → Personal API tokens create a new token with “May also search and ask in the vault” and connect it here.",
        )),
        _ => None,
    }
}

/// Short copilot answer over the whole vault (the user's chat_reasoning route, ADR-06).
pub async fn ask(api: &Api, question: &str) -> Result<AskAnswer> {
    let body = serde_json::json!({
        "mode": "brain",
        "brief": true,
        "match_count": ASK_MATCH_COUNT,
        "messages": [{ "role": "user", "content": question.trim() }],
    });
    for attempt in 0..2 {
        let token = api.token().await?;
        let res = upload::http_client(ASK_TIMEOUT)?.post(format!("{}/api/chat", api.web)).bearer_auth(&token).json(&body).send().await?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if status.as_u16() == 401 && attempt == 0 {
            secrets::forget_access_token();
            continue;
        }
        if !status.is_success() {
            return Err(crate::live::HttpError { status: status.as_u16(), message: upload::api_message(&text) }.into());
        }
        return parse_ui_stream(&text);
    }
    bail!(t("not signed in"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const STREAM: &str = "data: {\"type\":\"start\"}\n\n\
data: {\"type\":\"data-citations\",\"data\":{\"mode\":\"brain\",\"model\":\"anthropic:auto\",\"citations\":[{\"n\":1,\"item_id\":\"a1\",\"title\":\"Vault-Sync\",\"type\":\"note\",\"snippet\":\"x\"},{\"n\":2,\"title\":\"ohne id\"}]}}\n\n\
data: {\"type\":\"text-start\",\"id\":\"t\"}\n\n\
data: {\"type\":\"text-delta\",\"id\":\"t\",\"delta\":\"Per SHA-256 \"}\n\n\
data: {\"type\":\"text-delta\",\"id\":\"t\",\"delta\":\"geprüft [1].\"}\n\n\
data: {\"type\":\"finish\"}\n\n\
data: [DONE]\n\n";

    #[test]
    fn explains_a_token_without_the_ask_scope() {
        assert!(ask_refusal(Some(401), true).is_some());
        assert!(ask_refusal(Some(403), true).is_some());
        assert!(ask_refusal(Some(401), false).is_none());
        assert!(ask_refusal(Some(502), true).is_none());
        assert!(ask_refusal(None, true).is_none());
    }

    #[test]
    fn parses_text_and_citations_of_a_ui_stream() {
        let a = parse_ui_stream(STREAM).unwrap();
        assert_eq!(a.text, "Per SHA-256 geprüft [1].");
        assert_eq!(a.model.as_deref(), Some("anthropic:auto"));
        assert_eq!(a.sources, vec![AskSource { n: 1, item_id: "a1".into(), title: "Vault-Sync".into(), kind: "note".into() }]);
    }

    #[test]
    fn stream_errors_and_empty_answers_fail() {
        let err = parse_ui_stream("data: {\"type\":\"error\",\"errorText\":\"Copilot weg\"}\n").unwrap_err();
        assert_eq!(err.to_string(), "Copilot weg");
        assert!(parse_ui_stream("data: {\"type\":\"start\"}\n\ndata: [DONE]\n").is_err());
        assert!(parse_ui_stream("kein sse").is_err());
    }

    #[test]
    fn search_params_skip_empty_values_and_clamp_the_limit() {
        assert_eq!(search_params(" mail ", Some("prompt"), 80, true), vec![("q", "mail".into()), ("limit", "50".into()), ("type", "prompt".into()), ("content", "1".into())]);
        assert_eq!(search_params("", Some(" "), 0, false), vec![("q", String::new()), ("limit", "1".into())]);
        assert_eq!(search_params("x", None, 8, false).len(), 2);
    }
}
