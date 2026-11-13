//! Minimal file logger: `%LOCALAPPDATA%\io.github.moe-spiration.openkortex\logs\kortex.log`.
//!
//! Before 0.6.1 no logger was installed, so every `log::warn!` (capture errors, failed
//! transcription or coaching calls) went nowhere and a broken meeting left no trace. The file is
//! rotated once it passes `MAX_BYTES` (one `kortex.old.log` is kept). Debug builds also print to
//! stderr.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_BYTES: u64 = 2 * 1024 * 1024;

struct FileLog {
    path: PathBuf,
    file: Mutex<Option<File>>,
}

impl FileLog {
    fn open(path: &Path) -> Option<File> {
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.len() > MAX_BYTES {
                let _ = std::fs::rename(path, path.with_file_name("kortex.old.log"));
            }
        }
        OpenOptions::new().create(true).append(true).open(path).ok()
    }
}

impl log::Log for FileLog {
    fn enabled(&self, m: &log::Metadata) -> bool {
        // Our own crate at info, everything else (tauri, reqwest, …) only from warn on.
        m.level() <= log::Level::Warn || (m.level() <= log::Level::Info && m.target().starts_with("kortex"))
    }

    fn log(&self, r: &log::Record) {
        if !self.enabled(r.metadata()) {
            return;
        }
        let line = format!("{} {:<5} {}: {}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"), r.level(), r.target(), r.args());
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        let mut f = self.file.lock().unwrap();
        if f.is_none() {
            *f = Self::open(&self.path);
        }
        if let Some(file) = f.as_mut() {
            if file.write_all(line.as_bytes()).is_err() {
                *f = None;
            }
        }
    }

    fn flush(&self) {
        if let Some(f) = self.file.lock().unwrap().as_mut() {
            let _ = f.flush();
        }
    }
}

/// Installs the logger once; returns the log file path (also when another logger was first).
pub fn init(dir: &Path) -> PathBuf {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join("kortex.log");
    let logger = FileLog { file: Mutex::new(FileLog::open(&path)), path: path.clone() };
    // Lives as long as the process (the logger is installed once).
    if log::set_logger(Box::leak(Box::new(logger))).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
    path
}
