//! Live meeting (H1/W1, docs/plans/2026-10-30-meeting-capture.md).
//!
//! While a meeting is recorded with a connected account:
//! - the session is opened in the web app (`POST /api/meeting/live {start}`), which creates the
//!   meeting item the web card, md-sync and later the protocol use;
//! - the 2-channel 16 kHz frames are cut into 10-20 s chunks at a real pause (`Cutter`, 300 ms
//!   quiet) and every channel with speech goes through `/api/chat/transcribe`, the user's ADR-06
//!   `audio_transcription` route (e.g. Eden AI), up to `LIVE_PARALLEL` chunks at a time, both
//!   channels together, with retries. A microphone line that only repeats the loudspeaker is
//!   dropped (`meeting_pass::is_echo`). Deepgram is only an optional override (deepgram.rs);
//! - final lines become `transcript:final` events and are appended to the session;
//! - every 45 s with new text (or on demand) `POST /api/meeting/coach` returns up to 3 coaching
//!   cards from the user's `meeting_coach` route (`coaching:cards`);
//! - "Call beenden" flushes the rest, runs the final pass with speakers over the WAV
//!   (meeting_pass.rs) and ends the session with that transcript; the web app runs the meeting
//!   adapter (protocol, action items). If the pass fails, the live transcript is used.

use crate::i18n::t;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Notify};

use crate::config::DesktopConfig;
use crate::dsp;
use crate::upload::{self, Segment, CHANNEL_NAMES, SILENCE_DB};
use crate::{secrets, wav};

pub const RATE: u32 = 16_000;
/// A chunk is cut at the first pause after this many seconds …
pub const MIN_CHUNK_SECS: usize = 10;
/// … or here at the latest (then at the quietest moment of its last `LOOKBACK_SECS`).
pub const MAX_CHUNK_SECS: usize = 20;
/// Both channels below this level for one frame (100 ms) count as quiet …
pub const PAUSE_DB: i32 = -42;
/// … and a pause is this many quiet frames in a row. One quiet frame happens between two words,
/// so cutting there split words and sentences (device test 0.6.2, "Qualität nicht gut").
pub const PAUSE_FRAMES: usize = 3;
pub const LOOKBACK_SECS: usize = 4;
pub const COACH_EVERY: Duration = Duration::from_secs(45);
/// Chunks transcribed at the same time: a slow provider job no longer holds up the next chunk,
/// so the transcript does not fall further behind during the meeting.
pub const LIVE_PARALLEL: usize = 3;

// --- chunking (pure) -------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub struct LiveChunk {
    pub start_sec: f64,
    /// Mono samples per channel: 0 = microphone, 1 = system audio.
    pub ch: [Vec<i16>; 2],
}

/// Collects interleaved stereo frames and cuts chunks at a pause.
#[derive(Default)]
pub struct Cutter {
    bufs: [Vec<i16>; 2],
    /// Samples per channel before the current buffer (recording time of its start).
    offset: usize,
    /// Quiet frames in a row at the end of the buffer.
    quiet: usize,
}

fn level_db(s: &[i16]) -> i32 {
    let f: Vec<f32> = s.iter().map(|&x| x as f32 / i16::MAX as f32).collect();
    dsp::level(&f).db
}

/// At least 1 s and louder than the silence floor: worth a paid transcription.
pub fn speaks(s: &[i16]) -> bool {
    s.len() >= RATE as usize && level_db(s) > SILENCE_DB
}

impl Cutter {
    /// A cutter whose first sample is `samples` (per channel) into the recording, e.g. after the
    /// Deepgram override handed over mid-meeting.
    pub fn starting_at(samples: usize) -> Self {
        Self { offset: samples, ..Default::default() }
    }

    pub fn push(&mut self, interleaved: &[i16]) -> Option<LiveChunk> {
        let before = self.bufs[0].len();
        for pair in interleaved.chunks_exact(2) {
            self.bufs[0].push(pair[0]);
            self.bufs[1].push(pair[1]);
        }
        let len = self.bufs[0].len();
        if len > before {
            let quiet = (0..2).all(|c| level_db(&self.bufs[c][before..]) < PAUSE_DB);
            self.quiet = if quiet { self.quiet + 1 } else { 0 };
        }
        if len >= MAX_CHUNK_SECS * RATE as usize {
            let at = self.quietest_cut();
            return Some(self.take(at));
        }
        if len >= MIN_CHUNK_SECS * RATE as usize && self.quiet >= PAUSE_FRAMES {
            return Some(self.take(len));
        }
        None
    }

