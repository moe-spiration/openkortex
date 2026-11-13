//! Self-test of the meeting chain without a real meeting (0.6.1).
//!
//! Runs the **real** recording path (`start_recording_inner` → audio.rs ring + DSP + WAV → live.rs
//! session, chunk cutter, transcription, coaching → `stop_recording_inner` → `live::finish`) with
//! two substitutions:
//! - the audio comes from a generated signal (speech-like bursts on both channels) or a WAV file
//!   instead of microphone and loopback (`audio::Synthetic`);
//! - offline (default) the web API is a small local stub server on 127.0.0.1 that answers
//!   `/api/meeting/live`, `/api/chat/transcribe` and `/api/meeting/coach` like the web app. Its
//!   "transcript" reports what audio arrived (seconds, level), so a line in the HUD proves that the
//!   audio travelled the whole way. Online (`online = true`) it talks to the real web app with the
//!   connected account instead (creates a meeting "Kortex Selbsttest" in the vault).
//!
//! Along the way it checks the window behaviour: minimize without a recording → HUD (setting on),
//! minimize during the recording → pill, restore → back. The HUD answers a probe with what it
//! renders (`selftest:hud`). The result goes to `logs/selftest-<time>.json` and `selftest:done`.
//!
//! Start: Audio-Setup → "Selbsttest", or `Kortex.exe --selftest [--selftest-wav <file>]
//! [--selftest-online] [--selftest-report <file>]` (exits with 0 = passed, 1 = failed).

use crate::i18n::{t, tf};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::{audio, commands, dsp, live, wav, window, AppState};

pub const RATE: u32 = 16_000;
/// Length of the generated signal; the cutter cuts the first chunk in the pause at 13 s.
pub const SIGNAL_SECS: f32 = 16.0;
const PAUSE: (f32, f32) = (13.0, 13.6);
pub const STUB_ITEM: &str = "5e1f7e57-0000-4000-8000-000000000001";
pub const STUB_TOKEN: &str = "kx_selftest_local_only";

static RUNNING: AtomicBool = AtomicBool::new(false);

// --- signal ----------------------------------------------------------------------------------

/// Speech-like bursts: a voiced tone with harmonics, 4 Hz syllable envelope, a pause at 13 s.
pub fn speechlike(secs: f32, f0: f32, amp: f32) -> Vec<f32> {
    let n = (secs * RATE as f32) as usize;
    (0..n)
        .map(|i| {
            let t = i as f32 / RATE as f32;
            if t >= PAUSE.0 && t < PAUSE.1 {
                return 0.0;
            }
            let syl = (0.5 + 0.5 * (2.0 * std::f32::consts::PI * 4.0 * t).sin()).powf(0.6);
            let w = |k: f32| (2.0 * std::f32::consts::PI * f0 * k * t).sin() / k;
            amp * syl * (w(1.0) + w(2.0) + w(3.0)) / 1.8
        })
        .collect()
}

/// The generated meeting: "me" at 140 Hz on ch0, "the other side" at 220 Hz on ch1.
pub fn tone_source() -> audio::Synthetic {
    audio::Synthetic { rate: RATE, mic: speechlike(SIGNAL_SECS, 140.0, 0.35), sys: speechlike(SIGNAL_SECS, 220.0, 0.25) }
}

/// A WAV file as the source: stereo = ch0 mic / ch1 system, mono = mic only.
pub fn wav_source(path: &std::path::Path) -> Result<audio::Synthetic> {
    let w = wav::read(path)?;
    if w.rate == 0 || w.channels == 0 {
        bail!(t("invalid WAV file"));
    }
    let f = |v: Vec<i16>| v.into_iter().map(|s| s as f32 / i16::MAX as f32).collect::<Vec<f32>>();
    let mic = f(w.channel(0));
    let sys = if w.channels > 1 { f(w.channel(1)) } else { vec![0.0; mic.len()] };
    Ok(audio::Synthetic { rate: w.rate, mic, sys })
}

// --- stub web API ----------------------------------------------------------------------------

#[derive(Clone, Debug, Default, Serialize)]
pub struct StubStats {
    pub live_start: usize,
    pub live_append: usize,
    pub live_end: usize,
    pub transcribe: usize,
    pub coach: usize,
    pub unauthorized: usize,
    /// What the transcription endpoint received: (channel, seconds, dBFS).
    pub audio: Vec<(usize, f64, i32)>,
}

