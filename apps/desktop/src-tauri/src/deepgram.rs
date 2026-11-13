//! Deepgram Nova-3 live transcription over WebSocket (spec 02 §6.1).
//!
//! Optional override only (ADR-06): it runs only when `DEEPGRAM_API_KEY` is set in the desktop's
//! environment (never compiled in, never stored). Without it the live transcript goes through the
//! user's `audio_transcription` route (live.rs), which is also the fallback here.
//!
//! Sends the interleaved 2-channel 16 kHz linear16 frames from audio.rs (100 ms each) and turns
//! the results into `transcript:partial` / `transcript:final` events. Channel 0 is always the
//! user, channel 1 the remote side, so speaker attribution needs no diarization guesswork.
//!
//! Resilience: frames first go into a bounded `Backlog` and leave it only after a successful send,
//! so a dropped connection loses no audio that is still in the backlog. A lost connection is
//! retried with `backoff` (0.5 s … 8 s, reset after a healthy stretch); while waiting, frames keep
//! queueing. When every retry failed, the backlog and the rest of the recording go to the ADR-06
//! route (`live::transcribe_from`) with the same recording clock.

use crate::i18n::{t, tf};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::Receiver;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

use crate::live::{self, Api, Session};
use crate::upload::{Segment, CHANNEL_NAMES};

const ENDPOINT: &str = "wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=2&multichannel=true&diarize=true&language=de&smart_format=true&interim_results=true";

/// One frame from audio.rs is 100 ms.
pub const FRAME_SECS: f64 = 0.1;
/// Frames kept while Deepgram is unreachable (60 s); older ones are dropped first.
pub const BACKLOG_FRAMES: usize = 600;
/// A connection that carried this many frames (10 s) counts as healthy: the retries start over.
const HEALTHY_FRAMES: usize = 100;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
pub const TRANSCRIBER: &str = "deepgram:nova-3";

/// Wait before retry `attempt` (0-based); None = give up and fall back to the ADR-06 route.
pub fn backoff(attempt: u32) -> Option<Duration> {
    const STEPS_MS: [u64; 5] = [500, 1_000, 2_000, 4_000, 8_000];
    STEPS_MS.get(attempt as usize).map(|&ms| Duration::from_millis(ms))
}

/// Frames not yet delivered, with their position in the recording.
pub struct Backlog {
    q: VecDeque<Vec<i16>>,
    cap: usize,
    /// Recording index (in frames) of the front frame = frames sent or dropped so far.
    front: usize,
}

impl Backlog {
    pub fn new(cap: usize) -> Self {
        Self { q: VecDeque::new(), cap: cap.max(1), front: 0 }
    }

    /// Queues a new frame; when full the oldest one is dropped (and counted as passed).
    pub fn push(&mut self, frame: Vec<i16>) {
        if self.q.len() == self.cap {
            self.q.pop_front();
            self.front += 1;
        }
        self.q.push_back(frame);
    }

    pub fn pop(&mut self) -> Option<Vec<i16>> {
        let f = self.q.pop_front()?;
        self.front += 1;
        Some(f)
    }

    /// Puts back a frame that could not be sent.
    pub fn unpop(&mut self, frame: Vec<i16>) {
        self.front = self.front.saturating_sub(1);
        self.q.push_front(frame);
    }

    pub fn is_empty(&self) -> bool {
        self.q.is_empty()
    }

    /// Recording index of the next frame to send.
    pub fn position(&self) -> usize {
        self.front
    }

    /// Recording time (s) of the next frame to send: the clock offset of a new connection.
    pub fn offset_secs(&self) -> f64 {
        self.front as f64 * FRAME_SECS
    }

    pub fn take_all(&mut self) -> Vec<Vec<i16>> {
        self.q.drain(..).collect()
    }
}

#[derive(Deserialize)]
struct DgResult {
    #[serde(default)]
    channel_index: Vec<u8>,
    #[serde(default)]
    is_final: bool,
    #[serde(default)]
    start: f64,
    channel: DgChannel,
}

#[derive(Deserialize)]
struct DgChannel {
    alternatives: Vec<DgAlternative>,
}

#[derive(Deserialize)]
struct DgAlternative {
    transcript: String,
}

