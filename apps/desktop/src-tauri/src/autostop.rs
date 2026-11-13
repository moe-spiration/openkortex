//! Auto-stop of a meeting recording: after 10 minutes without sound on both channels, or after
//! 4 hours in total (a forgotten recording once ran 14 h and wrote 3.1 GB of WAV).

use crate::i18n::t;
use std::time::Duration;

use crate::dsp::LevelsPayload;

pub const SILENCE_LIMIT: Duration = Duration::from_secs(10 * 60);
pub const MAX_DURATION: Duration = Duration::from_secs(4 * 60 * 60);
/// Above this (dBFS) on either channel counts as sound. Speech sits around -35..-15, a quiet room
/// with an open mic around -55.
pub const SOUND_DB: i32 = -45;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Silence,
    MaxDuration,
}

impl Reason {
    pub fn id(self) -> &'static str {
        match self {
            Reason::Silence => "silence",
            Reason::MaxDuration => "max_duration",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Reason::Silence => t("Recording stopped automatically: 10 minutes of silence"),
            Reason::MaxDuration => t("Recording stopped automatically: 4 hours reached"),
        }
    }
}

pub fn is_sound(levels: &LevelsPayload) -> bool {
    levels.ch0.db > SOUND_DB || levels.ch1.db > SOUND_DB
}

/// Why the recording should stop now, given its length and the time since the last sound.
pub fn check(elapsed: Duration, silent_for: Duration) -> Option<Reason> {
    if elapsed >= MAX_DURATION {
        Some(Reason::MaxDuration)
    } else if silent_for >= SILENCE_LIMIT {
        Some(Reason::Silence)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::ChannelLevel;

    const MIN: u64 = 60;

    #[test]
    fn stops_after_ten_minutes_of_silence_or_four_hours() {
        assert_eq!(check(Duration::from_secs(5 * MIN), Duration::from_secs(5 * MIN)), None);
        assert_eq!(check(Duration::from_secs(30 * MIN), Duration::from_secs(10 * MIN)), Some(Reason::Silence));
        assert_eq!(check(Duration::from_secs(239 * MIN), Duration::from_secs(MIN)), None);
        assert_eq!(check(Duration::from_secs(240 * MIN), Duration::ZERO), Some(Reason::MaxDuration));
        // Both at once: the hard limit wins (the message names it).
        assert_eq!(check(Duration::from_secs(300 * MIN), Duration::from_secs(20 * MIN)), Some(Reason::MaxDuration));
    }

    #[test]
    fn sound_on_either_channel_resets_the_silence() {
        let lv = |a, b| LevelsPayload { ch0: ChannelLevel { rms: 0.0, db: a }, ch1: ChannelLevel { rms: 0.0, db: b }, mic_signal: true };
        assert!(!is_sound(&lv(-60, -60)));
        assert!(!is_sound(&lv(-50, -45)));
        assert!(is_sound(&lv(-30, -60)));
        assert!(is_sound(&lv(-60, -20)));
    }
}