pub struct Stub {
    pub url: String,
    pub stats: Arc<Mutex<StubStats>>,
    stop: Arc<AtomicBool>,
}

impl Drop for Stub {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the accept loop.
        let _ = TcpStream::connect(self.url.trim_start_matches("http://"));
    }
}

fn read_request(stream: &mut TcpStream) -> Result<(String, String, String, Vec<u8>)> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut r = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    r.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let (mut len, mut auth) = (0usize, String::new());
    loop {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        let (k, v) = h.split_once(':').unwrap_or((&h, ""));
        match k.trim().to_ascii_lowercase().as_str() {
            "content-length" => len = v.trim().parse().unwrap_or(0),
            "authorization" => auth = v.trim().to_string(),
            _ => {}
        }
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    Ok((method, path, auth, body))
}

fn respond(stream: &mut TcpStream, status: u16, body: &serde_json::Value) {
    let text = body.to_string();
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
        if status == 200 { "OK" } else { "Error" },
        text.len()
    );
}

/// The uploaded chunk's WAV: (channel from the file name, seconds, dBFS).
fn heard(body: &[u8]) -> Option<(usize, f64, i32)> {
    let at = body.windows(4).position(|w| w == b"RIFF")?;
    let w = wav::parse(&body[at..]).ok()?;
    let name_at = body.windows(3).position(|w| w == b"-ch")?;
    let ch = body.get(name_at + 3)?.checked_sub(b'0')? as usize;
    let f: Vec<f32> = w.samples.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
    Some((ch, w.seconds(), dsp::level(&f).db))
}

fn handle(stream: &mut TcpStream, stats: &Mutex<StubStats>) -> Result<()> {
    let (method, path, auth, body) = read_request(stream)?;
    if method != "POST" {
        respond(stream, 405, &serde_json::json!({ "ok": false }));
        return Ok(());
    }
    if auth != format!("Bearer {STUB_TOKEN}") {
        stats.lock().unwrap().unauthorized += 1;
        respond(stream, 401, &serde_json::json!({ "ok": false, "error": { "message": t("not signed in") } }));
        return Ok(());
    }
    let json = || serde_json::from_slice::<serde_json::Value>(&body).unwrap_or_default();
    let reply = match path.as_str() {
        "/api/meeting/live" => {
            let v = json();
            let mut s = stats.lock().unwrap();
            match v["action"].as_str().unwrap_or_default() {
                "start" => {
                    s.live_start += 1;
                    serde_json::json!({ "ok": true, "item_id": STUB_ITEM })
                }
                "append" => {
                    s.live_append += 1;
                    serde_json::json!({ "ok": true })
                }
                "end" => {
                    s.live_end += 1;
                    serde_json::json!({ "ok": true })
                }
                "clip" => serde_json::json!({ "ok": true, "clip": { "id": "clip-selftest", "at_sec": v["at_sec"], "text": v["text"] } }),
                "task" => serde_json::json!({ "ok": true, "task_id": "task-selftest" }),
                _ => serde_json::json!({ "ok": false }),
            }
        }
        "/api/chat/transcribe" => {
            let got = heard(&body);
            let mut s = stats.lock().unwrap();
            s.transcribe += 1;
            match got {
                Some((ch, secs, db)) => {
                    s.audio.push((ch, secs, db));
                    let who = if ch == 0 { t("Microphone") } else { t("System audio") };
                    serde_json::json!({ "text": tf("Self-test {who}: {seconds} s of audio arrived, level {db} dBFS.", &[("who", &who), ("seconds", &format!("{secs:.1}")), ("db", &db)]), "model": "selftest:stub" })
                }
                None => serde_json::json!({ "text": "", "model": "selftest:stub" }),
            }
        }
        "/api/meeting/coach" => {
            let mut s = stats.lock().unwrap();
            s.coach += 1;
            let n = s.audio.len();
            serde_json::json!({ "ok": true, "cards": [
                { "kind": "fact", "text": tf("Self-test: {n} transcript sections reached the coach.", &[("n", &n)]) },
                { "kind": "question", "text": t("Self-test: do levels, transcript and prompts arrive in the HUD?") },
                { "kind": "action", "text": t("Finish the self-test and start a real meeting") },
            ] })
        }
        _ => {
            respond(stream, 404, &serde_json::json!({ "ok": false }));
            return Ok(());
        }
    };
    respond(stream, 200, &reply);
    Ok(())
}