/// A transcript line from a Deepgram `Results` message: (channel, start_sec, text, is_final).
pub fn parse_result(text: &str, offset_secs: f64) -> Option<(usize, f64, String, bool)> {
    let res = serde_json::from_str::<DgResult>(text).ok()?;
    let alt = res.channel.alternatives.first()?;
    let line = alt.transcript.trim();
    if line.is_empty() {
        return None;
    }
    let channel = res.channel_index.first().copied().unwrap_or(0).min(1) as usize;
    Some((channel, offset_secs + res.start, line.to_string(), res.is_final))
}

fn status(app: &AppHandle, state: &str, message: Option<String>) {
    let _ = app.emit("transcript:status", serde_json::json!({ "state": state, "transcriber": TRANSCRIBER, "message": message }));
}

/// Waits `wait` while still taking frames into the backlog (so audio.rs never drops any).
async fn wait_draining(frames: &mut Receiver<Vec<i16>>, backlog: &mut Backlog, wait: Duration, closed: &mut bool) {
    let sleep = tokio::time::sleep(wait);
    tokio::pin!(sleep);
    while !*closed {
        tokio::select! {
            _ = &mut sleep => return,
            f = frames.recv() => match f {
                Some(f) => backlog.push(f),
                None => *closed = true,
            },
        }
    }
}

/// One connection: streams the backlog, then new frames, until the recording stops (Ok) or the
/// connection fails (Err; unsent frames stay in the backlog). Returns the frames sent.
async fn connect_and_stream(
    app: &AppHandle,
    key: &str,
    frames: &mut Receiver<Vec<i16>>,
    backlog: &mut Backlog,
    session: &Option<(Arc<Session>, Api)>,
    closed: &mut bool,
    sent: &mut usize,
) -> Result<()> {
    let mut req = ENDPOINT.into_client_request()?;
    req.headers_mut().insert("Authorization", format!("Token {key}").parse()?);
    // Keep taking frames while the handshake runs.
    let connect = tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(req));
    tokio::pin!(connect);
    let ws = loop {
        tokio::select! {
            r = &mut connect => break r.map_err(|_| anyhow!(t("Timeout while connecting")))?.context("connect to Deepgram")?.0,
            f = frames.recv(), if !*closed => match f {
                Some(f) => backlog.push(f),
                None => *closed = true,
            },
        }
    };
    status(app, "listening", None);
    let offset = backlog.offset_secs();
    let (mut tx, mut rx) = ws.split();

    let sender = async {
        loop {
            if backlog.is_empty() && !*closed {
                match frames.recv().await {
                    Some(f) => backlog.push(f),
                    None => *closed = true,
                }
            }
            let Some(frame) = backlog.pop() else {
                if *closed {
                    break;
                }
                continue;
            };
            let bytes: Vec<u8> = frame.iter().flat_map(|s| s.to_le_bytes()).collect();
            if let Err(e) = tx.send(Message::Binary(bytes)).await {
                backlog.unpop(frame);
                return Err(anyhow!(tf("Deepgram connection lost: {error}", &[("error", &e)])));
            }
            *sent += 1;
        }
        // Flush and close the stream so Deepgram returns the last final results.
        tx.send(Message::Text(r#"{"type":"CloseStream"}"#.into())).await?;
        anyhow::Ok(())
    };

    let receiver = async {
        while let Some(msg) = rx.next().await {
            let Message::Text(text) = msg? else { continue };
            let Some((channel, start_sec, line, is_final)) = parse_result(&text, offset) else { continue };
            let event = serde_json::json!({
                "channel": channel,
                "speaker": CHANNEL_NAMES[channel],
                "ts": live::clock(start_sec),
                "text": line,
            });
            match (is_final, session) {
                (true, Some((s, api))) => {
                    s.set_transcriber(TRANSCRIBER);
                    let ev = s.push(Segment { channel, start_sec, text: line });
                    let _ = app.emit("transcript:final", ev);
                    let (s, api) = (s.clone(), api.clone());
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = live::flush(&s, &api).await {
                            log::warn!("live append failed: {e:#}");
                        }
                    });
                }
                (true, None) => {
                    let _ = app.emit("transcript:final", event);
                }
                (false, _) => {
                    let _ = app.emit("transcript:partial", event);
                }
            }
        }
        anyhow::Ok(())
    };

    // The first error (a failed send or a broken read) ends both halves.
    tokio::try_join!(sender, receiver)?;
    Ok(())
}

