//! Record-then-upload (no Deepgram key needed): after "Aufnahme beenden" the 16 kHz stereo WAV is
//! transcribed per channel in 30 s chunks through the web app's `/api/chat/transcribe` (the user's
//! ADR-06 `audio_transcription` route, e.g. Eden AI) and the transcript is ingested as a meeting via
//! `/api/ingest` (`kind: "note"`, `type_hint: "meeting"`, lines `[hh:mm:ss] Ich: …`), which the
//! meeting adapter turns into the protocol in `20_Meetings/…` with action items.
//!
//! Voice notes (Strg+Umschalt+Leertaste) take the same path, microphone only, and land as a note
//! (`type_hint: "voice"`) in the inbox.
//!
//! Auth: the desktop signs in to Supabase once ("Konto verbinden", email + password) or uses a
//! personal API token (`kx_…`); `secrets.rs` hands out the bearer for both.

use crate::i18n::{t, tf};
use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::config::DesktopConfig;
use crate::dsp;
use crate::wav::{self, Wav};

/// Chunk length for transcription (seconds). Short enough for timestamps, long enough to keep
/// requests (and provider minimums) reasonable.
pub const CHUNK_SECS: u32 = 30;
/// Chunks quieter than this are skipped (no paid transcription of silence).
pub const SILENCE_DB: i32 = -50;

pub const CHANNEL_NAMES: [&str; 2] = ["Ich", "Gesprächspartner"];

#[derive(Clone, Debug, PartialEq)]
pub struct Chunk {
    pub channel: usize,
    pub start_sample: usize,
    pub end_sample: usize,
}

impl Chunk {
    pub fn start_sec(&self, rate: u32) -> f64 {
        self.start_sample as f64 / rate as f64
    }
}

/// Every request has a connect timeout; the whole request is bounded per call site (review N5 #6).
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const API_TIMEOUT: Duration = Duration::from_secs(30);
/// One 30 s chunk through a paid transcriber can take a while.
pub const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(180);

/// Every request names the app's language (`X-Kortex-Locale`), so texts and errors the web server
/// generates come back in it (apps/web/src/i18n/server.ts).
pub fn http_client(request_timeout: Duration) -> Result<reqwest::Client> {
    let mut headers = reqwest::header::HeaderMap::new();
    let code = reqwest::header::HeaderValue::from_static(crate::i18n::locale().code());
    // Accept-Language as well: it needs no CORS allowance and older servers read it.
    headers.insert(reqwest::header::ACCEPT_LANGUAGE, code.clone());
    headers.insert("x-kortex-locale", code);
    Ok(reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT).timeout(request_timeout).default_headers(headers).build()?)
}

/// Non-silent chunks of both channels, ordered by time then channel.
pub fn plan_chunks(w: &Wav, chunk_secs: u32) -> Vec<Chunk> {
    // A malformed header must not loop forever (rate 0) or overflow (review N5 #4).
    let Some(step) = (w.rate as usize).checked_mul(chunk_secs as usize).filter(|s| *s > 0) else {
        return Vec::new();
    };
    if w.channels == 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for ch in 0..(w.channels as usize).min(2) {
        let data = w.channel(ch);
        let mut start = 0;
        while start < data.len() {
            let end = (start + step).min(data.len());
            let block: Vec<f32> = data[start..end].iter().map(|&s| s as f32 / i16::MAX as f32).collect();
            // Very short tails (< 1 s) are not worth a request.
            if end - start >= w.rate as usize && dsp::level(&block).db > SILENCE_DB {
                out.push(Chunk { channel: ch, start_sample: start, end_sample: end });
            }
            start = end;
        }
    }
    out.sort_by_key(|c| (c.start_sample, c.channel));
    out
}