    /// End of the quietest 100 ms frame in the last `LOOKBACK_SECS` (the latest one on a tie, so
    /// steady sound is cut at the maximum as before).
    fn quietest_cut(&self) -> usize {
        let len = self.bufs[0].len();
        let frame = dsp::FRAME_SAMPLES;
        let from = len.saturating_sub(LOOKBACK_SECS * RATE as usize).max(frame);
        let mut best = (i32::MAX, len);
        let mut end = len;
        while end >= from + frame {
            let db = (0..2).map(|c| level_db(&self.bufs[c][end - frame..end])).max().unwrap_or(-60);
            if db < best.0 {
                best = (db, end);
            }
            end -= frame;
        }
        best.1
    }

    /// The rest after the recording stopped (if at least 1 s).
    pub fn flush(&mut self) -> Option<LiveChunk> {
        let len = self.bufs[0].len();
        (len >= RATE as usize).then(|| self.take(len))
    }

    fn take(&mut self, at: usize) -> LiveChunk {
        let start_sec = self.offset as f64 / RATE as f64;
        let at = at.min(self.bufs[0].len());
        self.offset += at;
        self.quiet = 0;
        let rest = [self.bufs[0].split_off(at), self.bufs[1].split_off(at)];
        let ch = std::mem::replace(&mut self.bufs, rest);
        LiveChunk { start_sec, ch }
    }
}

/// `mm:ss`, `h:mm:ss` from one hour on (HUD clock and transcript times).
pub fn clock(sec: f64) -> String {
    let s = sec.max(0.0) as u64;
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
    } else {
        format!("{:02}:{:02}", s / 60, s % 60)
    }
}

// --- coaching cards --------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Card {
    /// "fact" | "question" | "action"
    pub kind: String,
    pub text: String,
    /// Short headline ("Jetzt guter Moment"), when the coach gives one (0.6.8, optional: older web
    /// apps send none and the HUD names the card by its kind).
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient")]
    pub title: Option<String>,
    /// The object file the card draws on ("Akte Jonas"), when the coach names one.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "lenient")]
    pub object: Option<CardObject>,
}

/// A knowledge item a coaching card refers to (a domain object such as a person).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CardObject {
    pub id: String,
    pub title: String,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// An optional field that is dropped instead of failing the whole answer when its shape is wrong
/// (the cards must still show when a newer web app sends something this core does not know).
fn lenient<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let v = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(v).ok())
}

#[derive(Deserialize)]
struct CoachResponse {
    #[serde(default)]
    cards: Vec<Card>,
}

pub fn parse_cards(v: &serde_json::Value) -> Vec<Card> {
    serde_json::from_value::<CoachResponse>(v.clone())
        .map(|r| r.cards.into_iter().filter(|c| !c.text.trim().is_empty()).take(3).collect())
        .unwrap_or_default()
}

// --- web API ---------------------------------------------------------------------------------

/// A refused API call; `status` lets callers tell "not allowed" from "try again".
#[derive(Debug)]
pub struct HttpError {
    pub status: u16,
    pub message: String,
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.status)
    }
}

impl std::error::Error for HttpError {}

pub fn http_status(e: &anyhow::Error) -> Option<u16> {
    e.downcast_ref::<HttpError>().map(|h| h.status)
}

/// Why coaching cannot run at all with this account, or None when a later try may work.
/// Coaching reads the vault, so a personal token needs the search scope as well.
pub fn coach_refusal(status: Option<u16>, personal_token: bool) -> Option<&'static str> {
    match status {
        Some(401 | 403) if personal_token => Some(t(
            "Live coaching needs an API token with “May also search and ask in the vault” (web app → Settings → Personal API tokens). Transcript and minutes continue.",
        )),
        _ => None,
    }
}

#[derive(Clone)]
pub struct Api {
    pub web: String,
    pub config_dir: PathBuf,
    /// Connected with a personal API token (`kx_…`) instead of the Supabase sign-in.
    pub personal_token: bool,
    /// Fixed bearer token instead of the Credential Manager (self-test stub API only).
    pub token_override: Option<String>,
}

impl Api {
    pub fn new(cfg: &DesktopConfig, config_dir: PathBuf) -> Result<Self> {
        let personal_token = secrets::uses_personal_token(&config_dir, &secrets::default_store());
        Ok(Self { web: cfg.web_url()?, config_dir, personal_token, token_override: None })
    }

    pub async fn token(&self) -> Result<String> {
        if let Some(t) = &self.token_override {
            return Ok(t.clone());
        }
        secrets::access_token(&self.config_dir, &secrets::default_store()).await
    }

