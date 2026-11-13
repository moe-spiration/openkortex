//! Minimal 16-bit PCM WAV writer/reader for meeting recordings (2 ch, 16 kHz) and tests.

use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};

/// Streams interleaved i16 frames to a WAV file; sizes are patched in `finish`, or best-effort
/// on drop when recording ends with an error (disk full), so the samples written stay playable
/// (review N5 #18).
pub struct WavWriter {
    out: Option<BufWriter<File>>,
    path: PathBuf,
    channels: u16,
    data_bytes: u32,
}

/// Plausible header values; anything else is rejected instead of trusted.
pub const MAX_CHANNELS: u16 = 8;
pub const MIN_RATE: u32 = 1_000;
pub const MAX_RATE: u32 = 384_000;

impl WavWriter {
    pub fn create(path: impl AsRef<Path>, channels: u16, rate: u32) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
        }
        let mut out = BufWriter::new(File::create(&path).with_context(|| format!("create {}", path.display()))?);
        let block = channels * 2;
        out.write_all(b"RIFF")?;
        out.write_all(&0u32.to_le_bytes())?; // patched
        out.write_all(b"WAVEfmt ")?;
        out.write_all(&16u32.to_le_bytes())?;
        out.write_all(&1u16.to_le_bytes())?; // PCM
        out.write_all(&channels.to_le_bytes())?;
        out.write_all(&rate.to_le_bytes())?;
        out.write_all(&(rate * block as u32).to_le_bytes())?;
        out.write_all(&block.to_le_bytes())?;
        out.write_all(&16u16.to_le_bytes())?;
        out.write_all(b"data")?;
        out.write_all(&0u32.to_le_bytes())?; // patched
        Ok(Self { out: Some(out), path, channels, data_bytes: 0 })
    }

    pub fn write(&mut self, interleaved: &[i16]) -> Result<()> {
        let out = self.out.as_mut().ok_or_else(|| anyhow!("wav already finished"))?;
        let mut bytes = Vec::with_capacity(interleaved.len() * 2);
        for s in interleaved {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        out.write_all(&bytes)?;
        self.data_bytes = self.data_bytes.saturating_add(bytes.len() as u32);
        Ok(())
    }

    fn patch_header(out: BufWriter<File>, data_bytes: u32) -> Result<()> {
        let mut f = out.into_inner().map_err(|e| anyhow!("flush wav: {e}"))?;
        f.seek(SeekFrom::Start(4))?;
        f.write_all(&36u32.saturating_add(data_bytes).to_le_bytes())?;
        f.seek(SeekFrom::Start(40))?;
        f.write_all(&data_bytes.to_le_bytes())?;
        f.sync_all()?;
        Ok(())
    }

    pub fn seconds(&self, rate: u32) -> f64 {
        self.data_bytes as f64 / (rate as f64 * self.channels as f64 * 2.0)
    }

    pub fn finish(mut self) -> Result<PathBuf> {
        let out = self.out.take().ok_or_else(|| anyhow!("wav already finished"))?;
        Self::patch_header(out, self.data_bytes)?;
        Ok(self.path.clone())
    }
}

impl Drop for WavWriter {
    fn drop(&mut self) {
        if let Some(out) = self.out.take() {
            if let Err(e) = Self::patch_header(out, self.data_bytes) {
                log::error!("could not finalize {}: {e:#}", self.path.display());
            }
        }
    }
}

/// A decoded WAV file (16-bit PCM only).
#[derive(Debug)]
pub struct Wav {
    pub channels: u16,
    pub rate: u32,
    /// Interleaved samples.
    pub samples: Vec<i16>,
}

impl Wav {
    /// Samples of one channel (empty for a missing channel or a broken header).
    pub fn channel(&self, ch: usize) -> Vec<i16> {
        if self.channels == 0 || ch >= self.channels as usize {
            return Vec::new();
        }
        self.samples.chunks_exact(self.channels as usize).map(|f| f[ch]).collect()
    }

    pub fn seconds(&self) -> f64 {
        if self.rate == 0 || self.channels == 0 {
            return 0.0;
        }
        self.samples.len() as f64 / (self.rate as f64 * self.channels as f64)
    }
}

