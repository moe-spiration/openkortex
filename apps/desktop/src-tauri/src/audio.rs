//! Dual-channel meeting capture (spec 02 §6.1).
//!
//!   ch0  microphone      cpal input stream on the selected input device
//!   ch1  system audio    WASAPI loopback: a cpal *input* stream built on the *output* device
//!                        (cpal's WASAPI host opens it with AUDCLNT_STREAMFLAGS_LOOPBACK)
//!
//! capture callback (any sample format, n channels) -> f32 mono -> lock-free SPSC ring (ringbuf)
//! -> DSP thread: `dsp::DualPipeline` (rubato -> 16 kHz, silence padding, 2-ch interleave)
//! -> WAV file (record-then-upload) + optional live frame channel + throttled RMS levels.
//!
//! Microphone choice (0.6.1, device test 2026-11-03): without a chosen device the Windows default
//! is only trusted when it delivers a signal. Virtual camera / mixer drivers (e.g. "EMEET Virtual
//! Audio") are often the default and deliver pure digital silence; then the next real microphone is
//! taken and the HUD says so. During a recording `mic_signal` turns false after 3 s without a single
//! non-zero sample.
//!
//! No Tauri types here: levels go to a callback, so `tests/device_capture.rs` drives the same code.

use crate::i18n::{t, tf};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use serde::Serialize;

pub use crate::dsp::{ChannelLevel, LevelsPayload, FRAME_SAMPLES, TARGET_RATE};
use crate::dsp::{downmix, DualPipeline, LevelMeter};
use crate::wav::WavWriter;

/// Emit levels at most this often (UI meters, ~30 fps).
const LEVEL_INTERVAL: Duration = Duration::from_millis(33);
/// Ring capacity per channel: 4 s at 48 kHz mono.
const RING_CAPACITY: usize = 48_000 * 4;
/// How long a microphone is listened to before it is trusted (only without a chosen device).
const PROBE: Duration = Duration::from_millis(350);
/// No non-zero microphone sample for this long: `mic_signal = false` (muted or virtual device).
const MIC_DEAD_AFTER: Duration = Duration::from_secs(3);

pub type LevelSink = Box<dyn Fn(LevelsPayload) + Send + 'static>;

/// Synthetic input instead of the devices (self-test): mono f32 per channel at `rate`, played in
/// real time, silence afterwards.
#[derive(Clone, Default)]
pub struct Synthetic {
    pub rate: u32,
    pub mic: Vec<f32>,
    pub sys: Vec<f32>,
}

/// The devices a recording really uses (shown in the HUD, logged).
#[derive(Clone, Debug, Default, Serialize)]
pub struct InUse {
    pub mic: String,
    pub sys: Option<String>,
    /// Why another microphone than the Windows default was taken (or that none had a signal).
    pub note: Option<String>,
}