    /// POST JSON with the account's token; one retry with a fresh token after a 401.
    pub async fn post(&self, path: &str, body: &serde_json::Value, timeout: Duration) -> Result<serde_json::Value> {
        for attempt in 0..2 {
            let token = self.token().await?;
            let res = upload::http_client(timeout)?.post(format!("{}{path}", self.web)).bearer_auth(&token).json(body).send().await?;
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            if status.as_u16() == 401 && attempt == 0 {
                secrets::forget_access_token();
                continue;
            }
            if !status.is_success() {
                return Err(HttpError { status: status.as_u16(), message: upload::api_message(&text) }.into());
            }
            return Ok(serde_json::from_str(&text).unwrap_or_default());
        }
        bail!(t("not signed in"))
    }
}

// --- session ---------------------------------------------------------------------------------

pub struct Session {
    pub started: Instant,
    pub started_at: String,
    pub title: String,
    item_id: Mutex<Option<String>>,
    segments: Mutex<Vec<Segment>>,
    /// Segments already appended in the web app.
    sent: AtomicUsize,
    coached: AtomicUsize,
    transcriber: Mutex<Option<String>>,
    force_coach: AtomicBool,
    /// Set when coaching cannot work with this account (token without the search scope).
    coach_blocked: Mutex<Option<String>>,
    wake_coach: Notify,
    ended: AtomicBool,
    send_lock: tokio::sync::Mutex<()>,
    /// Live transcription task; `finish` waits for it.
    pub worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Session {
    pub fn new(title: String, started_at: String) -> Arc<Self> {
        Arc::new(Self {
            started: Instant::now(),
            started_at,
            title,
            item_id: Mutex::new(None),
            segments: Mutex::new(Vec::new()),
            sent: AtomicUsize::new(0),
            coached: AtomicUsize::new(0),
            transcriber: Mutex::new(None),
            force_coach: AtomicBool::new(false),
            coach_blocked: Mutex::new(None),
            wake_coach: Notify::new(),
            ended: AtomicBool::new(false),
            send_lock: tokio::sync::Mutex::new(()),
            worker: Mutex::new(None),
        })
    }

    pub fn item_id(&self) -> Option<String> {
        self.item_id.lock().unwrap().clone()
    }

    pub fn elapsed_secs(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }

    pub fn transcriber(&self) -> Option<String> {
        self.transcriber.lock().unwrap().clone()
    }

    pub fn set_transcriber(&self, t: &str) {
        *self.transcriber.lock().unwrap() = Some(t.to_string());
    }

    pub fn segment_count(&self) -> usize {
        self.segments.lock().unwrap().len()
    }

    /// Adds a final line and returns the transcript event payload.
    pub fn push(&self, seg: Segment) -> serde_json::Value {
        let ev = serde_json::json!({
            "channel": seg.channel,
            "speaker": CHANNEL_NAMES.get(seg.channel).copied().unwrap_or("Kanal"),
            "ts": clock(seg.start_sec),
            "text": seg.text.trim(),
        });
        self.segments.lock().unwrap().push(seg);
        ev
    }

    /// Requests a coaching run now (HUD "Aktualisieren"); Err when coaching is off for this meeting.
    pub fn coach_now(&self) -> std::result::Result<(), String> {
        if let Some(why) = self.coach_blocked.lock().unwrap().clone() {
            return Err(why);
        }
        self.force_coach.store(true, Ordering::SeqCst);
        self.wake_coach.notify_one();
        Ok(())
    }

    fn block_coaching(&self, why: &str) {
        *self.coach_blocked.lock().unwrap() = Some(why.to_string());
    }

    pub fn is_ended(&self) -> bool {
        self.ended.load(Ordering::SeqCst)
    }
}

fn emit_live(app: &AppHandle, state: &str, s: &Session, message: Option<String>) {
    let _ = app.emit(
        "meeting:live",
        serde_json::json!({ "state": state, "item_id": s.item_id(), "title": s.title, "transcriber": s.transcriber(), "message": message }),
    );
}

/// Opens the session in the web app; until it answers, lines wait in `segments`.
pub async fn open(app: AppHandle, s: Arc<Session>, api: Api, transcriber: Option<String>) {
    emit_live(&app, "connecting", &s, None);
    let body = serde_json::json!({
        "action": "start",
        "title": s.title,
        "started_at": s.started_at,
        "transcriber": transcriber,
        "client": { "name": "kortex-desktop", "version": env!("CARGO_PKG_VERSION") },
    });
    match api.post("/api/meeting/live", &body, upload::API_TIMEOUT).await {
        Ok(v) => match v["item_id"].as_str() {
            Some(id) => {
                *s.item_id.lock().unwrap() = Some(id.to_string());
                emit_live(&app, "live", &s, None);
                if let Err(e) = flush(&s, &api).await {
                    log::warn!("live append failed: {e:#}");
                }
            }
            None => emit_live(&app, "offline", &s, Some(t("Response without item_id").into())),
        },
        Err(e) => {
            log::error!("live session start failed: {e:#}");
            emit_live(&app, "offline", &s, Some(format!("{e:#}")));
        }
    }
}

/// Appends lines the web app has not seen yet (one request at a time, in order).
pub async fn flush(s: &Session, api: &Api) -> Result<()> {
    let _guard = s.send_lock.lock().await;
    let Some(id) = s.item_id() else { return Ok(()) };
    let (from, batch): (usize, Vec<Segment>) = {
        let all = s.segments.lock().unwrap();
        let from = s.sent.load(Ordering::SeqCst).min(all.len());
        (from, all[from..].to_vec())
    };
    if batch.is_empty() {
        return Ok(());
    }
    let body = serde_json::json!({ "action": "append", "item_id": id, "segments": batch, "transcriber": s.transcriber() });
    api.post("/api/meeting/live", &body, upload::API_TIMEOUT).await?;
    s.sent.store(from + batch.len(), Ordering::SeqCst);
    Ok(())
}

/// What the transcriber returned for one chunk (both channels, transcribed at the same time).
struct ChunkResult {
    n: usize,
    start_sec: f64,
    texts: [Option<String>; 2],
    model: Option<String>,
    error: Option<String>,
}

async fn transcribe_chunk_texts(api: &Api, client: &reqwest::Client, chunk: LiveChunk, n: usize) -> ChunkResult {
    let mut out = ChunkResult { n, start_sec: chunk.start_sec, texts: [None, None], model: None, error: None };
    let token = match api.token().await {
        Ok(t) => t,
        Err(e) => {
            out.error = Some(format!("{e:#}"));
            return out;
        }
    };
    let one = |channel: usize| {
        let samples = &chunk.ch[channel];
        let token = token.clone();
        async move {
            if !speaks(samples) {
                return None;
            }
            let bytes = wav::mono_wav(RATE, samples);
            log::info!("live chunk {n} ch{channel}: {:.1} s at {:.1} s -> {}/api/chat/transcribe", samples.len() as f64 / RATE as f64, chunk.start_sec, api.web);
            Some(upload::transcribe_chunk(client, &api.web, &token, bytes, format!("live-{n:04}-ch{channel}.wav"), false).await)
        }
    };
    let (mic, sys) = futures_util::future::join(one(0), one(1)).await;
    for (channel, r) in [mic, sys].into_iter().enumerate() {
        match r {
            None => {}
            Some(Ok(t)) => {
                if t.model.is_some() {
                    out.model = t.model;
                }
                out.texts[channel] = Some(t.text);
            }
            Some(Err(e)) => {
                log::warn!("live transcription failed: {e:#}");
                out.error = Some(format!("{e:#}"));
            }
        }
    }
    out
}

/// Turns a transcribed chunk into lines (in recording order): microphone echo of the loudspeaker
/// dropped, events to the HUD, lines appended in the web app.
async fn apply_chunk(app: &AppHandle, s: &Session, api: &Api, r: ChunkResult) {
    if let Some(m) = &r.model {
        s.set_transcriber(m);
    }
    match &r.error {
        Some(e) => {
            let _ = app.emit("transcript:status", serde_json::json!({ "state": "error", "message": e }));
        }
        None => {
            let _ = app.emit("transcript:status", serde_json::json!({ "state": "listening", "transcriber": s.transcriber() }));
        }
    }
    let [mic, sys] = r.texts;
    let mic = mic.filter(|t| !t.trim().is_empty());
    let sys = sys.filter(|t| !t.trim().is_empty());
    let mic = match (mic, &sys) {
        (Some(m), Some(sy)) if crate::meeting_pass::is_echo(&m, sy) => {
            log::info!("live chunk {}: microphone line is loudspeaker echo, dropped", r.n);
            None
        }
        (m, _) => m,
    };
    for (channel, text) in [(0, mic), (1, sys)] {
        let Some(text) = text else { continue };
        let ev = s.push(Segment { channel, start_sec: r.start_sec, text });
        let _ = app.emit("transcript:final", ev);
        // The first impulses right after the first lines, not only after 45 s.
        if s.coached.load(Ordering::SeqCst) == 0 {
            s.wake_coach.notify_one();
        }
    }
    if let Err(e) = flush(s, api).await {
        log::warn!("live append failed: {e:#}");
    }
}

/// Live transcription through the ADR-06 route until the recording stops (frames channel closes).
pub async fn transcribe(app: AppHandle, s: Arc<Session>, api: Api, frames: mpsc::Receiver<Vec<i16>>) {
    transcribe_from(app, s, api, Vec::new(), 0, frames).await
}

/// Like `transcribe`, but the recording is already `start_frame` frames (100 ms each) in and
/// `prefix` holds the frames from there that nobody transcribed yet (Deepgram fallback).
pub async fn transcribe_from(
    app: AppHandle,
    s: Arc<Session>,
    api: Api,
    prefix: Vec<Vec<i16>>,
    start_frame: usize,
    mut frames: mpsc::Receiver<Vec<i16>>,
) {
    let (tx, rx) = mpsc::unbounded_channel::<LiveChunk>();
    let (app2, s2, api2) = (app.clone(), s.clone(), api.clone());
    let worker = tauri::async_runtime::spawn(async move {
        let client = match upload::http_client(upload::TRANSCRIBE_TIMEOUT) {
            Ok(c) => c,
            Err(e) => {
                log::error!("http client: {e:#}");
                return;
            }
        };
        let chunks = futures_util::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|c| (c, rx)) });
        let mut n = 0;
        // Up to LIVE_PARALLEL chunks in flight, results still applied in recording order.
        let results = chunks
            .map(|chunk| {
                n += 1;
                transcribe_chunk_texts(&api2, &client, chunk, n)
            })
            .buffered(LIVE_PARALLEL);
        futures_util::pin_mut!(results);
        while let Some(r) = results.next().await {
            apply_chunk(&app2, &s2, &api2, r).await;
        }
    });
    let _ = app.emit("transcript:status", serde_json::json!({ "state": "listening", "transcriber": s.transcriber() }));
    let mut cutter = Cutter::starting_at(start_frame * dsp::FRAME_SAMPLES);
    for frame in prefix {
        if let Some(c) = cutter.push(&frame) {
            let _ = tx.send(c);
        }
    }
    // Receiving never waits on the network: chunks queue for the worker, so no frame is dropped.
    while let Some(frame) = frames.recv().await {
        if let Some(c) = cutter.push(&frame) {
            let _ = tx.send(c);
        }
    }
    if let Some(c) = cutter.flush() {
        let _ = tx.send(c);
    }
    drop(tx);
    let _ = worker.await;
}