pub fn read(path: impl AsRef<Path>) -> Result<Wav> {
    let mut bytes = Vec::new();
    File::open(path.as_ref())?.read_to_end(&mut bytes)?;
    parse(&bytes)
}

/// Parses a 16-bit PCM WAV. Malformed headers are errors, never panics or endless loops
/// (review N5 #4): short or missing `fmt`, channels outside 1..=8, implausible rates, other bit
/// depths, and chunk lengths that overflow or point past the end.
pub fn parse(bytes: &[u8]) -> Result<Wav> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        bail!("not a RIFF/WAVE file");
    }
    let mut fmt: Option<(u16, u32)> = None;
    let mut i: usize = 12;
    while let Some(header_end) = i.checked_add(8).filter(|e| *e <= bytes.len()) {
        let id = &bytes[i..i + 4];
        let len = u32::from_le_bytes([bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]]) as usize;
        // A data chunk may be cut short (recording ended badly): read what is there.
        let body_end = header_end.checked_add(len).map_or(bytes.len(), |e| e.min(bytes.len()));
        let body = &bytes[header_end..body_end];
        if id == b"fmt " {
            if body.len() < 16 {
                bail!("fmt chunk too short ({} bytes)", body.len());
            }
            let format = u16::from_le_bytes([body[0], body[1]]);
            let channels = u16::from_le_bytes([body[2], body[3]]);
            let rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            let bits = u16::from_le_bytes([body[14], body[15]]);
            if format != 1 && format != 0xFFFE {
                bail!("only PCM is supported (format {format})");
            }
            if channels == 0 || channels > MAX_CHANNELS {
                bail!("unsupported channel count {channels}");
            }
            if !(MIN_RATE..=MAX_RATE).contains(&rate) {
                bail!("implausible sample rate {rate}");
            }
            if bits != 16 {
                bail!("only 16-bit PCM is supported ({bits} bit)");
            }
            fmt = Some((channels, rate));
        } else if id == b"data" {
            let (channels, rate) = fmt.ok_or_else(|| anyhow!("data chunk before fmt"))?;
            let samples = body.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
            return Ok(Wav { channels, rate, samples });
        }
        // Next chunk (word aligned); stop on overflow instead of wrapping.
        match header_end.checked_add(len).and_then(|e| e.checked_add(len & 1)) {
            Some(next) if next > i => i = next,
            _ => break,
        }
    }
    bail!("no data chunk")
}

/// One channel of an interleaved WAV as its own mono WAV (for per-channel transcription).
pub fn mono_bytes(wav: &Wav, ch: usize, from_sample: usize, to_sample: usize) -> Vec<u8> {
    let data: Vec<i16> = wav.channel(ch);
    let from = from_sample.min(data.len());
    mono_wav(wav.rate, &data[from..to_sample.clamp(from, data.len())])
}

