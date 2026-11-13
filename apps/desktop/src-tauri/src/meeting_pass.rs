//! Final meeting pass (0.6.3, device test 0.6.2: "erkennt die Teilnehmer nicht, Qualität schwach").
//!
//! The live transcript (live.rs) works on 12-20 s chunks: good for the HUD and coaching, but a
//! chunk has too little context for a good transcript and no stable speaker numbers (whoever
//! speaks first in a chunk would be "Sprecher 1"). After "Call beenden" the recorded WAV is
//! therefore transcribed once more for the protocol:
//!
//! - **system channel (ch1)** in windows of up to 20 min (one request each, cut at the quietest
//!   moment), with diarization (`/api/chat/transcribe`, `segments=1`): every remote participant
//!   becomes "Teilnehmer 1", "Teilnehmer 2", … ("Gesprächspartner" when only one voice is heard).
//!   The numbers hold within a window; meetings up to 20 min keep them throughout.
//! - **microphone (ch0)** is always the user ("Ich"): the live lines are reused; without any, the
//!   microphone goes through the same windows (no diarization needed).
//! - **echo**: without headphones the microphone also hears the loudspeaker, which produced every
//!   remote sentence a second time as "Ich". A microphone line whose words mostly appear on the
//!   system channel at the same time is dropped (`is_echo`), live and here.
//!
//! When the pass fails, the live transcript stays (nothing is lost).

use std::path::Path;
use std::time::Duration;

use anyhow::Result;
use futures_util::stream::{self, StreamExt};

use crate::upload::{self, Segment, TimedText, CHANNEL_NAMES, SILENCE_DB};
use crate::{dsp, wav};

/// Longest window of one channel per request (16 kHz mono WAV: ~38 MB, server limit 48 MB).
pub const WINDOW_SECS: usize = 20 * 60;
/// Without a pause the window ends at the quietest 100 ms frame of its last seconds.
pub const WINDOW_LOOKBACK_SECS: usize = 30;
/// Windows transcribed at the same time.
pub const PARALLEL: usize = 2;
/// One window through an async provider job (upload + queue + transcription).
pub const PASS_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// A line of the final transcript.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub channel: usize,
    pub start_sec: f64,
    pub end_sec: f64,
    pub who: String,
    pub text: String,
}

// --- echo ------------------------------------------------------------------------------------

fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() > 1).map(|w| w.to_lowercase()).collect()
}

/// The microphone line is the loudspeaker heard again: at least 3 words, and 60 % of them also
/// in what the system channel said at the same time.
pub fn is_echo(mic: &str, system: &str) -> bool {
    let m = words(mic);
    if m.len() < 3 {
        // Two words ("ja genau") are too little to tell; keep them unless identical.
        let s = words(system);
        return !m.is_empty() && m == s;
    }
    let s: std::collections::HashSet<String> = words(system).into_iter().collect();
    if s.is_empty() {
        return false;
    }
    let hits = m.iter().filter(|w| s.contains(*w)).count();
    hits as f64 / m.len() as f64 >= 0.6
}

/// Drops microphone lines that are an echo of the system channel within ±`slack` seconds.
pub fn drop_echo(lines: Vec<Line>, slack: f64) -> Vec<Line> {
    let system: Vec<&Line> = lines.iter().filter(|l| l.channel == 1).collect();
    let keep: Vec<bool> = lines
        .iter()
        .map(|l| {
            if l.channel != 0 {
                return true;
            }
            let heard: Vec<&str> =
                system.iter().filter(|s| s.end_sec >= l.start_sec - slack && s.start_sec <= l.end_sec + slack).map(|s| s.text.as_str()).collect();
            !is_echo(&l.text, &heard.join(" "))
        })
        .collect();
    lines.into_iter().zip(keep).filter_map(|(l, k)| k.then_some(l)).collect()
}

// --- windows ---------------------------------------------------------------------------------

