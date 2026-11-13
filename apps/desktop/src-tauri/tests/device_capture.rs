//! Real-device capture test (needs a microphone and an output device, so it is opt-in):
//!
//!   cargo test --test device_capture -- --ignored --nocapture
//!
//! Plays a 440 Hz tone on the default output, records 3 s of mic + WASAPI loopback to a WAV and
//! checks both channels: ch1 must hear the tone through the loopback, ch0 must deliver samples.

use std::time::Duration;

use kortex_desktop_lib::{audio, dsp, wav};

fn rms_db(samples: &[i16]) -> i32 {
    let f: Vec<f32> = samples.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
    dsp::level(&f).db
}

#[test]
#[ignore = "needs real audio devices; run with --ignored"]
fn records_mic_and_loopback_to_a_stereo_wav() {
    let path = std::env::temp_dir().join("kortex-device-test.wav");
    let tone = audio::play_tone(440.0, 0.3).expect("play test tone");
    std::thread::sleep(Duration::from_millis(300));
    let rec = audio::start(
        audio::StartOptions { wav_path: Some(path.clone()), loopback: true, ..Default::default() },
        Box::new(|_| {}),
    )
    .expect("start capture");
    std::thread::sleep(Duration::from_secs(3));
    let summary = rec.stop().expect("stop capture");
    drop(tone);
    println!("summary: {summary:?}");

    let w = wav::read(&path).expect("read wav");
    assert_eq!((w.channels, w.rate), (2, 16_000));
    assert!(w.seconds() > 2.4, "recorded only {:.2} s", w.seconds());
    let (mic, sys) = (w.channel(0), w.channel(1));
    println!("ch0 (mic) {} dBFS, ch1 (loopback) {} dBFS over {:.2} s -> {}", rms_db(&mic), rms_db(&sys), w.seconds(), path.display());
    assert_eq!(mic.len(), sys.len());
    assert!(summary.ch1_peak_db > -40, "loopback did not hear the tone (peak {} dBFS)", summary.ch1_peak_db);
    assert!(rms_db(&sys) > -40, "loopback channel too quiet");
    assert!(summary.frames > 20, "too few frames: {}", summary.frames);
}