/// 16-bit PCM mono WAV file bytes (live transcription chunks).
pub fn mono_wav(rate: u32, slice: &[i16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(44 + slice.len() * 2);
    let len = (slice.len() * 2) as u32;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&len.to_le_bytes());
    for s in slice {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_reads_back_a_stereo_file() {
        let dir = std::env::temp_dir().join(format!("kortex-wav-test-{}", std::process::id()));
        let path = dir.join("t.wav");
        let mut w = WavWriter::create(&path, 2, 16_000).unwrap();
        w.write(&[1, -1, 2, -2, 3, -3]).unwrap();
        assert!((w.seconds(16_000) - 3.0 / 16_000.0).abs() < 1e-9);
        let p = w.finish().unwrap();
        let wav = read(&p).unwrap();
        assert_eq!((wav.channels, wav.rate), (2, 16_000));
        assert_eq!(wav.channel(0), vec![1, 2, 3]);
        assert_eq!(wav.channel(1), vec![-1, -2, -3]);
        let mono = parse(&mono_bytes(&wav, 1, 1, 3)).unwrap();
        assert_eq!((mono.channels, mono.samples), (1, vec![-2, -3]));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A valid 16 kHz stereo file with two frames; tests patch single fields.
    fn sample() -> Vec<u8> {
        let mut b = b"RIFF".to_vec();
        b.extend_from_slice(&44u32.to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes()); // 20: format
        b.extend_from_slice(&2u16.to_le_bytes()); // 22: channels
        b.extend_from_slice(&16_000u32.to_le_bytes()); // 24: rate
        b.extend_from_slice(&64_000u32.to_le_bytes()); // 28: byte rate
        b.extend_from_slice(&4u16.to_le_bytes()); // 32: block align
        b.extend_from_slice(&16u16.to_le_bytes()); // 34: bits
        b.extend_from_slice(b"data");
        b.extend_from_slice(&8u32.to_le_bytes()); // 40: data length
        for s in [1i16, -1, 2, -2] {
            b.extend_from_slice(&s.to_le_bytes());
        }
        b
    }

    #[test]
    fn sample_fixture_is_valid() {
        let w = parse(&sample()).unwrap();
        assert_eq!((w.channels, w.rate, w.samples.len()), (2, 16_000, 4));
    }

    #[test]
    fn rejects_broken_headers_without_panicking() {
        let mut zero_rate = sample();
        zero_rate[24..28].copy_from_slice(&0u32.to_le_bytes());
        assert!(parse(&zero_rate).unwrap_err().to_string().contains("sample rate"));

        let mut zero_channels = sample();
        zero_channels[22..24].copy_from_slice(&0u16.to_le_bytes());
        assert!(parse(&zero_channels).unwrap_err().to_string().contains("channel"));

        let mut huge_rate = sample();
        huge_rate[24..28].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(parse(&huge_rate).is_err());

        let mut eight_bit = sample();
        eight_bit[34..36].copy_from_slice(&8u16.to_le_bytes());
        assert!(parse(&eight_bit).is_err());

        // fmt chunk claiming 4 bytes, file ends inside it.
        let mut short_fmt = sample();
        short_fmt[16..20].copy_from_slice(&4u32.to_le_bytes());
        short_fmt.truncate(28);
        assert!(parse(&short_fmt).unwrap_err().to_string().contains("too short"));

        assert!(parse(b"RIFF\0\0\0\0WAVE").is_err());
        assert!(parse(b"nope").is_err());
        assert!(parse(&[]).is_err());
    }

    #[test]
    fn survives_overflowing_and_truncated_chunk_lengths() {
        // A junk chunk with length u32::MAX before fmt: no wrap-around, just "no data chunk".
        let mut b = b"RIFF\0\0\0\0WAVE".to_vec();
        b.extend_from_slice(b"junk");
        b.extend_from_slice(&u32::MAX.to_le_bytes());
        b.extend_from_slice(&[0; 16]);
        assert!(parse(&b).is_err());

        // data length larger than the file (recording cut off): the samples present are read.
        let mut cut = sample();
        cut[40..44].copy_from_slice(&1_000_000u32.to_le_bytes());
        assert_eq!(parse(&cut).unwrap().samples, vec![1, -1, 2, -2]);

        // data before fmt.
        let mut b = b"RIFF\0\0\0\0WAVE".to_vec();
        b.extend_from_slice(b"data");
        b.extend_from_slice(&2u32.to_le_bytes());
        b.extend_from_slice(&[1, 0]);
        assert!(parse(&b).unwrap_err().to_string().contains("before fmt"));
    }

    #[test]
    fn channel_access_is_bounds_checked() {
        let w = Wav { channels: 2, rate: 16_000, samples: vec![1, 2, 3, 4] };
        assert_eq!(w.channel(5), Vec::<i16>::new());
        assert_eq!(Wav { channels: 0, rate: 0, samples: vec![1] }.channel(0), Vec::<i16>::new());
        assert_eq!(Wav { channels: 0, rate: 0, samples: vec![1] }.seconds(), 0.0);
    }

    #[test]
    fn a_dropped_writer_still_leaves_a_valid_header() {
        let dir = std::env::temp_dir().join(format!("kortex-wav-drop-{}", std::process::id()));
        let path = dir.join("cut.wav");
        {
            let mut w = WavWriter::create(&path, 2, 16_000).unwrap();
            w.write(&[5, -5, 6, -6]).unwrap();
            // dropped without finish(), as after a write error
        }
        let wav = read(&path).unwrap();
        assert_eq!(wav.samples, vec![5, -5, 6, -6]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