/// Starts the stub web API on a free local port.
pub fn start_stub() -> Result<Stub> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let url = format!("http://{}", listener.local_addr()?);
    let stats = Arc::new(Mutex::new(StubStats::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let (st, sp) = (stats.clone(), stop.clone());
    std::thread::Builder::new().name("kortex-selftest-api".into()).spawn(move || {
        for conn in listener.incoming() {
            if sp.load(Ordering::SeqCst) {
                break;
            }
            let Ok(mut c) = conn else { continue };
            let st = st.clone();
            std::thread::spawn(move || {
                if let Err(e) = handle(&mut c, &st) {
                    log::warn!("selftest stub: {e:#}");
                }
            });
        }
    })?;
    Ok(Stub { url, stats, stop })
}

// --- run -------------------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
pub struct Step {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Report {
    pub ok: bool,
    pub online: bool,
    pub source: String,
    pub started_at: String,
    pub seconds: f64,
    pub steps: Vec<Step>,
    pub stub: Option<StubStats>,
    pub report_file: Option<String>,
    pub log_file: Option<String>,
}

impl Report {
    fn step(&mut self, name: &str, ok: bool, detail: impl Into<String>) {
        let detail = detail.into();
        log::info!("selftest {} {name}: {detail}", if ok { "OK  " } else { "FAIL" });
        self.steps.push(Step { name: name.into(), ok, detail });
    }
}

#[derive(Default)]
struct Seen {
    levels: usize,
    mic_max: i32,
    sys_max: i32,
    finals: Vec<String>,
    cards: usize,
    upload: Option<serde_json::Value>,
    hud: Option<serde_json::Value>,
}

/// Waits until `f` holds or `max` passed.
async fn until(max: Duration, f: impl Fn() -> bool) -> bool {
    let end = Instant::now() + max;
    while Instant::now() < end {
        if f() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    f()
}

fn hud_mode(app: &AppHandle) -> String {
    app.state::<AppState>().hud_mode.lock().unwrap().clone()
}

pub struct Options {
    pub wav: Option<PathBuf>,
    pub online: bool,
}

/// Runs the self-test; refuses while a recording (or another self-test) runs.
pub async fn run(app: AppHandle, opts: Options) -> Result<Report> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        bail!(t("The self-test is already running"));
    }
    let r = run_inner(&app, opts).await;
    RUNNING.store(false, Ordering::SeqCst);
    let mut report = r?;
    report.ok = report.steps.iter().all(|s| s.ok);
    let dir = app.path().app_local_data_dir().map(|d| d.join("logs")).unwrap_or_else(|_| std::env::temp_dir());
    let file = dir.join(format!("selftest-{}.json", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
    report.report_file = Some(file.display().to_string());
    report.log_file = Some(dir.join("kortex.log").display().to_string());
    let _ = std::fs::create_dir_all(&dir);
    if let Err(e) = std::fs::write(&file, serde_json::to_vec_pretty(&report)?) {
        log::warn!("selftest report not written: {e}");
    }
    let failed: Vec<&str> = report.steps.iter().filter(|s| !s.ok).map(|s| s.name.as_str()).collect();
    let summary = if report.ok {
        tf("Self-test passed: {n} checks", &[("n", &report.steps.len())])
    } else {
        tf("Self-test: {failed} of {total} checks failed ({names})", &[("failed", &failed.len()), ("total", &report.steps.len()), ("names", &failed.join(", "))])
    };
    let _ = app.emit("selftest:done", serde_json::json!({ "ok": report.ok, "summary": summary, "report": report.report_file }));
    Ok(report)
}

async fn run_inner(app: &AppHandle, opts: Options) -> Result<Report> {
    let st = app.state::<AppState>();
    if st.recorder.lock().unwrap().is_some() {
        bail!(t("No self-test possible during a recording"));
    }
    let t0 = Instant::now();
    let mut rep = Report { online: opts.online, started_at: chrono::Local::now().to_rfc3339(), ..Default::default() };
    let source = match &opts.wav {
        Some(p) => {
            rep.source = format!("WAV {}", p.display());
            wav_source(p)?
        }
        None => {
            rep.source = tf("Test signal {seconds} s (speech-like, both channels)", &[("seconds", &SIGNAL_SECS)]);
            tone_source()
        }
    };
    let seconds_of_audio = source.mic.len() as f64 / source.rate as f64;
    let stub = if opts.online { None } else { Some(start_stub()?) };
    let api = match &stub {
        Some(s) => live::Api { web: s.url.clone(), config_dir: std::env::temp_dir(), personal_token: false, token_override: Some(STUB_TOKEN.into()) },
        None => {
            let api = commands::live_api_for(app).map_err(|e| anyhow!(e))?;
            api.token().await.map_err(|e| anyhow!(tf("The online self-test needs a connected account: {error}", &[("error", &format!("{e:#}"))])))?;
            api
        }
    };

    // Everything the windows get, as Rust sees it.
    let seen = Arc::new(Mutex::new(Seen { mic_max: -60, sys_max: -60, ..Default::default() }));
    let mut ids = Vec::new();
    {
        let s = seen.clone();
        ids.push(app.listen_any("audio:levels", move |e| {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                let mut s = s.lock().unwrap();
                s.levels += 1;
                s.mic_max = s.mic_max.max(v["ch0"]["db"].as_i64().unwrap_or(-60) as i32);
                s.sys_max = s.sys_max.max(v["ch1"]["db"].as_i64().unwrap_or(-60) as i32);
            }
        }));
        let s = seen.clone();
        ids.push(app.listen_any("transcript:final", move |e| {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                s.lock().unwrap().finals.push(format!("{} [{}] {}", v["speaker"].as_str().unwrap_or("?"), v["ts"].as_str().unwrap_or(""), v["text"].as_str().unwrap_or("")));
            }
        }));
        let s = seen.clone();
        ids.push(app.listen_any("coaching:cards", move |e| {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                s.lock().unwrap().cards = v["cards"].as_array().map(|a| a.len()).unwrap_or(0);
            }
        }));
        let s = seen.clone();
        ids.push(app.listen_any("meeting:upload", move |e| {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                if v["state"] != "uploading" {
                    s.lock().unwrap().upload = Some(v);
                }
            }
        }));
        let s = seen.clone();
        ids.push(app.listen_any("selftest:hud", move |e| {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                s.lock().unwrap().hud = Some(v);
            }
        }));
    }

    let main = app.get_webview_window("main");
    let main_was = window::main_state(app);
    let restore_main = |app: &AppHandle| {
        if let Some(m) = app.get_webview_window("main") {
            let _ = m.unminimize();
            let _ = m.show();
        }
    };

    // 1. Minimize without a recording → nothing pops up (device test 0.6.1), restore → still off.
    if let Some(m) = &main {
        restore_main(app);
        tokio::time::sleep(Duration::from_millis(700)).await;
        *st.hud_restore.lock().unwrap() = None;
        window::switch_hud(app, "off");
        let _ = m.minimize();
        // Wait longer than the slow watcher interval (1 s) so a late switch would be seen.
        let popped = until(Duration::from_millis(1800), || hud_mode(app) != "off").await;
        rep.step(t("Minimizing without a recording shows nothing"), !popped, format!("HUD mode: {}", hud_mode(app)));
        restore_main(app);
        tokio::time::sleep(Duration::from_millis(500)).await;
        rep.step(t("Restoring leaves the HUD off"), hud_mode(app) == "off", format!("HUD mode: {}", hud_mode(app)));
    }

    // 2. Recording through the real path, with the generated audio and the chosen API.
    *st.selftest.lock().unwrap() = Some(crate::SelfTestStart { audio: source, api: api.clone() });
    let started = commands::start_recording_inner(app, &st);
    if let Err(e) = &started {
        *st.selftest.lock().unwrap() = None;
        rep.step(t("Start recording"), false, e.clone());
        for id in ids {
            app.unlisten(id);
        }
        return Ok(rep);
    }
    rep.step(t("Start recording"), true, "start_recording with the test signal instead of microphone/loopback");
    let hud_up = until(Duration::from_secs(3), || hud_mode(app) == "hud").await;
    rep.step(t("HUD appears when the recording starts"), hud_up, format!("HUD mode: {}", hud_mode(app)));

    let lv = until(Duration::from_secs(5), || {
        let s = seen.lock().unwrap();
        s.levels >= 20 && s.mic_max > -30 && s.sys_max > -30
    })
    .await;
    {
        let s = seen.lock().unwrap();
        rep.step(t("Levels of both channels (audio:levels)"), lv, format!("{} events, microphone max {} dBFS, system max {} dBFS", s.levels, s.mic_max, s.sys_max));
    }

    // 3. Minimize during the recording → pill; restore → HUD again.
    if let Some(m) = &main {
        let _ = m.minimize();
        let pill = until(Duration::from_secs(3), || hud_mode(app) == "pill").await;
        rep.step(t("Minimizing during the recording shows the pill"), pill, format!("HUD mode: {}", hud_mode(app)));
        tokio::time::sleep(Duration::from_millis(1200)).await;
        restore_main(app);
        let back = until(Duration::from_secs(3), || hud_mode(app) == "hud").await;
        rep.step(t("Restoring brings the HUD back"), back, format!("HUD mode: {}", hud_mode(app)));
    }

    // 4. Transcript and coaching (first chunk is cut in the pause at 13 s).
    let wait_audio = Duration::from_secs_f64(seconds_of_audio.min(60.0) + 20.0);
    let tr = until(wait_audio, || !seen.lock().unwrap().finals.is_empty()).await;
    {
        let s = seen.lock().unwrap();
        rep.step(t("Live transcript (transcript:final)"), tr, s.finals.first().cloned().unwrap_or_else(|| "no line".into()));
    }
    let coach = until(Duration::from_secs(if opts.online { 90 } else { 15 }), || seen.lock().unwrap().cards > 0).await;
    rep.step(t("Live coach (coaching:cards)"), coach, format!("{} cards", seen.lock().unwrap().cards));

    // 5. What the HUD renders.
    seen.lock().unwrap().hud = None;
    let _ = app.emit("selftest:probe", serde_json::json!({}));
    let probed = until(Duration::from_secs(4), || seen.lock().unwrap().hud.is_some()).await;
    let hud = seen.lock().unwrap().hud.clone().unwrap_or_default();
    let lines = hud["lines"].as_u64().unwrap_or(0);
    let cards = hud["cards"].as_u64().unwrap_or(0);
    let meters = hud["meters"].as_u64().unwrap_or(0);
    rep.step(
        t("HUD shows levels, transcript and prompts"),
        probed && hud["phase"] == "live" && meters >= 2 && lines >= 1 && cards >= 1,
        if probed { format!("phase {}, {meters} level meters, {lines} transcript lines, {cards} prompts, microphone {} dBFS", hud["phase"], hud["mic_db"]) } else { "the HUD did not answer".into() },
    );

    // 5b. The HUD's own buttons, pressed in the HUD window (the real click → set_hud_mode path).
    // `action` names the button independent of the language (`data-hud-action` in the HUD and pill);
    // `label` is its aria-label in the current language, for the report.
    for (label, want) in [(t("Minimize to pill"), "pill"), (t("Expand HUD"), "hud"), (t("Hide HUD"), "off")] {
        let _ = app.emit("selftest:click", serde_json::json!({ "label": label, "action": want }));
        let ok = until(Duration::from_secs(3), || hud_mode(app) == want).await;
        rep.step(&tf("HUD button “{label}”", &[("label", &label)]), ok, format!("HUD mode: {} (expected {want})", hud_mode(app)));
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    window::switch_hud(app, "hud");

    // 6. Stop and end of the session.
    match commands::stop_recording_inner(app, &st) {
        Ok(r) => {
            rep.step(t("Stop recording"), true, format!("{:.1} s recorded", r.seconds));
            let _ = std::fs::remove_file(&r.file);
        }
        Err(e) => rep.step(t("Stop recording"), false, e),
    }
    let done = until(Duration::from_secs(if opts.online { 120 } else { 20 }), || seen.lock().unwrap().upload.is_some()).await;
    let up = seen.lock().unwrap().upload.clone().unwrap_or_default();
    rep.step(
        t("Session closed (meeting:upload)"),
        done && up["state"] == "done",
        format!("{} · {} lines", up["state"].as_str().unwrap_or("no result"), up["segments"].as_u64().unwrap_or(0)),
    );
    if let Some(s) = &stub {
        let stats = s.stats.lock().unwrap().clone();
        rep.step(
            t("Web API calls (stub)"),
            stats.live_start == 1 && stats.transcribe >= 1 && stats.coach >= 1 && stats.live_end == 1 && stats.unauthorized == 0,
            format!("start {}, transcribe {}, append {}, coach {}, end {}, rejected {}", stats.live_start, stats.transcribe, stats.live_append, stats.coach, stats.live_end, stats.unauthorized),
        );
        rep.stub = Some(stats);
    }

    for id in ids {
        app.unlisten(id);
    }
    // Back to how it was.
    *st.hud_restore.lock().unwrap() = None;
    if main_was != window::MainState::Shown {
        if let Some(m) = &main {
            let _ = if main_was == window::MainState::Hidden { m.hide() } else { m.minimize() };
        }
    }
    rep.seconds = t0.elapsed().as_secs_f64();
    Ok(rep)
}