/// Sample ranges of one channel to transcribe: at most `max_secs` each, cut at the quietest frame
/// of the last `lookback_secs`; silent windows and tails under 1 s are skipped.
pub fn plan_windows(data: &[i16], rate: u32, max_secs: usize, lookback_secs: usize) -> Vec<(usize, usize)> {
    let rate = rate as usize;
    let frame = (rate / 10).max(1);
    let max = (max_secs * rate).max(frame);
    let mut out = Vec::new();
    let mut start = 0;
    while start < data.len() {
        let mut end = (start + max).min(data.len());
        if end < data.len() {
            let from = end.saturating_sub(lookback_secs * rate).max(start + frame);
            let mut best = (f32::MAX, end);
            let mut f = from;
            while f + frame <= end {
                let rms = rms(&data[f..f + frame]);
                if rms <= best.0 {
                    best = (rms, f + frame);
                }
                f += frame;
            }
            end = best.1;
        }
        if end - start >= rate && level_db(&data[start..end]) > SILENCE_DB {
            out.push((start, end));
        }
        start = end;
    }
    out
}

fn rms(s: &[i16]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|&x| (x as f32 / i16::MAX as f32).powi(2)).sum::<f32>() / s.len() as f32).sqrt()
}

fn level_db(s: &[i16]) -> i32 {
    let f: Vec<f32> = s.iter().map(|&x| x as f32 / i16::MAX as f32).collect();
    dsp::level(&f).db
}

// --- speakers --------------------------------------------------------------------------------

/// System-channel lines of one window → names. "Sprecher k" becomes "Teilnehmer k"; with only one
/// voice in the whole meeting (or no diarization) everyone stays "Gesprächspartner".
pub fn name_speakers(windows: Vec<(f64, Vec<TimedText>)>) -> Vec<Line> {
    let voices: std::collections::HashSet<String> =
        windows.iter().flat_map(|(_, segs)| segs.iter().filter_map(|s| s.speaker.clone())).collect();
    let several = windows.iter().any(|(_, segs)| segs.iter().filter_map(|s| s.speaker.as_deref()).collect::<std::collections::HashSet<_>>().len() > 1);
    let mut out = Vec::new();
    for (offset, segs) in windows {
        for s in segs {
            let text = s.text.trim();
            if text.is_empty() {
                continue;
            }
            let who = match (&s.speaker, several && !voices.is_empty()) {
                (Some(sp), true) => sp.replace("Sprecher", "Teilnehmer"),
                _ => CHANNEL_NAMES[1].to_string(),
            };
            let start = offset + s.start_sec;
            let end = offset + s.end_sec.unwrap_or(s.start_sec).max(s.start_sec);
            out.push(Line { channel: 1, start_sec: start, end_sec: end, who, text: text.to_string() });
        }
    }
    out
}

/// Live microphone lines (12-20 s chunks) as transcript lines; the chunk end is the next start.
pub fn mic_lines(live: &[Segment]) -> Vec<Line> {
    let mic: Vec<&Segment> = live.iter().filter(|s| s.channel == 0 && !s.text.trim().is_empty()).collect();
    mic.iter()
        .enumerate()
        .map(|(i, s)| {
            let end = mic.get(i + 1).map(|n| n.start_sec).unwrap_or(s.start_sec + crate::live::MAX_CHUNK_SECS as f64).max(s.start_sec);
            Line { channel: 0, start_sec: s.start_sec, end_sec: end.min(s.start_sec + crate::live::MAX_CHUNK_SECS as f64), who: CHANNEL_NAMES[0].into(), text: s.text.trim().into() }
        })
        .collect()
}

/// `[hh:mm:ss] Name: text` in time order (the meeting adapter's plain-text format).
pub fn format(lines: &[Line]) -> String {
    let mut v: Vec<&Line> = lines.iter().filter(|l| !l.text.trim().is_empty()).collect();
    v.sort_by(|a, b| a.start_sec.total_cmp(&b.start_sec).then(a.channel.cmp(&b.channel)));
    v.iter().map(|l| format!("[{}] {}: {}", upload::hhmmss(l.start_sec), l.who, l.text.split_whitespace().collect::<Vec<_>>().join(" "))).collect::<Vec<_>>().join("\n")
}