/// Coaching every 45 s with new text, or right away on `coach_now`.
pub async fn coach_loop(app: AppHandle, s: Arc<Session>, api: Api) {
    loop {
        tokio::select! {
            _ = tokio::time::sleep(COACH_EVERY) => {}
            _ = s.wake_coach.notified() => {}
        }
        if s.is_ended() {
            break;
        }
        let forced = s.force_coach.swap(false, Ordering::SeqCst);
        let n = s.segment_count();
        let Some(id) = s.item_id() else {
            if forced {
                let _ = app.emit("coaching:status", serde_json::json!({ "state": "error", "message": t("Not connected to Kortex yet") }));
            }
            continue;
        };
        if n == 0 || (n == s.coached.load(Ordering::SeqCst) && !forced) {
            if forced {
                let _ = app.emit("coaching:status", serde_json::json!({ "state": "idle", "message": t("No new conversation for prompts yet") }));
            }
            continue;
        }
        if let Err(e) = flush(&s, &api).await {
            log::warn!("live append before coaching failed: {e:#}");
        }
        let _ = app.emit("coaching:status", serde_json::json!({ "state": "loading" }));
        match api.post("/api/meeting/coach", &serde_json::json!({ "item_id": id }), Duration::from_secs(90)).await {
            Ok(v) => {
                s.coached.store(n, Ordering::SeqCst);
                let cards = parse_cards(&v);
                log::info!("coaching: {} cards for {n} lines", cards.len());
                let _ = app.emit("coaching:cards", serde_json::json!({ "cards": cards, "at": clock(s.elapsed_secs()) }));
                let _ = app.emit("coaching:status", serde_json::json!({ "state": "idle" }));
            }
            Err(e) => {
                log::warn!("coaching failed: {e:#}");
                if let Some(why) = coach_refusal(http_status(&e), api.personal_token) {
                    // Will not work for the rest of this meeting: say why once, then stop asking.
                    s.block_coaching(why);
                    let _ = app.emit("coaching:status", serde_json::json!({ "state": "error", "message": why }));
                    break;
                }
                let _ = app.emit("coaching:status", serde_json::json!({ "state": "error", "message": format!("{e:#}") }));
            }
        }
    }
}