pub fn hhmmss(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    format!("{:02}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Segment {
    pub channel: usize,
    pub start_sec: f64,
    pub text: String,
}

/// Transcript in the meeting adapter's plain-text format: `[hh:mm:ss] Name: text`.
pub fn transcript_text(segments: &[Segment]) -> String {
    segments
        .iter()
        .filter(|s| !s.text.trim().is_empty())
        .map(|s| format!("[{}] {}: {}", hhmmss(s.start_sec), CHANNEL_NAMES.get(s.channel).copied().unwrap_or("Kanal"), s.text.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

// --- Supabase auth ----------------------------------------------------------------------------------

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    user: Option<TokenUser>,
}

#[derive(Deserialize)]
struct TokenUser {
    #[serde(default)]
    email: Option<String>,
}

pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub email: Option<String>,
}

async fn token(cfg: &DesktopConfig, grant: &str, body: serde_json::Value) -> Result<Session> {
    let key = cfg.anon_key().ok_or_else(|| anyhow!(t("Supabase anon key is missing (supabaseAnonKey in desktop.json)")))?;
    let res = http_client(API_TIMEOUT)?
        .post(format!("{}/auth/v1/token?grant_type={grant}", cfg.supabase_url()?))
        .header("apikey", key)
        .json(&body)
        .send()
        .await
        .context(t("Supabase not reachable"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        bail!(tf("Sign-in failed ({status}): {message}", &[("status", &status), ("message", &text.chars().take(200).collect::<String>())]));
    }
    let t: TokenResponse = res.json().await?;
    Ok(Session { access_token: t.access_token, refresh_token: t.refresh_token, email: t.user.and_then(|u| u.email) })
}

pub async fn sign_in(cfg: &DesktopConfig, email: &str, password: &str) -> Result<Session> {
    token(cfg, "password", serde_json::json!({ "email": email, "password": password })).await
}

/// Exchanges a refresh token (Supabase rotates it: persist the returned one, see `secrets.rs`).
pub async fn refresh(cfg: &DesktopConfig, refresh_token: &str) -> Result<Session> {
    token(cfg, "refresh_token", serde_json::json!({ "refresh_token": refresh_token })).await
}

// --- web API ----------------------------------------------------------------------------------------

#[derive(Deserialize)]
struct TranscribeResponse {
    text: String,
    /// "provider:model" of the user's audio_transcription route (e.g. "edenai:deepgram").
    #[serde(default)]
    model: Option<String>,
    /// Only with `segments=1`: timed lines with the diarization label.
    #[serde(default)]
    segments: Vec<TimedText>,
}

/// One timed line of a transcribed chunk (seconds from the chunk start); `speaker` is the
/// diarization label of the transcriber ("Sprecher 1"), if it has one.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct TimedText {
    pub start_sec: f64,
    #[serde(default)]
    pub end_sec: Option<f64>,
    pub text: String,
    #[serde(default)]
    pub speaker: Option<String>,
}

/// One transcribed chunk: text (empty = nothing understood) and the transcriber id.
pub struct ChunkText {
    pub text: String,
    pub model: Option<String>,
    /// Filled only when the request asked for segments.
    pub segments: Vec<TimedText>,
}

/// Waits before retry `attempt` (0-based) of a chunk: rate limit (429) and passing provider or
/// network trouble (5xx, timeouts) are tried again instead of losing the chunk (device test 0.6.2).
pub fn chunk_retry_wait(attempt: u32, status: Option<u16>, retry_after: Option<u64>) -> Option<Duration> {
    const STEPS: [u64; 3] = [2, 5, 12];
    let retryable = match status {
        None => true,
        Some(s) => s == 429 || s == 408 || s >= 500,
    };
    if !retryable {
        return None;
    }
    let base = *STEPS.get(attempt as usize)?;
    Some(Duration::from_secs(retry_after.map(|r| r.clamp(1, 30)).unwrap_or(base).max(base)))
}

/// A mono WAV chunk through `/api/chat/transcribe` (the user's ADR-06 audio_transcription route).
/// `segments` asks for timed lines with speaker labels (meeting pass). Retries per `chunk_retry_wait`.
pub async fn transcribe_chunk(client: &reqwest::Client, web: &str, token: &str, bytes: Vec<u8>, name: String, segments: bool) -> Result<ChunkText> {
    let mut attempt = 0;
    loop {
        let part = reqwest::multipart::Part::bytes(bytes.clone()).file_name(name.clone()).mime_str("audio/wav")?;
        let mut form = reqwest::multipart::Form::new().part("audio", part).text("language", "de");
        if segments {
            form = form.text("segments", "1");
        }
        let (status, retry_after, err) = match client.post(format!("{web}/api/chat/transcribe")).bearer_auth(token).multipart(form).send().await {
            Err(e) => (None, None, anyhow!(tf("Transcription not reachable: {error}", &[("error", &e)]))),
            Ok(res) => {
                let status = res.status();
                if status.as_u16() == 422 {
                    // "Nichts verstanden": an empty chunk is not an error for a meeting.
                    return Ok(ChunkText { text: String::new(), model: None, segments: Vec::new() });
                }
                if status.is_success() {
                    let r = res.json::<TranscribeResponse>().await?;
                    return Ok(ChunkText { text: r.text, model: r.model, segments: r.segments });
                }
                let retry_after = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
                let msg = api_message(&res.text().await.unwrap_or_default());
                (Some(status.as_u16()), retry_after, anyhow!(tf("Transcription failed ({status}): {message}", &[("status", &status), ("message", &msg)])))
            }
        };
        let Some(wait) = chunk_retry_wait(attempt, status, retry_after) else { return Err(err) };
        log::warn!("{name}: {err:#}, retry in {wait:?}");
        attempt += 1;
        tokio::time::sleep(wait).await;
    }
}

/// `{ ok: false, error: { message } }` → the message, else the first 300 characters of the body.
pub fn api_message(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(String::from))
        .unwrap_or_else(|| body.chars().take(300).collect())
}

/// Transcribes a finished recording per channel in 30 s chunks (silent chunks skipped).
pub async fn transcribe_wav(cfg: &DesktopConfig, access_token: &str, wav_path: &Path) -> Result<(Vec<Segment>, usize)> {
    let web = cfg.web_url()?;
    let w = wav::read(wav_path)?;
    let chunks = plan_chunks(&w, CHUNK_SECS);
    let client = http_client(TRANSCRIBE_TIMEOUT)?;
    let mut segments = Vec::new();
    for (i, c) in chunks.iter().enumerate() {
        let bytes = wav::mono_bytes(&w, c.channel, c.start_sample, c.end_sample);
        let t = transcribe_chunk(&client, &web, access_token, bytes, format!("meeting-{i:03}-ch{}.wav", c.channel), false).await?;
        if !t.text.trim().is_empty() {
            segments.push(Segment { channel: c.channel, start_sec: c.start_sec(w.rate), text: t.text });
        }
    }
    Ok((segments, chunks.len()))
}

/// "Voice note 0:12" / "Sprachnotiz 0:12" (minutes:seconds), the title the web footbar uses too.
pub fn voice_title(seconds: f64) -> String {
    let s = seconds.max(1.0).round() as u64;
    tf("Voice note {time}", &[("time", &format!("{}:{:02}", s / 60, s % 60))])
}

/// The voice note text: the microphone segments in time order, joined into one paragraph.
pub fn voice_text(segments: &[Segment]) -> String {
    let mut mic: Vec<&Segment> = segments.iter().filter(|s| s.channel == 0).collect();
    mic.sort_by(|a, b| a.start_sec.total_cmp(&b.start_sec));
    mic.iter().map(|s| s.text.trim()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" ")
}

pub fn voice_body(text: &str, seconds: f64, captured_at: &str) -> serde_json::Value {
    serde_json::json!({
        "kind": "note",
        "type_hint": "voice",
        "title": voice_title(seconds),
        "content_md": text,
        "captured_at": captured_at,
        "client": { "name": "kortex-desktop", "version": env!("CARGO_PKG_VERSION") },
    })
}

/// Transcribes a voice note (microphone channel) and captures it as a note in the inbox.
pub async fn upload_voice_note(cfg: &DesktopConfig, access_token: &str, wav_path: &Path, seconds: f64, captured_at: &str) -> Result<IngestOutcome> {
    let web = cfg.web_url()?;
    let (segments, _) = transcribe_wav(cfg, access_token, wav_path).await?;
    let text = voice_text(&segments);
    if text.is_empty() {
        bail!(t("Nothing understood: the voice note contains no speech"));
    }
    ingest(&web, access_token, &voice_body(&text, seconds, captured_at)).await
}

async fn ingest(web: &str, access_token: &str, body: &serde_json::Value) -> Result<IngestOutcome> {
    let res = http_client(API_TIMEOUT)?.post(format!("{web}/api/ingest")).bearer_auth(access_token).json(body).send().await?;
    let status = res.status();
    if !status.is_success() {
        bail!(tf("Ingest failed ({status}): {message}", &[("status", &status), ("message", &api_message(&res.text().await.unwrap_or_default()))]));
    }
    Ok(res.json().await?)
}

/// `GET /api/ingest` with a personal token: the token's name, or why it is refused.
pub async fn check_token(cfg: &DesktopConfig, token: &str) -> Result<String> {
    let web = cfg.web_url()?;
    let res = http_client(API_TIMEOUT)?.get(format!("{web}/api/ingest")).bearer_auth(token).send().await?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!(tf("API token refused ({status}): {message}", &[("status", &status), ("message", &api_message(&body))]));
    }
    let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    Ok(v["token_name"].as_str().unwrap_or("Desktop").to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IngestOutcome {
    pub item_id: String,
    #[serde(default)]
    pub folder_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct UploadResult {
    pub item_id: String,
    pub folder_path: Option<String>,
    pub segments: usize,
    pub chunks: usize,
}

/// Transcribes the recording and ingests it as a meeting with the given access token.
pub async fn upload_meeting(cfg: &DesktopConfig, access_token: &str, wav_path: &Path, title: &str, started_at: &str) -> Result<UploadResult> {
    let web = cfg.web_url()?;
    // Same final pass as the live meeting: long windows with speakers (meeting_pass.rs), instead of
    // 30 s chunks that ran into the rate limit and knew only "Gesprächspartner".
    let pass = crate::meeting_pass::run(&web, access_token, wav_path, &[]).await?;
    if pass.lines == 0 {
        bail!(t("Nothing understood: the recording contains no speech"));
    }
    let body = serde_json::json!({
        "kind": "note",
        "type_hint": "meeting",
        "title": title,
        "content_md": pass.transcript,
        "captured_at": started_at,
        "client": { "name": "kortex-desktop", "version": env!("CARGO_PKG_VERSION") },
    });
    let out = ingest(&web, access_token, &body).await?;
    Ok(UploadResult { item_id: out.item_id, folder_path: out.folder_path, segments: pass.lines, chunks: pass.windows })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_with(ch0: Vec<i16>, ch1: Vec<i16>) -> Wav {
        let samples = ch0.iter().zip(ch1.iter()).flat_map(|(&a, &b)| [a, b]).collect();
        Wav { channels: 2, rate: 16_000, samples }
    }

    fn tone(n: usize) -> Vec<i16> {
        (0..n).map(|i| ((i as f32 * 0.17).sin() * 8000.0) as i16).collect()
    }

    #[test]
    fn plans_only_non_silent_chunks_in_time_order() {
        let rate = 16_000usize;
        // ch0: 70 s speech; ch1: silent 0-30 s, speech 30-60 s, silent tail.
        let ch0 = tone(70 * rate);
        let mut ch1 = vec![0i16; 30 * rate];
        ch1.extend(tone(30 * rate));
        ch1.extend(vec![0i16; 10 * rate]);
        let plan = plan_chunks(&wav_with(ch0, ch1), 30);
        let got: Vec<(usize, u32)> = plan.iter().map(|c| (c.channel, c.start_sec(16_000) as u32)).collect();
        assert_eq!(got, vec![(0, 0), (0, 30), (1, 30), (0, 60)]);
    }

    #[test]
    fn retries_rate_limits_and_outages_but_not_refusals() {
        assert_eq!(chunk_retry_wait(0, Some(429), None), Some(Duration::from_secs(2)));
        // Retry-After wins when it asks for longer (capped at 30 s).
        assert_eq!(chunk_retry_wait(0, Some(429), Some(20)), Some(Duration::from_secs(20)));
        assert_eq!(chunk_retry_wait(1, Some(429), Some(600)), Some(Duration::from_secs(30)));
        assert_eq!(chunk_retry_wait(1, Some(502), None), Some(Duration::from_secs(5)));
        assert_eq!(chunk_retry_wait(2, None, None), Some(Duration::from_secs(12)));
        assert_eq!(chunk_retry_wait(3, Some(503), None), None);
        // Bad request, no credits, not allowed: trying again changes nothing.
        assert_eq!(chunk_retry_wait(0, Some(400), None), None);
        assert_eq!(chunk_retry_wait(0, Some(402), None), None);
        assert_eq!(chunk_retry_wait(0, Some(401), None), None);
    }

    #[test]
    fn reads_timed_segments_with_speakers() {
        let r: TranscribeResponse = serde_json::from_str(r#"{"ok":true,"text":"a b","model":"edenai:deepgram","segments":[{"start_sec":0,"end_sec":1.5,"text":"a","speaker":"Sprecher 1"},{"start_sec":2,"end_sec":null,"text":"b","speaker":null}]}"#).unwrap();
        assert_eq!(r.segments.len(), 2);
        assert_eq!(r.segments[0].speaker.as_deref(), Some("Sprecher 1"));
        assert_eq!(r.segments[1].end_sec, None);
        // Older web app (no segments field): still fine.
        let old: TranscribeResponse = serde_json::from_str(r#"{"ok":true,"text":"a","model":null}"#).unwrap();
        assert!(old.segments.is_empty());
    }

    #[test]
    fn plans_nothing_for_broken_headers() {
        assert!(plan_chunks(&Wav { channels: 2, rate: 0, samples: vec![1; 64] }, 30).is_empty());
        assert!(plan_chunks(&Wav { channels: 0, rate: 16_000, samples: vec![1; 64] }, 30).is_empty());
        assert!(plan_chunks(&Wav { channels: 1, rate: u32::MAX, samples: vec![1; 64] }, u32::MAX).len() <= 1);
    }

    #[test]
    fn skips_sub_second_tails() {
        let plan = plan_chunks(&wav_with(tone(16_000 * 30 + 4000), vec![0; 16_000 * 30 + 4000]), 30);
        assert_eq!(plan.len(), 1);
    }

    #[test]
    fn builds_the_voice_note_from_the_microphone_only() {
        let seg = |channel, start_sec, text: &str| Segment { channel, start_sec, text: text.into() };
        let segs = vec![seg(0, 30.0, " und Brot. "), seg(1, 0.0, "Fernseher"), seg(0, 0.0, "Milch kaufen"), seg(0, 10.0, "  ")];
        assert_eq!(voice_text(&segs), "Milch kaufen und Brot.");
        assert_eq!(voice_title(12.4), "Sprachnotiz 0:12");
        assert_eq!(voice_title(75.0), "Sprachnotiz 1:15");
        assert_eq!(voice_title(0.2), "Sprachnotiz 0:01");
        let b = voice_body("Milch kaufen", 12.0, "2026-10-31T10:00:00+01:00");
        assert_eq!((b["kind"].as_str(), b["type_hint"].as_str(), b["title"].as_str()), (Some("note"), Some("voice"), Some("Sprachnotiz 0:12")));
        assert_eq!(b["content_md"], "Milch kaufen");
    }

    #[test]
    fn formats_the_meeting_transcript_lines() {
        let text = transcript_text(&[
            Segment { channel: 0, start_sec: 0.0, text: " Hallo zusammen ".into() },
            Segment { channel: 1, start_sec: 75.4, text: "Hi!".into() },
            Segment { channel: 1, start_sec: 80.0, text: "  ".into() },
        ]);
        assert_eq!(text, "[00:00:00] Ich: Hallo zusammen\n[00:01:15] Gesprächspartner: Hi!");
        assert_eq!(hhmmss(3725.0), "01:02:05");
    }
}