/// `--selftest` command line: (wav, online, report file).
pub fn cli(args: &[String]) -> Option<(Options, Option<PathBuf>)> {
    if !args.iter().any(|a| a == "--selftest") {
        return None;
    }
    let after = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).map(PathBuf::from);
    Some((Options { wav: after("--selftest-wav"), online: args.iter().any(|a| a == "--selftest-online") }, after("--selftest-report")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_signal_speaks_and_pauses_where_the_cutter_cuts() {
        let s = speechlike(SIGNAL_SECS, 140.0, 0.35);
        let at = |t: f32| (t * RATE as f32) as usize;
        let lvl = |a: usize, b: usize| dsp::level(&s[a..b]).db;
        assert!(lvl(at(1.0), at(2.0)) > -20, "loud enough to be speech: {}", lvl(at(1.0), at(2.0)));
        assert_eq!(lvl(at(13.05), at(13.55)), -60);
        // The real cutter cuts the first chunk in that pause.
        let src = tone_source();
        let mut c = live::Cutter::default();
        let mut chunks = Vec::new();
        for i in (0..src.mic.len()).step_by(dsp::FRAME_SAMPLES) {
            let end = (i + dsp::FRAME_SAMPLES).min(src.mic.len());
            let frame: Vec<i16> = (i..end).flat_map(|k| [dsp::to_i16(src.mic[k]), dsp::to_i16(src.sys[k])]).collect();
            chunks.extend(c.push(&frame));
        }
        assert_eq!(chunks.len(), 1);
        assert!((chunks[0].ch[0].len() as f32 / RATE as f32 - 13.1).abs() < 0.2);
        assert!(live::speaks(&chunks[0].ch[0]) && live::speaks(&chunks[0].ch[1]));
    }

    #[test]
    fn the_stub_answers_like_the_web_app_and_reports_the_audio_it_got() {
        let stub = start_stub().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let api = live::Api { web: stub.url.clone(), config_dir: std::env::temp_dir(), personal_token: false, token_override: Some(STUB_TOKEN.into()) };
            let v = api.post("/api/meeting/live", &serde_json::json!({ "action": "start" }), Duration::from_secs(5)).await.unwrap();
            assert_eq!(v["item_id"], STUB_ITEM);
            let client = crate::upload::http_client(Duration::from_secs(5)).unwrap();
            let samples: Vec<i16> = speechlike(2.0, 140.0, 0.35).iter().map(|&s| dsp::to_i16(s)).collect();
            let t = crate::upload::transcribe_chunk(&client, &stub.url, STUB_TOKEN, wav::mono_wav(RATE, &samples), "live-0001-ch1.wav".into(), false).await.unwrap();
            assert!(t.text.starts_with("Selbsttest Systemton: 2.0 s Audio angekommen"), "{}", t.text);
            assert_eq!(t.model.as_deref(), Some("selftest:stub"));
            let cards = live::parse_cards(&api.post("/api/meeting/coach", &serde_json::json!({ "item_id": STUB_ITEM }), Duration::from_secs(5)).await.unwrap());
            assert_eq!(cards.len(), 3);
            // A wrong token is refused like the web app does.
            let bad = live::Api { token_override: Some("kx_wrong".into()), ..api.clone() };
            let e = bad.post("/api/meeting/live", &serde_json::json!({ "action": "start" }), Duration::from_secs(5)).await.unwrap_err();
            assert_eq!(live::http_status(&e), Some(401));
        });
        let s = stub.stats.lock().unwrap();
        assert_eq!((s.live_start, s.transcribe, s.coach), (1, 1, 1));
        assert_eq!(s.audio[0].0, 1);
        assert!(s.audio[0].2 > -30);
        assert!(s.unauthorized >= 1);
    }

    #[test]
    fn command_line() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(cli(&a(&["kortex.exe"])).is_none());
        let (o, r) = cli(&a(&["kortex.exe", "--selftest", "--selftest-wav", "C:\\x.wav", "--selftest-report", "r.json"])).unwrap();
        assert_eq!(o.wav, Some(PathBuf::from("C:\\x.wav")));
        assert!(!o.online);
        assert_eq!(r, Some(PathBuf::from("r.json")));
    }
}