#[derive(Default)]
pub struct StartOptions {
    /// Device names as reported by cpal; None = system default.
    pub input: Option<String>,
    pub output: Option<String>,
    /// Write the 16 kHz stereo recording here.
    pub wav_path: Option<PathBuf>,
    /// false = microphone only (voice notes); ch1 stays silent.
    pub loopback: bool,
    /// Also hand out the interleaved frames for live transcription (`Recorder::frames`).
    pub live_frames: bool,
    /// Self-test: generated audio instead of microphone and loopback.
    pub synthetic: Option<Synthetic>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Summary {
    pub path: Option<PathBuf>,
    pub seconds: f64,
    pub frames: usize,
    pub mic_rate: u32,
    pub sys_rate: u32,
    /// Loudest 100 ms block per channel (dBFS, floor -60).
    pub ch0_peak_db: i32,
    pub ch1_peak_db: i32,
}

/// A running recording. Call `stop` to finalize the WAV and get the summary.
pub struct Recorder {
    pub started: Instant,
    running: Arc<AtomicBool>,
    capture_thread: Option<JoinHandle<()>>,
    dsp_thread: Option<JoinHandle<Result<Summary>>>,
    /// Interleaved 2-channel 16 kHz frames (100 ms) when `live_frames` was requested.
    pub frames: Option<tokio::sync::mpsc::Receiver<Vec<i16>>>,
    pub devices: InUse,
}

impl Recorder {
    pub fn elapsed_secs(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    pub fn stop(mut self) -> Result<Summary> {
        self.running.store(false, Ordering::SeqCst);
        if let Some(t) = self.capture_thread.take() {
            let _ = t.join();
        }
        self.dsp_thread.take().ok_or_else(|| anyhow!("already stopped"))?.join().map_err(|_| anyhow!("dsp thread panicked"))?
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

/// Stops and joins the capture thread (and with it both cpal streams) unless disarmed. Keeps the
/// microphone from staying open when setup fails after the streams started (review N5 #5).
struct CaptureGuard {
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CaptureGuard {
    fn disarm(mut self) -> Option<JoinHandle<()>> {
        self.thread.take()
    }
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        if let Some(t) = self.thread.take() {
            self.running.store(false, Ordering::SeqCst);
            let _ = t.join();
        }
    }
}

/// Names of the available devices (inputs = microphones, outputs = loopback sources).
pub fn list_devices() -> Result<(Vec<String>, Vec<String>)> {
    let host = cpal::default_host();
    let inputs = host.input_devices()?.filter_map(|d| d.name().ok()).collect();
    let outputs = host.output_devices()?.filter_map(|d| d.name().ok()).collect();
    Ok((inputs, outputs))
}

/// Names of the system default devices (input, output).
pub fn default_devices() -> (Option<String>, Option<String>) {
    let host = cpal::default_host();
    (host.default_input_device().and_then(|d| d.name().ok()), host.default_output_device().and_then(|d| d.name().ok()))
}

fn find_device(mut devices: impl Iterator<Item = cpal::Device>, name: Option<&str>) -> Option<cpal::Device> {
    let name = name?;
    devices.find(|d| d.name().map(|n| n == name).unwrap_or(false))
}

/// Looks like a virtual mixer or camera driver rather than a microphone.
pub fn looks_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    ["virtual", " mix", "stereomix", "cable output", "voicemeeter"].iter().any(|k| n.contains(k))
}

/// Order in which microphones are tried without a chosen device: the Windows default first, then
/// real-looking microphones, virtual devices last.
pub fn mic_candidates(default: Option<&str>, all: &[String]) -> Vec<String> {
    let mut out: Vec<String> = default.map(|d| vec![d.to_string()]).unwrap_or_default();
    let (virt, real): (Vec<&String>, Vec<&String>) = all.iter().filter(|n| Some(n.as_str()) != default).partition(|n| looks_virtual(n));
    out.extend(real.into_iter().cloned());
    out.extend(virt.into_iter().cloned());
    out
}

/// Listens to `device` for `PROBE`: true when at least one sample is not exactly zero. Virtual
/// devices without a source (camera drivers, mixers) deliver pure digital silence.
fn probe_signal(device: &cpal::Device) -> bool {
    use std::sync::atomic::AtomicUsize;
    let Ok(config) = device.default_input_config() else { return false };
    let nonzero = Arc::new(AtomicUsize::new(0));
    let cfg: cpal::StreamConfig = config.clone().into();
    let n = nonzero.clone();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &cfg,
            move |d: &[f32], _| {
                n.fetch_add(d.iter().filter(|s| **s != 0.0).count(), Ordering::Relaxed);
            },
            |_| {},
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &cfg,
            move |d: &[i16], _| {
                n.fetch_add(d.iter().filter(|s| **s != 0).count(), Ordering::Relaxed);
            },
            |_| {},
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            &cfg,
            move |d: &[i32], _| {
                n.fetch_add(d.iter().filter(|s| **s != 0).count(), Ordering::Relaxed);
            },
            |_| {},
            None,
        ),
        _ => return true, // cannot probe this format: trust it
    };
    let Ok(stream) = stream else { return false };
    if stream.play().is_err() {
        return false;
    }
    std::thread::sleep(PROBE);
    drop(stream);
    nonzero.load(Ordering::Relaxed) > 0
}

/// The microphone to record: the chosen one, else the first candidate that delivers a signal.
fn pick_mic(host: &cpal::Host, chosen: Option<&str>) -> Result<(cpal::Device, Option<String>)> {
    if let Some(d) = find_device(host.input_devices()?, chosen) {
        return Ok((d, None));
    }
    if let Some(c) = chosen {
        log::warn!("chosen microphone {c:?} not found, trying the default");
    }
    let default = host.default_input_device();
    let default_name = default.as_ref().and_then(|d| d.name().ok());
    let names: Vec<String> = host.input_devices()?.filter_map(|d| d.name().ok()).collect();
    for name in mic_candidates(default_name.as_deref(), &names) {
        let Some(dev) = find_device(host.input_devices()?, Some(&name)) else { continue };
        if probe_signal(&dev) {
            let note = (Some(&name) != default_name.as_ref()).then(|| {
                tf("Windows default “{default}” delivers only silence, recording with “{name}”", &[("default", &default_name.clone().unwrap_or_default()), ("name", &name)])
            });
            if let Some(n) = &note {
                log::warn!("{n}");
            }
            return Ok((dev, note));
        }
        log::warn!("microphone {name:?}: digital silence, skipped");
    }
    let dev = default.ok_or_else(|| anyhow!(t("no microphone found")))?;
    Ok((dev, Some(t("No microphone delivers a signal (muted?)").into())))
}

/// Start capturing. Levels go to `on_levels` (~30 Hz).
pub fn start(opts: StartOptions, on_levels: LevelSink) -> Result<Recorder> {
    let running = Arc::new(AtomicBool::new(true));
    let (mic_prod, mic_cons) = HeapRb::<f32>::new(RING_CAPACITY).split();
    let (sys_prod, sys_cons) = HeapRb::<f32>::new(RING_CAPACITY).split();

    // Capture thread owns the cpal streams (they are !Send on WASAPI) for their whole lifetime.
    let run_c = running.clone();
    let (input, output, loopback) = (opts.input.clone(), opts.output.clone(), opts.loopback);
    let synthetic = opts.synthetic.clone();
    let (rate_tx, rate_rx) = std::sync::mpsc::channel::<Result<(u32, u32, InUse)>>();
    let capture_thread = std::thread::Builder::new().name("kortex-capture".into()).spawn(move || {
        if let Some(syn) = synthetic {
            let used = InUse { mic: t("Self-test (synthetic)").into(), sys: Some(t("Self-test (synthetic)").into()), note: None };
            let _ = rate_tx.send(Ok((syn.rate, syn.rate, used)));
            play_synthetic(&run_c, &syn, mic_prod, sys_prod);
            return;
        }
        let host = cpal::default_host();
        let opened = (|| -> Result<(cpal::Stream, Option<cpal::Stream>, u32, u32, InUse)> {
            let (mic, note) = pick_mic(&host, input.as_deref())?;
            let mic_name = mic.name().unwrap_or_default();
            let (mic_stream, mic_rate) = mono_stream(&mic, mic.default_input_config()?, mic_prod)?;
            mic_stream.play()?;
            if !loopback {
                return Ok((mic_stream, None, mic_rate, mic_rate, InUse { mic: mic_name, sys: None, note }));
            }
            let out = find_device(host.output_devices()?, output.as_deref())
                .or_else(|| host.default_output_device())
                .ok_or_else(|| anyhow!(t("no output device found for the loopback")))?;
            let sys_name = out.name().ok();
            // WASAPI loopback: input stream on an output device, using its *output* config.
            let (sys_stream, sys_rate) = mono_stream(&out, out.default_output_config()?, sys_prod)?;
            sys_stream.play()?;
            Ok((mic_stream, Some(sys_stream), mic_rate, sys_rate, InUse { mic: mic_name, sys: sys_name, note }))
        })();
        match opened {
            Ok((_mic, _sys, mic_rate, sys_rate, used)) => {
                log::info!("capture: mic {:?} @ {mic_rate} Hz, loopback {:?} @ {sys_rate} Hz", used.mic, used.sys);
                let _ = rate_tx.send(Ok((mic_rate, sys_rate, used)));
                while run_c.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(20));
                }
                // streams drop here -> capture stops
            }
            Err(e) => {
                log::error!("capture start failed: {e:#}");
                let _ = rate_tx.send(Err(e));
            }
        }
    })?;
    let guard = CaptureGuard { running: running.clone(), thread: Some(capture_thread) };
    let (mic_rate, sys_rate, devices) = rate_rx.recv().context("capture thread died")??;

    // Everything below can fail (folder not writable, unsupported rate): the guard then stops the
    // streams before the error is returned.
    let wav = match &opts.wav_path {
        Some(p) => Some(WavWriter::create(p, 2, TARGET_RATE)?),
        None => None,
    };
    let (frame_tx, frame_rx) = if opts.live_frames {
        let (tx, rx) = tokio::sync::mpsc::channel::<Vec<i16>>(64);
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };
    let pipeline = DualPipeline::new(mic_rate, sys_rate)?;
    let run_d = running.clone();
    let dsp_thread = std::thread::Builder::new().name("kortex-dsp".into()).spawn(move || {
        dsp_loop(run_d, pipeline, mic_cons, sys_cons, wav, frame_tx, on_levels, mic_rate, sys_rate)
    })?;

    Ok(Recorder { started: Instant::now(), running, capture_thread: guard.disarm(), dsp_thread: Some(dsp_thread), frames: frame_rx, devices })
}