async fn wait_for_item(s: &Session, max: Duration) -> Option<String> {
    let until = Instant::now() + max;
    loop {
        if let Some(id) = s.item_id() {
            return Some(id);
        }
        if Instant::now() >= until {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// After "Call beenden": wait for the last chunks, end the session, start the protocol.
/// Progress goes out as `meeting:upload` (same events as record-then-upload).
pub async fn finish(app: AppHandle, s: Arc<Session>, api: Api, cfg: DesktopConfig, wav_path: Option<PathBuf>) {
    s.ended.store(true, Ordering::SeqCst);
    s.wake_coach.notify_one();
    let _ = app.emit("meeting:upload", serde_json::json!({ "state": "uploading" }));
    let worker = s.worker.lock().unwrap().take();
    if let Some(h) = worker {
        let _ = h.await;
    }
    let result: Result<(String, usize)> = async {
        let Some(id) = wait_for_item(&s, Duration::from_secs(15)).await else {
            // The session never opened: the old path (transcribe the WAV, ingest as a new meeting).
            let path = wav_path.clone().ok_or_else(|| anyhow!(t("No recording file")))?;
            let token = api.token().await?;
            let r = upload::upload_meeting(&cfg, &token, &path, &s.title, &s.started_at).await?;
            return Ok((r.item_id, r.segments));
        };
        flush(&s, &api).await?;
        let mut count = s.segment_count();
        let mut transcript = None;
        // Final pass for the protocol: the whole meeting with speakers (meeting_pass.rs). It also
        // covers a meeting without any live text. When it fails, the live transcript stays.
        if let Some(path) = &wav_path {
            let live = s.segments.lock().unwrap().clone();
            let token = api.token().await?;
            match crate::meeting_pass::run(&api.web, &token, path, &live).await {
                Ok(p) if p.lines > 0 => {
                    log::info!("meeting pass: {} lines, {} remote voice(s)", p.lines, p.speakers);
                    count = p.lines;
                    transcript = Some(p.transcript);
                }
                Ok(_) => log::info!("meeting pass: nothing understood, live transcript stays"),
                Err(e) => {
                    log::warn!("meeting pass failed, live transcript stays: {e:#}");
                    if count == 0 {
                        return Err(e);
                    }
                }
            }
        }
        let body = serde_json::json!({ "action": "end", "item_id": id, "transcript": transcript });
        api.post("/api/meeting/live", &body, upload::API_TIMEOUT).await?;
        Ok((id, count))
    }
    .await;
    match result {
        Ok((id, segments)) => {
            let _ = app.emit("meeting:upload", serde_json::json!({ "state": "done", "item_id": id, "folder_path": null, "segments": segments }));
        }
        Err(e) => {
            log::error!("meeting finish failed: {e:#}");
            let file = wav_path.map(|p| p.display().to_string());
            let _ = app.emit("meeting:upload", serde_json::json!({ "state": "error", "message": format!("{e:#}"), "file": file }));
        }
    }
    emit_live(&app, "ended", &s, None);
}

/// After "Verwerfen": stop transcription and coaching without a protocol, and delete the session's
/// meeting item in Kortex (it may still be opening, so wait for it briefly).
pub async fn discard(app: AppHandle, s: Arc<Session>, api: Option<Api>) {
    s.ended.store(true, Ordering::SeqCst);
    s.wake_coach.notify_one();
    let worker = s.worker.lock().unwrap().take();
    if let Some(h) = worker {
        h.abort();
    }
    let result: Result<()> = async {
        let api = api.ok_or_else(|| anyhow!("no account connected"))?;
        let Some(id) = wait_for_item(&s, Duration::from_secs(15)).await else { return Ok(()) };
        api.post("/api/meeting/live", &serde_json::json!({ "action": "discard", "item_id": id }), upload::API_TIMEOUT).await?;
        Ok(())
    }
    .await;
    if let Err(e) = result {
        log::error!("discarding the live meeting failed: {e:#}");
    }
    emit_live(&app, "ended", &s, None);
}

/// Marks a moment (HUD clip field, coaching card "Als Clip merken").
pub async fn clip(s: &Session, api: &Api, text: &str) -> Result<serde_json::Value> {
    let id = s.item_id().ok_or_else(|| anyhow!(t("Not connected to Kortex yet, the clip stays in the HUD only")))?;
    let body = serde_json::json!({ "action": "clip", "item_id": id, "at_sec": s.elapsed_secs().floor(), "text": text.trim(), "source": "desktop" });
    let v = api.post("/api/meeting/live", &body, upload::API_TIMEOUT).await?;
    Ok(v["clip"].clone())
}

pub async fn task(s: &Session, api: &Api, title: &str) -> Result<String> {
    let id = s.item_id().ok_or_else(|| anyhow!(t("Not connected to Kortex yet")))?;
    let body = serde_json::json!({ "action": "task", "item_id": id, "title": title.trim(), "at_sec": s.elapsed_secs().floor() });
    let v = api.post("/api/meeting/live", &body, upload::API_TIMEOUT).await?;
    Ok(v["task_id"].as_str().unwrap_or_default().to_string())
}

/// A knowledge item id (uuid) for a web URL path, nothing else.
pub fn is_item_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(n: usize, amp: f32) -> Vec<i16> {
        (0..n).map(|i| ((i as f32 * 0.17).sin() * amp) as i16).collect()
    }

    fn stereo(a: &[i16], b: &[i16]) -> Vec<i16> {
        a.iter().zip(b).flat_map(|(&x, &y)| [x, y]).collect()
    }

    /// Pushes `secs` of audio in 100 ms frames; returns the chunks it cut.
    fn feed(c: &mut Cutter, a: &[i16], b: &[i16]) -> Vec<LiveChunk> {
        let frame = 1_600;
        let mut out = Vec::new();
        for i in (0..a.len()).step_by(frame) {
            let end = (i + frame).min(a.len());
            if let Some(ch) = c.push(&stereo(&a[i..end], &b[i..end])) {
                out.push(ch);
            }
        }
        out
    }

    #[test]
    fn cuts_at_the_first_real_pause_after_ten_seconds() {
        let r = RATE as usize;
        // 13 s speech, 1 s pause, 5 s speech.
        let mut a = tone(13 * r, 8000.0);
        a.extend(vec![0; r]);
        a.extend(tone(5 * r, 8000.0));
        let b = vec![0i16; a.len()];
        let mut c = Cutter::default();
        let chunks = feed(&mut c, &a, &b);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start_sec, 0.0);
        // Cut once the pause lasted 300 ms (3 frames) after 13 s.
        assert_eq!(chunks[0].ch[0].len(), 13 * r + 3 * 1_600);
        let rest = c.flush().unwrap();
        assert!((rest.start_sec - 13.3).abs() < 1e-9);
        assert!(speaks(&rest.ch[0]) && !speaks(&rest.ch[1]));
    }

    #[test]
    fn a_gap_between_two_words_is_no_pause() {
        let r = RATE as usize;
        // 11 s speech, 100 ms gap (one frame), 4 s speech: no cut in the gap (device test 0.6.2).
        let mut a = tone(11 * r, 8000.0);
        a.extend(vec![0; 1_600]);
        a.extend(tone(4 * r, 8000.0));
        let mut c = Cutter::default();
        assert!(feed(&mut c, &a, &vec![0; a.len()]).is_empty());
    }

    #[test]
    fn without_a_pause_the_cut_goes_to_the_quietest_moment_before_twenty_seconds() {
        let r = RATE as usize;
        // 18 s loud, 200 ms soft (too short for a pause), 4 s loud.
        let mut a = tone(18 * r, 8000.0);
        a.extend(tone(3_200, 300.0));
        a.extend(tone(4 * r, 8000.0));
        let mut c = Cutter::default();
        let chunks = feed(&mut c, &a, &vec![0; a.len()]);
        assert_eq!(chunks.len(), 1);
        // Cut at the end of the softest frame (18.2 s), not mid-word at 20 s; the rest stays.
        assert_eq!(chunks[0].ch[0].len(), 18 * r + 3_200);
        let rest = c.flush().unwrap();
        assert!((rest.start_sec - 18.2).abs() < 1e-9);
    }

    #[test]
    fn cuts_at_twenty_seconds_without_a_pause_and_drops_short_tails() {
        let r = RATE as usize;
        let a = tone(41 * r, 8000.0);
        let b = tone(41 * r, 3000.0);
        let mut c = Cutter::default();
        let chunks = feed(&mut c, &a, &b);
        assert_eq!(chunks.iter().map(|c| c.start_sec as u32).collect::<Vec<_>>(), vec![0, 20]);
        assert!(chunks.iter().all(|c| c.ch[0].len() == 20 * r && c.ch[1].len() == 20 * r));
        // 1 s left: still a chunk; less is dropped.
        assert_eq!(c.flush().map(|c| c.ch[0].len()), Some(r));
        let mut short = Cutter::default();
        feed(&mut short, &tone(r / 2, 8000.0), &vec![0; r / 2]);
        assert!(short.flush().is_none());
    }

    #[test]
    fn silence_is_not_sent_for_transcription() {
        assert!(!speaks(&vec![0; 16_000 * 5]));
        assert!(!speaks(&tone(8_000, 8000.0)));
        assert!(speaks(&tone(16_000, 8000.0)));
    }

    #[test]
    fn formats_the_clock_and_reads_coach_cards() {
        assert_eq!(clock(75.9), "01:15");
        assert_eq!(clock(3725.0), "1:02:05");
        let v = serde_json::json!({ "ok": true, "cards": [
            { "kind": "fact", "text": "Doc 02 nennt SHA-256" },
            { "kind": "question", "text": "  " },
            { "kind": "action", "text": "Konzept an Sven" },
        ] });
        assert_eq!(parse_cards(&v).iter().map(|c| c.kind.as_str()).collect::<Vec<_>>(), vec!["fact", "action"]);
        assert!(parse_cards(&serde_json::json!({ "ok": false })).is_empty());
    }

    #[test]
    fn coach_cards_may_carry_a_title_and_an_object_and_stay_compatible() {
        let v = serde_json::json!({ "cards": [
            { "kind": "question", "text": "Nach dem Budget fragen", "title": "Jetzt guter Moment",
              "object": { "id": "p1", "title": "Jonas Weber", "type": "person" } },
            { "kind": "fact", "text": "Ohne Extras" },
            { "kind": "action", "text": "Kaputtes Objekt", "object": "Jonas", "title": 7 },
        ] });
        let cards = parse_cards(&v);
        assert_eq!(cards.len(), 3);
        assert_eq!(cards[0].title.as_deref(), Some("Jetzt guter Moment"));
        assert_eq!(cards[0].object.as_ref().map(|o| (o.id.as_str(), o.title.as_str(), o.kind.as_deref())), Some(("p1", "Jonas Weber", Some("person"))));
        // A wrong shape drops only the extra field, never the card.
        assert_eq!((cards[2].title.clone(), cards[2].object.clone()), (None, None));
        // Without extras the event looks exactly as before (older HUDs read kind and text only).
        assert_eq!(serde_json::to_value(&cards[1]).unwrap(), serde_json::json!({ "kind": "fact", "text": "Ohne Extras" }));
    }

    #[test]
    fn transcript_events_name_the_channel() {
        let s = Session::new("Sync".into(), "2026-10-30T10:00:00+01:00".into());
        let ev = s.push(Segment { channel: 1, start_sec: 62.0, text: " Hallo ".into() });
        assert_eq!(ev, serde_json::json!({ "channel": 1, "speaker": "Gesprächspartner", "ts": "01:02", "text": "Hallo" }));
        assert_eq!(s.segment_count(), 1);
        assert!(s.item_id().is_none() && !s.is_ended());
    }

    #[test]
    fn a_cutter_started_mid_meeting_keeps_the_recording_clock() {
        let r = RATE as usize;
        // Deepgram handed over after 30 s (300 frames of 100 ms).
        let mut c = Cutter::starting_at(300 * dsp::FRAME_SAMPLES);
        let chunks = feed(&mut c, &tone(20 * r, 8000.0), &vec![0; 20 * r]);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start_sec, 30.0);
    }

    #[test]
    fn coaching_stops_only_when_a_token_lacks_the_search_scope() {
        assert!(coach_refusal(Some(401), true).is_some());
        assert!(coach_refusal(Some(403), true).is_some());
        // A signed-in account with 401 (expired session), server errors and network errors retry.
        assert!(coach_refusal(Some(401), false).is_none());
        assert!(coach_refusal(Some(502), true).is_none());
        assert!(coach_refusal(None, true).is_none());
        let e: anyhow::Error = HttpError { status: 401, message: "API-Token darf hier nicht verwendet werden".into() }.into();
        assert_eq!(http_status(&e), Some(401));
        assert_eq!(e.to_string(), "API-Token darf hier nicht verwendet werden (401)");
        assert_eq!(http_status(&anyhow!("offline")), None);
        let s = Session::new("Sync".into(), String::new());
        assert!(s.coach_now().is_ok());
        s.block_coaching("nein");
        assert_eq!(s.coach_now(), Err("nein".to_string()));
    }

    #[test]
    fn only_uuids_reach_the_main_window_url() {
        assert!(is_item_id("22222222-2222-4222-8222-000000000001"));
        assert!(!is_item_id("../settings?x=1"));
        assert!(!is_item_id("22222222-2222-4222-8222-00000000000/"));
    }
}