// --- run -------------------------------------------------------------------------------------

pub struct Pass {
    pub transcript: String,
    pub lines: usize,
    pub speakers: usize,
    /// Requests sent (windows transcribed).
    pub windows: usize,
}

/// Transcribes the WAV for the protocol (see the module doc). `live` = the live lines so far.
pub async fn run(web: &str, token: &str, wav_path: &Path, live: &[Segment]) -> Result<Pass> {
    let w = wav::read(wav_path)?;
    let client = upload::http_client(PASS_TIMEOUT)?;
    let reuse_mic = live.iter().any(|s| s.channel == 0 && !s.text.trim().is_empty());
    let mut jobs: Vec<(usize, usize, usize)> = Vec::new();
    for ch in 0..(w.channels as usize).min(2) {
        if ch == 0 && reuse_mic {
            continue;
        }
        let data = w.channel(ch);
        jobs.extend(plan_windows(&data, w.rate, WINDOW_SECS, WINDOW_LOOKBACK_SECS).into_iter().map(|(a, b)| (ch, a, b)));
    }
    let windows = jobs.len();
    log::info!("meeting pass: {windows} window(s), microphone from live lines: {reuse_mic}");
    let rate = w.rate as f64;
    let results: Vec<Result<(usize, f64, Vec<TimedText>)>> = stream::iter(jobs.into_iter().enumerate())
        .map(|(i, (ch, a, b))| {
            let bytes = wav::mono_bytes(&w, ch, a, b);
            let client = &client;
            async move {
                let t = upload::transcribe_chunk(client, web, token, bytes, format!("meeting-pass-{i:02}-ch{ch}.wav"), true).await?;
                let segs = if t.segments.is_empty() && !t.text.trim().is_empty() {
                    vec![TimedText { start_sec: 0.0, end_sec: Some((b - a) as f64 / rate), text: t.text, speaker: None }]
                } else {
                    t.segments
                };
                Ok((ch, a as f64 / rate, segs))
            }
        })
        .buffered(PARALLEL)
        .collect()
        .await;
    let mut system = Vec::new();
    let mut lines = if reuse_mic { mic_lines(live) } else { Vec::new() };
    for r in results {
        let (ch, offset, segs) = r?;
        if ch == 1 {
            system.push((offset, segs));
        } else {
            for s in segs.into_iter().filter(|s| !s.text.trim().is_empty()) {
                let end = offset + s.end_sec.unwrap_or(s.start_sec).max(s.start_sec);
                lines.push(Line { channel: 0, start_sec: offset + s.start_sec, end_sec: end, who: CHANNEL_NAMES[0].into(), text: s.text.trim().into() });
            }
        }
    }
    let system = name_speakers(system);
    let speakers = system.iter().map(|l| l.who.as_str()).collect::<std::collections::HashSet<_>>().len();
    lines.extend(system);
    let lines = drop_echo(lines, 2.0);
    Ok(Pass { transcript: format(&lines), lines: lines.len(), speakers, windows })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(channel: usize, start: f64, end: f64, who: &str, text: &str) -> Line {
        Line { channel, start_sec: start, end_sec: end, who: who.into(), text: text.into() }
    }

    fn seg(start: f64, end: f64, text: &str, speaker: Option<&str>) -> TimedText {
        TimedText { start_sec: start, end_sec: Some(end), text: text.into(), speaker: speaker.map(String::from) }
    }

    #[test]
    fn a_microphone_line_that_repeats_the_loudspeaker_is_echo() {
        assert!(is_echo("Wir sollten das Budget bis Freitag freigeben", "wir sollten das budget bis freitag freigeben, oder?"));
        // Partly heard (cut at a chunk border) still counts.
        assert!(is_echo("das Budget bis Freitag freigeben und dann", "Wir sollten das Budget bis Freitag freigeben."));
        // An answer is not an echo, even with a shared word or two.
        assert!(!is_echo("Ja, das Budget passt mir, aber erst nächste Woche", "Wir sollten das Budget bis Freitag freigeben."));
        assert!(!is_echo("Ja genau", "Wir sollten das Budget freigeben"));
        assert!(is_echo("Ja genau", "ja, genau"));
        assert!(!is_echo("Ich übernehme das Protokoll", ""));
    }

    #[test]
    fn echo_lines_go_and_answers_stay() {
        let lines = vec![
            line(1, 10.0, 14.0, "Teilnehmer 1", "Wir sollten das Budget bis Freitag freigeben."),
            line(0, 9.0, 21.0, "Ich", "wir sollten das Budget bis Freitag freigeben"),
            line(0, 21.0, 30.0, "Ich", "Einverstanden, ich schicke die Zahlen bis morgen."),
            // Same words much later: not an echo of that line.
            line(0, 300.0, 310.0, "Ich", "Wir sollten das Budget bis Freitag freigeben"),
        ];
        let kept = drop_echo(lines, 2.0);
        assert_eq!(kept.iter().map(|l| l.start_sec as u32).collect::<Vec<_>>(), vec![10, 21, 300]);
    }

    #[test]
    fn windows_end_at_the_quietest_moment_and_skip_silence() {
        let r = 100u32; // 100 Hz keeps the test small: frames of 10 samples
        let tone = |n: usize| (0..n).map(|i| if i % 2 == 0 { 8000 } else { -8000 }).collect::<Vec<i16>>();
        // 50 s speech with a quiet second at 41-42 s, then 30 s silence, then 15 s speech.
        let mut d = tone(41 * 100);
        d.extend(vec![0; 100]);
        d.extend(tone(8 * 100));
        d.extend(vec![0; 30 * 100]);
        d.extend(tone(15 * 100));
        let w = plan_windows(&d, r, 45, 10);
        // First window cut in the quiet second (at its last quiet frame), not at 45 s.
        assert_eq!(w[0].0, 0);
        assert!(w[0].1 > 41 * 100 && w[0].1 <= 42 * 100, "{:?}", w);
        // Every planned window has sound; the silent stretch alone is not sent.
        assert!(w.iter().all(|&(a, b)| level_db(&d[a..b]) > SILENCE_DB));
        assert_eq!(w.last().unwrap().1, d.len());
        // Short meetings: one window.
        assert_eq!(plan_windows(&tone(600), r, 45, 10), vec![(0, 600)]);
        assert!(plan_windows(&vec![0; 6000], r, 45, 10).is_empty());
    }

    #[test]
    fn speakers_become_participants_and_one_voice_stays_the_partner() {
        let two = name_speakers(vec![(600.0, vec![seg(1.0, 3.0, "Wer entscheidet?", Some("Sprecher 1")), seg(3.5, 5.0, "Das Board.", Some("Sprecher 2"))])]);
        assert_eq!(two.iter().map(|l| (l.who.as_str(), l.start_sec)).collect::<Vec<_>>(), vec![("Teilnehmer 1", 601.0), ("Teilnehmer 2", 603.5)]);
        let one = name_speakers(vec![(0.0, vec![seg(0.0, 2.0, "Hallo zusammen", Some("Sprecher 1"))])]);
        assert_eq!(one[0].who, "Gesprächspartner");
        let none = name_speakers(vec![(0.0, vec![seg(0.0, 2.0, "Hallo", None)])]);
        assert_eq!(none[0].who, "Gesprächspartner");
    }

    #[test]
    fn formats_in_time_order_with_names() {
        let mut lines = mic_lines(&[
            Segment { channel: 0, start_sec: 0.0, text: " Hallo ".into() },
            Segment { channel: 1, start_sec: 0.0, text: "ignored live system line".into() },
            Segment { channel: 0, start_sec: 15.0, text: "Gut, dann los.".into() },
        ]);
        assert_eq!(lines[0].end_sec, 15.0);
        lines.push(line(1, 4.0, 6.0, "Teilnehmer 2", "Hallo   zusammen"));
        assert_eq!(format(&lines), "[00:00:00] Ich: Hallo\n[00:00:04] Teilnehmer 2: Hallo zusammen\n[00:00:15] Ich: Gut, dann los.");
    }
}