/// Pushes the synthetic signal into the rings at real-time pace (10 ms steps), then silence.
fn play_synthetic(running: &AtomicBool, syn: &Synthetic, mut mic: HeapProd<f32>, mut sys: HeapProd<f32>) {
    let start = Instant::now();
    let mut pos = 0usize;
    while running.load(Ordering::SeqCst) {
        let due = (start.elapsed().as_secs_f64() * syn.rate as f64) as usize;
        while pos < due {
            let _ = mic.try_push(syn.mic.get(pos).copied().unwrap_or(0.0));
            let _ = sys.try_push(syn.sys.get(pos).copied().unwrap_or(0.0));
            pos += 1;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Builds an input stream for any common sample format that downmixes to mono into the ring.
fn mono_stream(device: &cpal::Device, config: cpal::SupportedStreamConfig, prod: HeapProd<f32>) -> Result<(cpal::Stream, u32)> {
    let rate = config.sample_rate().0;
    let format = config.sample_format();
    let cfg: cpal::StreamConfig = config.into();
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(device, &cfg, prod)?,
        cpal::SampleFormat::I16 => build::<i16>(device, &cfg, prod)?,
        cpal::SampleFormat::U16 => build::<u16>(device, &cfg, prod)?,
        cpal::SampleFormat::I32 => build::<i32>(device, &cfg, prod)?,
        other => return Err(anyhow!(tf("Sample format {format} is not supported", &[("format", &format!("{other:?}"))]))),
    };
    Ok((stream, rate))
}

fn build<T>(device: &cpal::Device, cfg: &cpal::StreamConfig, mut prod: HeapProd<f32>) -> Result<cpal::Stream>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = cfg.channels.max(1) as usize;
    let stream = device.build_input_stream(
        cfg,
        move |data: &[T], _| {
            for frame in data.chunks(channels) {
                let mono = frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / frame.len() as f32;
                // Ring full = DSP thread stalled: drop samples instead of blocking the audio callback.
                let _ = prod.try_push(mono);
            }
        },
        |err| log::error!("audio stream error: {err}"),
        None,
    )?;
    Ok(stream)
}

#[allow(clippy::too_many_arguments)]
fn dsp_loop(
    running: Arc<AtomicBool>,
    mut pipeline: DualPipeline,
    mut mic: HeapCons<f32>,
    mut sys: HeapCons<f32>,
    mut wav: Option<WavWriter>,
    frames: Option<tokio::sync::mpsc::Sender<Vec<i16>>>,
    on_levels: LevelSink,
    mic_rate: u32,
    sys_rate: u32,
) -> Result<Summary> {
    let mut buf = vec![0f32; 4096];
    let mut last_levels = Instant::now() - LEVEL_INTERVAL;
    let (mut count, mut peak0, mut peak1) = (0usize, -60i32, -60i32);
    let mut scratch = Vec::new();
    let mut mic_heard = Instant::now();
    let (mut meter0, mut meter1) = (LevelMeter::default(), LevelMeter::default());
    loop {
        let live = running.load(Ordering::SeqCst);
        for (cons, is_mic) in [(&mut mic, true), (&mut sys, false)] {
            loop {
                let n = cons.pop_slice(&mut buf);
                if n == 0 {
                    break;
                }
                scratch.clear();
                downmix(&buf[..n], 1, &mut scratch);
                if is_mic {
                    if scratch.iter().any(|s| *s != 0.0) {
                        mic_heard = Instant::now();
                    }
                    meter0.push(&scratch);
                    pipeline.push_mic(&scratch);
                } else {
                    meter1.push(&scratch);
                    pipeline.push_sys(&scratch);
                }
            }
        }
        for f in pipeline.drain()? {
            count += 1;
            peak0 = peak0.max(f.levels.ch0.db);
            peak1 = peak1.max(f.levels.ch1.db);
            if let Some(w) = wav.as_mut() {
                w.write(&f.interleaved)?;
            }
            if let Some(tx) = &frames {
                let _ = tx.try_send(f.interleaved);
            }
        }
        // Meters from the raw samples at ~30 Hz (the 100 ms frames alone gave ~10 Hz in bursts).
        if last_levels.elapsed() >= LEVEL_INTERVAL {
            last_levels = Instant::now();
            on_levels(LevelsPayload { ch0: meter0.take(), ch1: meter1.take(), mic_signal: mic_heard.elapsed() < MIC_DEAD_AFTER });
        }
        if !live {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let seconds = count as f64 * FRAME_SAMPLES as f64 / TARGET_RATE as f64;
    log::info!("capture stopped: {seconds:.1} s, peak mic {peak0} dBFS, peak system {peak1} dBFS");
    let path = match wav {
        Some(w) => Some(w.finish()?),
        None => None,
    };
    Ok(Summary { path, seconds, frames: count, mic_rate, sys_rate, ch0_peak_db: peak0, ch1_peak_db: peak1 })
}

/// Plays a sine on the default output device until the returned stream is dropped (device test,
/// audio setup "Testton").
pub fn play_tone(hz: f32, amplitude: f32) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let out = host.default_output_device().ok_or_else(|| anyhow!(t("no output device")))?;
    let config = out.default_output_config()?;
    let format = config.sample_format();
    let cfg: cpal::StreamConfig = config.into();
    let rate = cfg.sample_rate.0 as f32;
    let channels = cfg.channels as usize;
    let mut phase = 0f32;
    let mut next = move || {
        phase = (phase + hz / rate) % 1.0;
        amplitude * (2.0 * std::f32::consts::PI * phase).sin()
    };
    fn write<T: Sample + FromSample<f32>>(data: &mut [T], channels: usize, next: &mut impl FnMut() -> f32) {
        for frame in data.chunks_mut(channels) {
            let v = T::from_sample(next());
            frame.iter_mut().for_each(|s| *s = v);
        }
    }
    let err = |e| log::error!("tone stream error: {e}");
    let stream = match format {
        cpal::SampleFormat::F32 => out.build_output_stream(&cfg, move |d: &mut [f32], _| write(d, channels, &mut next), err, None)?,
        cpal::SampleFormat::I16 => out.build_output_stream(&cfg, move |d: &mut [i16], _| write(d, channels, &mut next), err, None)?,
        cpal::SampleFormat::U16 => out.build_output_stream(&cfg, move |d: &mut [u16], _| write(d, channels, &mut next), err, None)?,
        other => return Err(anyhow!(tf("Sample format {format} is not supported", &[("format", &format!("{other:?}"))]))),
    };
    stream.play()?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_devices_are_recognized() {
        assert!(looks_virtual("EMEET Virtual Audio (EMEET Virtual Camera)"));
        assert!(looks_virtual("Chat Mix (Elgato Virtual Audio)"));
        assert!(looks_virtual("Stream Mix (Elgato Virtual Audio)"));
        assert!(!looks_virtual("Mic In (2- Elgato Wave:3)"));
        assert!(!looks_virtual("Mikrofon (HiDock H1E)"));
        assert!(!looks_virtual("Microphone Array (Intel® Smart Sound Technologie für digitale Mikrofone)"));
    }

    #[test]
    fn the_default_comes_first_then_real_microphones_then_virtual_ones() {
        // The device list of the 2026-11-03 device test.
        let all: Vec<String> = [
            "Mic In (2- Elgato Wave:3)",
            "EMEET Virtual Audio (EMEET Virtual Camera)",
            "Stream Mix (Elgato Virtual Audio)",
            "Chat Mix (Elgato Virtual Audio)",
            "Microphone Array (Intel® Smart Sound Technologie für digitale Mikrofone)",
            "Mikrofon (HiDock H1E)",
        ]
        .map(String::from)
        .to_vec();
        let order = mic_candidates(Some("EMEET Virtual Audio (EMEET Virtual Camera)"), &all);
        assert_eq!(order[0], "EMEET Virtual Audio (EMEET Virtual Camera)");
        assert_eq!(order[1], "Mic In (2- Elgato Wave:3)");
        assert_eq!(&order[2..4], &all[4..6]);
        assert!(order[4..].iter().all(|n| looks_virtual(n)));
        assert_eq!(order.len(), all.len());
        assert_eq!(mic_candidates(None, &all[..1]), vec!["Mic In (2- Elgato Wave:3)".to_string()]);
    }

    #[test]
    fn synthetic_capture_runs_the_real_pipeline_and_flags_a_dead_microphone() {
        // 4 s: mic silent (digital zero), system a 440 Hz tone.
        let rate = 16_000;
        let sys: Vec<f32> = (0..rate * 4).map(|i| 0.3 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin()).collect();
        let syn = Synthetic { rate: rate as u32, mic: vec![0.0; rate * 4], sys };
        let seen = Arc::new(std::sync::Mutex::new(Vec::<LevelsPayload>::new()));
        let s2 = seen.clone();
        let rec = start(
            StartOptions { loopback: true, live_frames: true, synthetic: Some(syn), ..Default::default() },
            Box::new(move |l| s2.lock().unwrap().push(l)),
        )
        .unwrap();
        assert_eq!(rec.devices.mic, "Selbsttest (synthetisch)");
        std::thread::sleep(Duration::from_millis(3_800));
        let summary = rec.stop().unwrap();
        assert!(summary.frames >= 30, "frames {}", summary.frames);
        assert!(summary.ch1_peak_db > -20 && summary.ch0_peak_db == -60);
        let seen = seen.lock().unwrap();
        assert!(seen.first().unwrap().mic_signal, "trusted at the start");
        assert!(!seen.last().unwrap().mic_signal, "flagged after 3 s of digital silence");
    }
}
