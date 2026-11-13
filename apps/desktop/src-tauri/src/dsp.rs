//! Device-free DSP core of the meeting capture: two mono inputs at their device rates in,
//! 16 kHz 2-channel interleaved i16 frames (100 ms) plus RMS levels out.
//!
//!   ch0 (left)  microphone          ch1 (right)  system audio (WASAPI loopback)
//!
//! Pure and synchronous, so it is unit-tested with synthetic signals; `audio.rs` feeds it from
//! the capture ring buffers on the DSP thread.

use rubato::{FftFixedOut, Resampler};
use serde::Serialize;

/// Target rate (linear16, 16 kHz, 2 channels).
pub const TARGET_RATE: u32 = 16_000;
/// 100 ms frames -> 1600 samples per channel.
pub const FRAME_SAMPLES: usize = (TARGET_RATE as usize) / 10;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct ChannelLevel {
    pub rms: f32,
    pub db: i32,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct LevelsPayload {
    pub ch0: ChannelLevel,
    pub ch1: ChannelLevel,
    /// false = the microphone delivered no non-zero sample for 3 s (muted or virtual device;
    /// set by audio.rs, the pipeline itself always says true).
    pub mic_signal: bool,
}

/// One 100 ms output frame.
pub struct Frame {
    /// L = ch0, R = ch1, 16-bit PCM.
    pub interleaved: Vec<i16>,
    pub levels: LevelsPayload,
}

pub fn to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

/// RMS + dBFS of one block (floor -60 dB).
pub fn level(block: &[f32]) -> ChannelLevel {
    if block.is_empty() {
        return ChannelLevel { rms: 0.0, db: -60 };
    }
    let rms = (block.iter().map(|s| s * s).sum::<f32>() / block.len() as f32).sqrt();
    let db = if rms > 0.0 { (20.0 * rms.log10()).round().max(-60.0) as i32 } else { -60 };
    ChannelLevel { rms, db }
}

/// Running RMS of one channel between two meter updates (audio.rs feeds the raw samples, so the
/// meter can update at ~30 Hz independent of the 100 ms output frames).
#[derive(Default)]
pub struct LevelMeter {
    sum: f64,
    n: usize,
}

impl LevelMeter {
    pub fn push(&mut self, samples: &[f32]) {
        self.sum += samples.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>();
        self.n += samples.len();
    }

    /// Level since the last call (silence floor when nothing arrived), then start over.
    pub fn take(&mut self) -> ChannelLevel {
        let rms = if self.n == 0 { 0.0 } else { (self.sum / self.n as f64).sqrt() as f32 };
        self.sum = 0.0;
        self.n = 0;
        let db = if rms > 0.0 { (20.0 * rms.log10()).round().max(-60.0) as i32 } else { -60 };
        ChannelLevel { rms, db }
    }
}

/// Averages interleaved frames of `channels` samples to mono.
pub fn downmix(data: &[f32], channels: usize, out: &mut Vec<f32>) {
    let ch = channels.max(1);
    out.extend(data.chunks(ch).map(|f| f.iter().sum::<f32>() / f.len() as f32));
}

struct Channel {
    rs: FftFixedOut<f32>,
    pending: Vec<f32>,
}

impl Channel {
    fn new(rate: u32) -> anyhow::Result<Self> {
        let rs = FftFixedOut::<f32>::new(rate as usize, TARGET_RATE as usize, FRAME_SAMPLES, 2, 1)
            .map_err(|e| anyhow::anyhow!("resampler {rate} Hz: {e}"))?;
        Ok(Self { rs, pending: Vec::new() })
    }

    fn ready(&self) -> bool {
        self.pending.len() >= self.rs.input_frames_next()
    }

    /// Input frames still missing for the next output chunk.
    fn missing(&self) -> usize {
        self.rs.input_frames_next().saturating_sub(self.pending.len())
    }

    fn next(&mut self) -> anyhow::Result<Vec<f32>> {
        let need = self.rs.input_frames_next();
        let out = self.rs.process(&[&self.pending[..need]], None)?;
        self.pending.drain(..need);
        Ok(out.into_iter().next().unwrap_or_default())
    }
}

/// Resamples both channels to 16 kHz and pairs them into 100 ms frames.
///
/// Loopback delivers nothing while no audio plays (and a muted mic may stall too). When one
/// channel has `pad_after_frames` frames' worth of input buffered and the other cannot make a
/// single frame, the starving channel is padded with silence so capture never stalls.
pub struct DualPipeline {
    mic: Channel,
    sys: Channel,
    pad_after_frames: usize,
}

impl DualPipeline {
    pub fn new(mic_rate: u32, sys_rate: u32) -> anyhow::Result<Self> {
        Ok(Self { mic: Channel::new(mic_rate)?, sys: Channel::new(sys_rate)?, pad_after_frames: 3 })
    }

    pub fn push_mic(&mut self, samples: &[f32]) {
        self.mic.pending.extend_from_slice(samples);
    }

    pub fn push_sys(&mut self, samples: &[f32]) {
        self.sys.pending.extend_from_slice(samples);
    }

    fn backlog_frames(c: &Channel) -> usize {
        c.pending.len() / c.rs.input_frames_next().max(1)
    }

    /// All complete frames available now.
    pub fn drain(&mut self) -> anyhow::Result<Vec<Frame>> {
        let mut frames = Vec::new();
        loop {
            match (self.mic.ready(), self.sys.ready()) {
                (true, true) => {}
                (true, false) if Self::backlog_frames(&self.mic) >= self.pad_after_frames => {
                    let n = self.sys.missing();
                    self.sys.pending.extend(std::iter::repeat(0.0).take(n));
                }
                (false, true) if Self::backlog_frames(&self.sys) >= self.pad_after_frames => {
                    let n = self.mic.missing();
                    self.mic.pending.extend(std::iter::repeat(0.0).take(n));
                }
                _ => break,
            }
            let l = self.mic.next()?;
            let r = self.sys.next()?;
            let interleaved = l.iter().zip(r.iter()).flat_map(|(&a, &b)| [to_i16(a), to_i16(b)]).collect();
            frames.push(Frame { interleaved, levels: LevelsPayload { ch0: level(&l), ch1: level(&r), mic_signal: true } });
        }
        Ok(frames)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, hz: f32, secs: f32, amp: f32) -> Vec<f32> {
        let n = (rate as f32 * secs) as usize;
        (0..n).map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin()).collect()
    }

    fn channel_rms(frames: &[Frame], ch: usize) -> f32 {
        let s: Vec<f32> = frames.iter().flat_map(|f| f.interleaved.chunks(2).map(move |p| p[ch] as f32 / i16::MAX as f32)).collect();
        level(&s).rms
    }

    #[test]
    fn level_of_silence_is_floor() {
        assert_eq!(level(&[0.0; 160]).db, -60);
    }

    #[test]
    fn level_of_full_scale_square_is_zero_db() {
        let block: Vec<f32> = (0..160).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        assert_eq!(level(&block).db, 0);
    }

    #[test]
    fn the_meter_reports_the_samples_since_the_last_update() {
        let mut m = LevelMeter::default();
        assert_eq!(m.take().db, -60);
        m.push(&[0.5, -0.5]);
        m.push(&[0.5, -0.5, 0.5]);
        assert_eq!(m.take(), level(&[0.5; 5]));
        // Reset after each update: no samples since then = the silence floor.
        assert_eq!(m.take().db, -60);
    }

    #[test]
    fn i16_conversion_clamps() {
        assert_eq!(to_i16(2.0), i16::MAX);
        assert_eq!(to_i16(-2.0), -i16::MAX);
    }

    #[test]
    fn downmix_averages_channels() {
        let mut out = Vec::new();
        downmix(&[1.0, 0.0, 0.5, 0.5], 2, &mut out);
        assert_eq!(out, vec![0.5, 0.5]);
    }

    #[test]
    fn resamples_48k_and_44k1_to_16k_stereo_frames() {
        let mut p = DualPipeline::new(48_000, 44_100).unwrap();
        p.push_mic(&sine(48_000, 440.0, 2.0, 0.5));
        p.push_sys(&sine(44_100, 1000.0, 2.0, 0.25));
        let frames = p.drain().unwrap();
        // ~2 s minus the resampler's delay; every frame is 1600 stereo pairs.
        assert!(frames.len() >= 17, "frames: {}", frames.len());
        assert!(frames.iter().all(|f| f.interleaved.len() == FRAME_SAMPLES * 2));
        // Sine RMS = amp / sqrt(2): ~0.354 and ~0.177 (skip the first frames' filter ramp-up).
        let steady = &frames[3..];
        assert!((channel_rms(steady, 0) - 0.354).abs() < 0.03, "ch0 {}", channel_rms(steady, 0));
        assert!((channel_rms(steady, 1) - 0.177).abs() < 0.03, "ch1 {}", channel_rms(steady, 1));
        assert!(steady.iter().all(|f| f.levels.ch0.db > f.levels.ch1.db));
    }

    #[test]
    fn pads_a_silent_loopback_instead_of_stalling() {
        let mut p = DualPipeline::new(48_000, 48_000).unwrap();
        p.push_mic(&sine(48_000, 440.0, 1.0, 0.5));
        let frames = p.drain().unwrap();
        assert!(frames.len() >= 6, "frames: {}", frames.len());
        assert!(frames.iter().all(|f| f.levels.ch1.db == -60));
        assert!(frames[3..].iter().all(|f| f.levels.ch0.db > -10));
    }

    #[test]
    fn waits_while_both_channels_are_short() {
        let mut p = DualPipeline::new(48_000, 48_000).unwrap();
        p.push_mic(&sine(48_000, 440.0, 0.05, 0.5));
        p.push_sys(&sine(48_000, 440.0, 0.05, 0.5));
        assert!(p.drain().unwrap().is_empty());
    }
}