/// Streams `frames` to Deepgram until the recording stops, reconnecting on failures; after the
/// last retry the rest goes through the user's ADR-06 route (with a live session) instead.
pub async fn run(app: AppHandle, mut frames: Receiver<Vec<i16>>, session: Option<(Arc<Session>, Api)>) {
    let key = std::env::var("DEEPGRAM_API_KEY").unwrap_or_default().trim().to_string();
    let mut backlog = Backlog::new(BACKLOG_FRAMES);
    let mut closed = false;
    let mut attempt = 0u32;
    if !key.is_empty() {
        loop {
            let mut sent = 0;
            match connect_and_stream(&app, &key, &mut frames, &mut backlog, &session, &mut closed, &mut sent).await {
                Ok(()) => return,
                Err(e) => {
                    log::warn!("deepgram: {e:#}");
                    if closed && backlog.is_empty() {
                        return;
                    }
                    if sent >= HEALTHY_FRAMES {
                        attempt = 0;
                    }
                    let Some(wait) = backoff(attempt) else { break };
                    attempt += 1;
                    status(&app, "error", Some(tf("Deepgram disconnected, retrying ({attempt}/5)", &[("attempt", &attempt)])));
                    wait_draining(&mut frames, &mut backlog, wait, &mut closed).await;
                }
            }
        }
    }
    // Deepgram is not reachable: the rest of the meeting through the ADR-06 route.
    match session {
        Some((s, api)) => {
            let _ = app.emit(
                "transcript:status",
                serde_json::json!({ "state": "listening", "transcriber": null, "message": t("Deepgram not reachable, continuing through your Kortex routing") }),
            );
            let start = backlog.position();
            let prefix = backlog.take_all();
            live::transcribe_from(app, s, api, prefix, start, frames).await;
        }
        None => {
            status(&app, "error", Some(t("Deepgram not reachable; without an account the recording stays local").into()));
            while frames.recv().await.is_some() {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_five_times_then_gives_up() {
        let waits: Vec<u64> = (0..6).filter_map(backoff).map(|d| d.as_millis() as u64).collect();
        assert_eq!(waits, vec![500, 1_000, 2_000, 4_000, 8_000]);
        assert!(backoff(5).is_none());
    }

    #[test]
    fn backlog_keeps_the_recording_clock() {
        let mut b = Backlog::new(3);
        for i in 0..5 {
            b.push(vec![i]);
        }
        // Two oldest frames dropped: the next frame to send is frame 2 (0.2 s).
        assert_eq!(b.q.len(), 3);
        assert_eq!(b.position(), 2);
        assert!((b.offset_secs() - 0.2).abs() < 1e-9);
        let f = b.pop().unwrap();
        assert_eq!(f, vec![2]);
        assert_eq!(b.position(), 3);
        // A failed send puts it back at the same position.
        b.unpop(f);
        assert_eq!(b.position(), 2);
        assert_eq!(b.take_all(), vec![vec![2], vec![3], vec![4]]);
        assert!(b.is_empty());
    }

    #[test]
    fn parses_final_and_interim_results_with_the_connection_offset() {
        let msg = r#"{"type":"Results","channel_index":[1,2],"is_final":true,"start":3.5,"channel":{"alternatives":[{"transcript":" Und wer entscheidet? "}]}}"#;
        assert_eq!(parse_result(msg, 60.0), Some((1, 63.5, "Und wer entscheidet?".to_string(), true)));
        let interim = r#"{"channel_index":[0,2],"start":1.0,"channel":{"alternatives":[{"transcript":"Wir"}]}}"#;
        assert_eq!(parse_result(interim, 0.0), Some((0, 1.0, "Wir".to_string(), false)));
        assert!(parse_result(r#"{"channel":{"alternatives":[{"transcript":"  "}]}}"#, 0.0).is_none());
        assert!(parse_result(r#"{"type":"Metadata"}"#, 0.0).is_none());
    }
}
