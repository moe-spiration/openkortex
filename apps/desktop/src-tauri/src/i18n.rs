//! The core's user-visible texts in two languages (tray tooltip, notifications, window titles,
//! dialog titles, error texts that reach a window). Same idea as `@kortex/i18n` on the React side:
//! English is the source and the key, `t("…")` looks up the German text for it, a missing entry
//! falls back to English. Log lines are not translated (English only).
//!
//! The language is one value for the whole process: the stored choice (desktop.json `locale`,
//! Settings → Language) or, without one, the Windows display language. `{name}` placeholders are
//! filled by `tf`. The test at the bottom reads the sources and fails when a `t("…")` / `tf("…")`
//! text has no German entry, an entry is unused, or the placeholders of a pair differ.

use std::collections::HashMap;
use std::fmt::Display;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

/// Display name of the product: "Kortex" in the private build, the open-source export writes its own
/// into packages/i18n/product.json (read by build.rs). Every text from `t`/`tf` shows it in place of
/// the word "Kortex"; technical ids (KortexVault, kortex://) are no whole word and stay.
pub const PRODUCT_NAME: &str = env!("KORTEX_PRODUCT_NAME");

/// Replaces the whole word "Kortex" (not in KortexVault or X-Kortex-…) with `name`.
pub fn brand_with(name: &str, text: &str) -> String {
    if name == "Kortex" {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut prev: Option<char> = None;
    while let Some(i) = rest.find("Kortex") {
        let before = rest[..i].chars().last().or(prev);
        let after = rest[i + 6..].chars().next();
        let word_char = |c: char| c.is_alphanumeric() || c == '_';
        let whole = !before.is_some_and(|c| word_char(c) || c == '-') && !after.is_some_and(word_char);
        out.push_str(&rest[..i]);
        out.push_str(if whole { name } else { "Kortex" });
        prev = Some('x');
        rest = &rest[i + 6..];
    }
    out.push_str(rest);
    out
}

/// `text` with the product name, as a static string (the set of texts is fixed, so each is built once).
/// Tests always run with "Kortex", so the same expectations hold in the open-source export.
fn brand(text: &'static str) -> &'static str {
    if cfg!(test) || PRODUCT_NAME == "Kortex" || !text.contains("Kortex") {
        return text;
    }
    static CACHE: OnceLock<Mutex<HashMap<&'static str, &'static str>>> = OnceLock::new();
    let mut cache = CACHE.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    cache.entry(text).or_insert_with(|| Box::leak(brand_with(PRODUCT_NAME, text).into_boxed_str()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    En,
    De,
}

impl Locale {
    pub fn code(self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::De => "de",
        }
    }

    /// Exactly "en" or "de" (the stored choice, the `set_locale` argument).
    pub fn parse(value: &str) -> Option<Locale> {
        match value.trim() {
            "en" => Some(Locale::En),
            "de" => Some(Locale::De),
            _ => None,
        }
    }

    /// A language tag of the system ("de", "de-AT", "de_DE.UTF-8" → German; anything else → English).
    pub fn from_tag(tag: &str) -> Locale {
        let t = tag.trim().to_ascii_lowercase();
        if t == "de" || t.starts_with("de-") || t.starts_with("de_") || t.starts_with("de.") {
            Locale::De
        } else {
            Locale::En
        }
    }
}

/// Tests run in German, like the vitest setup of the React side (`setLocale("de")`).
static CURRENT: AtomicU8 = AtomicU8::new(if cfg!(test) { 1 } else { 0 });

pub fn locale() -> Locale {
    if CURRENT.load(Ordering::Relaxed) == 1 {
        Locale::De
    } else {
        Locale::En
    }
}

pub fn set_locale(locale: Locale) {
    CURRENT.store(if locale == Locale::De { 1 } else { 0 }, Ordering::Relaxed);
}

/// Start-up: the stored choice wins, else the system language (German, or English for all others).
pub fn init(stored: Option<&str>) -> Locale {
    let locale = stored.and_then(Locale::parse).unwrap_or_else(system_locale);
    set_locale(locale);
    locale
}

/// Windows display language of the user. Declared here because the `windows` crate is built
/// without its Globalization feature; the call takes no arguments and cannot fail.
#[cfg(windows)]
pub fn system_locale() -> Locale {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
    }
    // SAFETY: no arguments, no pointers; returns a LANGID.
    let langid = unsafe { GetUserDefaultUILanguage() };
    // Primary language = the low 10 bits; LANG_GERMAN is 0x07.
    if langid & 0x03ff == 0x07 {
        Locale::De
    } else {
        Locale::En
    }
}

#[cfg(not(windows))]
pub fn system_locale() -> Locale {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .find(|v| !v.trim().is_empty())
        .map(|v| Locale::from_tag(&v))
        .unwrap_or(Locale::En)
}

/// The text in the current language.
pub fn t(en: &'static str) -> &'static str {
    t_for(locale(), en)
}

pub fn t_for(locale: Locale, en: &'static str) -> &'static str {
    brand(match locale {
        Locale::En => en,
        Locale::De => DE.iter().find(|(source, _)| *source == en).map(|(_, de)| *de).unwrap_or(en),
    })
}

/// The text in the current language with its `{name}` placeholders filled.
pub fn tf(en: &'static str, args: &[(&str, &(dyn Display + Sync))]) -> String {
    tf_for(locale(), en, args)
}

pub fn tf_for(locale: Locale, en: &'static str, args: &[(&str, &(dyn Display + Sync))]) -> String {
    let mut out = t_for(locale, en).to_string();
    for (name, value) in args {
        out = out.replace(&format!("{{{name}}}"), &value.to_string());
    }
    out
}

/// English source → German. Keep the German wording as it was before the app became bilingual.
const DE: &[(&str, &str)] = &[
    ("Windows default “{default}” delivers only silence, recording with “{name}”", "Windows-Standard „{default}“ liefert nur Stille, aufgenommen wird „{name}“"),
    ("no microphone found", "kein Mikrofon gefunden"),
    ("No microphone delivers a signal (muted?)", "Kein Mikrofon liefert ein Signal (stummgeschaltet?)"),
    ("Self-test (synthetic)", "Selbsttest (synthetisch)"),
    ("no output device found for the loopback", "kein Ausgabegerät für den Loopback gefunden"),
    ("Sample format {format} is not supported", "Sample-Format {format} wird nicht unterstützt"),
    ("no output device", "kein Ausgabegerät"),
    ("Autostart is only available on Windows so far", "Autostart gibt es bisher nur unter Windows"),
    ("Recording stopped automatically: 10 minutes of silence", "Aufnahme automatisch beendet: 10 Minuten Stille"),
    ("Recording stopped automatically: 4 hours reached", "Aufnahme automatisch beendet: 4 Stunden erreicht"),
    ("File is not in the recordings folder", "Datei liegt nicht im Aufnahmeordner"),
    ("Only WAV recordings can be uploaded", "Nur WAV-Aufnahmen können hochgeladen werden"),
    ("No recording is running", "Es läuft keine Aufnahme"),
    ("Kortex self-test", "Kortex Selbsttest"),
    ("Recording is local only: web address invalid (settings)", "Aufnahme nur lokal: Web-Adresse ungültig (Einstellungen)"),
    ("Recording is local only: no account connected, so no transcript and no minutes", "Aufnahme nur lokal: kein Konto verbunden, also kein Transkript und kein Protokoll"),
    ("The minutes are being created.", "Das Protokoll wird erstellt."),
    ("The recording is stored locally in the recordings folder.", "Die Aufnahme liegt lokal im Aufnahmeordner."),
    ("No recording file", "Keine Aufnahmedatei"),
    ("No account connected (Settings → Connect account)", "Kein Konto verbunden (Einstellungen → Konto verbinden)"),
    ("Server not reachable. Check the address and the connection.", "Server nicht erreichbar. Adresse und Verbindung prüfen."),
    ("No Kortex answers at this address (HTTP {status})", "Unter dieser Adresse antwortet kein Kortex (HTTP {status})"),
    ("No Kortex answers at this address", "Unter dieser Adresse antwortet kein Kortex"),
    ("Ingest failed ({status}): {message}", "Ingest fehlgeschlagen ({status}): {message}"),
    ("Search: {error}", "Suche: {error}"),
    ("Please enter a question", "Bitte eine Frage eingeben"),
    ("Nothing to insert", "Nichts zum Einfügen"),
    ("Select text in another app first", "Erst Text in einer anderen App markieren"),
    ("No voice note active", "Keine Sprachnotiz aktiv"),
    ("invalid item ID", "ungültige Item-ID"),
    ("Meeting center", "Meeting-Center"),
    ("Audio setup", "Audio-Setup"),
    ("Settings", "Einstellungen"),
    ("No connection link pending", "Kein Verbindungslink offen"),
    ("Kortex is about to quit", "Kortex beendet sich gleich"),
    ("The running recording is being finished and uploaded first.", "Die laufende Aufnahme wird noch abgeschlossen und hochgeladen."),
    ("Choose vault folder", "Vault-Ordner wählen"),
    ("The folder is not empty ({n} entries) and not a Kortex vault yet.", "Der Ordner ist nicht leer ({n} Einträge) und noch kein Kortex-Vault."),
    ("Log folder not found", "Log-Ordner nicht gefunden"),
    ("No vault folder chosen yet", "Noch kein Vault-Ordner gewählt"),
    ("unknown target {target}", "unbekanntes Ziel {target}"),
    ("No Kortex server set up (Settings → Server)", "Kein Kortex-Server eingerichtet (Einstellungen → Server)"),
    ("invalid URL: {url}", "ungültige URL: {url}"),
    ("{url}: only https:// (or http://localhost) is allowed, not {scheme}://", "{url}: nur https:// (oder http://localhost) ist erlaubt, nicht {scheme}://"),
    ("{url}: host is missing", "{url}: Host fehlt"),
    ("invalid link", "ungültiger Link"),
    ("not a kortex:// link", "kein kortex://-Link"),
    ("unknown link: kortex://{target}", "unbekannter Link: kortex://{target}"),
    ("The link contains no valid Kortex token", "Link enthält kein gültiges Kortex-Token"),
    ("Timeout while connecting", "Zeitüberschreitung beim Verbinden"),
    ("Deepgram connection lost: {error}", "Deepgram-Verbindung getrennt: {error}"),
    ("Deepgram disconnected, retrying ({attempt}/5)", "Deepgram getrennt, neuer Versuch ({attempt}/5)"),
    ("Deepgram not reachable, continuing through your Kortex routing", "Deepgram nicht erreichbar, weiter über Dein Kortex-Routing"),
    ("Deepgram not reachable; without an account the recording stays local", "Deepgram nicht erreichbar; ohne Konto bleibt die Aufnahme lokal"),
    ("Keystroke was blocked (SendInput: {sent}/{total})", "Tastendruck wurde blockiert (SendInput: {sent}/{total})"),
    ("The clipboard is currently in use by another app", "Die Zwischenablage ist gerade von einer anderen App belegt"),
    ("GlobalLock failed", "GlobalLock fehlgeschlagen"),
    ("Clipboard only on Windows", "Zwischenablage nur unter Windows"),
    ("Pasting only on Windows", "Einfügen nur unter Windows"),
    ("Grabbing the selection only on Windows", "Markierung übernehmen nur unter Windows"),
    ("The copilot is not reachable right now", "Der Copilot ist gerade nicht erreichbar"),
    ("No answer received", "Keine Antwort erhalten"),
    ("not signed in", "nicht angemeldet"),
    ("This API token may not ask. In the web app under Settings → Personal API tokens create a new token with “May also search and ask in the vault” and connect it here.", "Dieses API-Token darf nicht fragen. In der Web-App unter Einstellungen → Persönliche API-Tokens ein neues Token mit „Darf auch im Vault suchen und fragen“ erstellen und hier verbinden."),
    ("Live coaching needs an API token with “May also search and ask in the vault” (web app → Settings → Personal API tokens). Transcript and minutes continue.", "Live-Coaching braucht ein API-Token mit „Darf auch im Vault suchen und fragen“ (Web-App → Einstellungen → Persönliche API-Tokens). Transkript und Protokoll laufen weiter."),
    ("Response without item_id", "Antwort ohne item_id"),
    ("Not connected to Kortex yet", "Noch nicht mit Kortex verbunden"),
    ("No new conversation for prompts yet", "Noch kein neues Gespräch für Impulse"),
    ("Not connected to Kortex yet, the clip stays in the HUD only", "Noch nicht mit Kortex verbunden, der Clip bleibt nur im HUD"),
    ("Kortex · Page changed", "Kortex · Seite geändert"),
    ("Kortex · Reminder", "Kortex · Erinnerung"),
    ("Untitled", "Ohne Titel"),
    ("Kortex · {n} reminders due", "Kortex · {n} Erinnerungen fällig"),
    ("This is not a Kortex API token (kx_…, Settings → Personal API tokens)", "Das ist kein Kortex-API-Token (kx_…, Einstellungen → Persönliche API-Tokens)"),
    ("API token “{name}”", "API-Token „{name}“"),
    ("{from} is taken, Kortex uses {to}", "{from} ist belegt, Kortex nutzt {to}"),
    ("not available: {keys}", "nicht verfügbar: {keys}"),
    ("Kortex: hotkey taken", "Kortex: Tastenkürzel belegt"),
    ("Kortex · Recording (Ctrl+Shift+R stops)", "Kortex · Aufnahme läuft (Ctrl+Shift+R beendet)"),
    ("Supabase anon key is missing (supabaseAnonKey in desktop.json)", "Supabase-Anon-Key fehlt (supabaseAnonKey in desktop.json)"),
    ("Supabase not reachable", "Supabase nicht erreichbar"),
    ("Sign-in failed ({status}): {message}", "Anmeldung fehlgeschlagen ({status}): {message}"),
    ("Transcription not reachable: {error}", "Transkription nicht erreichbar: {error}"),
    ("Transcription failed ({status}): {message}", "Transkription fehlgeschlagen ({status}): {message}"),
    ("Voice note {time}", "Sprachnotiz {time}"),
    ("Nothing understood: the voice note contains no speech", "Nichts verstanden: die Sprachnotiz enthält keine Sprache"),
    ("API token refused ({status}): {message}", "API-Token abgelehnt ({status}): {message}"),
    ("Nothing understood: the recording contains no speech", "Nichts verstanden: die Aufnahme enthält keine Sprache"),
    ("Setting is faulty: {reason}", "Einstellung fehlerhaft: {reason}"),
    ("unknown", "unbekannt"),
    ("The token does not allow vault sync or was revoked ({reason}). In the web app under Settings → Connectors choose “Connect with Windows app” again.", "Das Token erlaubt keinen Vault-Sync oder wurde widerrufen ({reason}). In der Web-App unter Einstellungen → Connectors erneut „Mit Windows-App verbinden“."),
    ("refused", "abgelehnt"),
    ("The server does not know vault sync yet (web app 0.6.0 or later)", "Der Server kennt den Vault-Sync noch nicht (Web-App ab 0.6.0)"),
    ("Another md-sync is already running on this vault", "Auf diesem Vault läuft schon ein anderer md-sync"),
    ("Please choose a full path (for example C:\\Users\\You\\KortexVault).", "Bitte einen vollständigen Pfad wählen (z. B. C:\\Users\\Du\\KortexVault)."),
    ("A whole drive cannot be a vault. Please choose a subfolder.", "Ein ganzes Laufwerk kann kein Vault sein. Bitte einen Unterordner wählen."),
    ("The user folder itself is too large. Please choose a subfolder, for example KortexVault.", "Der Benutzerordner selbst ist zu groß. Bitte einen Unterordner wählen, z. B. KortexVault."),
    ("System folders are not allowed as a vault.", "Systemordner sind als Vault nicht erlaubt."),
    ("Folder not readable: {error}", "Ordner nicht lesbar: {error}"),
    ("This is a file, not a folder.", "Das ist eine Datei, kein Ordner."),
    ("Connect an account, then the vault sync starts.", "Konto verbinden, dann startet der Vault-Sync."),
    ("Signed in with email: the vault sync needs the token from “Connect with Windows app” (web app → Settings → Connectors).", "Mit E-Mail angemeldet: Der Vault-Sync braucht das Token aus „Mit Windows-App verbinden“ (Web-App → Einstellungen → Connectors)."),
    ("App folder not found", "App-Ordner nicht gefunden"),
    ("Token not readable (Windows Credential Manager)", "Token nicht lesbar (Windows-Anmeldeinformationsverwaltung)"),
    ("The sync module is missing: run `node scripts/build-sidecar.mjs` in apps/desktop.", "Das Sync-Modul fehlt: in apps/desktop `node scripts/build-sidecar.mjs` ausführen."),
    ("The sync module is missing in this installation (sidecar/md-sync.mjs). Please reinstall Kortex.", "Das Sync-Modul fehlt in dieser Installation (sidecar/md-sync.mjs). Bitte Kortex neu installieren."),
    ("md-sync does not start ({path}): {error}", "md-sync startet nicht ({path}): {error}"),
    ("md-sync exited (code {code})", "md-sync beendet (Code {code})"),
    ("{message}. Retrying in {seconds} s.", "{message}. Neuer Versuch in {seconds} s."),
    ("The vault sync is not running right now", "Der Vault-Sync läuft gerade nicht"),
    ("Create folder: {error}", "Ordner anlegen: {error}"),
    ("{path} does not exist yet", "{path} gibt es noch nicht"),
    ("invalid WAV file", "ungültige WAV-Datei"),
    ("Microphone", "Mikrofon"),
    ("System audio", "Systemton"),
    ("Self-test {who}: {seconds} s of audio arrived, level {db} dBFS.", "Selbsttest {who}: {seconds} s Audio angekommen, Pegel {db} dBFS."),
    ("Self-test: {n} transcript sections reached the coach.", "Selbsttest: {n} Transkript-Abschnitte haben den Coach erreicht."),
    ("Self-test: do levels, transcript and prompts arrive in the HUD?", "Selbsttest: Kommen Pegel, Transkript und Impulse im HUD an?"),
    ("Finish the self-test and start a real meeting", "Selbsttest abschließen und echtes Meeting starten"),
    ("The self-test is already running", "Der Selbsttest läuft schon"),
    ("Self-test passed: {n} checks", "Selbsttest bestanden: {n} Prüfungen"),
    ("Self-test: {failed} of {total} checks failed ({names})", "Selbsttest: {failed} von {total} Prüfungen fehlgeschlagen ({names})"),
    ("No self-test possible during a recording", "Während einer Aufnahme ist kein Selbsttest möglich"),
    ("Test signal {seconds} s (speech-like, both channels)", "Testsignal {seconds} s (sprachähnlich, beide Kanäle)"),
    ("The online self-test needs a connected account: {error}", "Online-Selbsttest braucht ein verbundenes Konto: {error}"),
    ("Minimizing without a recording shows nothing", "Minimieren ohne Aufnahme zeigt nichts"),
    ("Restoring leaves the HUD off", "Wiederherstellen lässt das HUD aus"),
    ("Start recording", "Aufnahme starten"),
    ("HUD appears when the recording starts", "HUD erscheint beim Aufnahmestart"),
    ("Levels of both channels (audio:levels)", "Pegel beider Kanäle (audio:levels)"),
    ("Minimizing during the recording shows the pill", "Minimieren während der Aufnahme zeigt die Pill"),
    ("Restoring brings the HUD back", "Wiederherstellen bringt das HUD zurück"),
    ("Live transcript (transcript:final)", "Live-Transkript (transcript:final)"),
    ("Live coach (coaching:cards)", "Live-Coach (coaching:cards)"),
    ("HUD shows levels, transcript and prompts", "HUD zeigt Pegel, Transkript und Impulse"),
    ("Collapse to the bar", "Auf die Leiste einklappen"),
    ("Show transcript and coaching", "Transkript und Coaching zeigen"),
    ("Hide HUD", "HUD ausblenden"),
    ("HUD button “{label}”", "HUD-Knopf „{label}“"),
    ("Stop recording", "Aufnahme beenden"),
    ("Session closed (meeting:upload)", "Session abgeschlossen (meeting:upload)"),
    ("Web API calls (stub)", "Web-API-Aufrufe (Stub)"),
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn swaps_only_the_product_word() {
        assert!(!PRODUCT_NAME.is_empty());
        assert_eq!(brand("Quit Kortex"), "Quit Kortex");
        assert_eq!(brand_with("OpenKortex", "Kortex · 5 reminders due"), "OpenKortex · 5 reminders due");
        assert_eq!(brand_with("OpenKortex", "noch kein Kortex-Vault"), "noch kein OpenKortex-Vault");
        assert_eq!(brand_with("OpenKortex", "C:\\Users\\You\\KortexVault, X-Kortex-Locale"), "C:\\Users\\You\\KortexVault, X-Kortex-Locale");
        assert_eq!(brand_with("Kortex", "Quit Kortex"), "Quit Kortex");
    }

    #[test]
    fn picks_the_language() {
        assert_eq!(Locale::parse("de"), Some(Locale::De));
        assert_eq!(Locale::parse(" en "), Some(Locale::En));
        assert_eq!(Locale::parse("fr"), None);
        assert_eq!(Locale::from_tag("de-AT"), Locale::De);
        assert_eq!(Locale::from_tag("de_DE.UTF-8"), Locale::De);
        assert_eq!(Locale::from_tag("en-US"), Locale::En);
        assert_eq!(Locale::from_tag("den"), Locale::En);
        assert_eq!(Locale::from_tag(""), Locale::En);
    }

    #[test]
    fn translates_and_fills_placeholders() {
        assert_eq!(t_for(Locale::En, "Settings"), "Settings");
        assert_eq!(t_for(Locale::De, "Settings"), "Einstellungen");
        assert_eq!(t_for(Locale::De, "no such text"), "no such text");
        assert_eq!(tf_for(Locale::En, "Kortex · {n} reminders due", &[("n", &5)]), "Kortex · 5 reminders due");
        assert_eq!(tf_for(Locale::De, "Kortex · {n} reminders due", &[("n", &5)]), "Kortex · 5 Erinnerungen fällig");
        assert_eq!(tf_for(Locale::De, "API token “{name}”", &[("name", &"Laptop")]), "API-Token „Laptop“");
    }

    /// `{name}` placeholders of a text.
    fn placeholders(text: &str) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        let mut rest = text;
        while let Some(start) = rest.find('{') {
            let tail = &rest[start + 1..];
            let Some(end) = tail.find('}') else { break };
            let name = &tail[..end];
            if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                out.insert(name.to_string());
            }
            rest = &tail[end + 1..];
        }
        out
    }

    /// String literals passed first to `t(`, `tf(`, `t_for(_, ` or `tf_for(_, ` in a source file.
    fn sources_in(code: &str) -> Vec<String> {
        let bytes = code.as_bytes();
        let mut out = Vec::new();
        for (name, skip_first_arg) in [("t(", false), ("tf(", false), ("t_for(", true), ("tf_for(", true)] {
            let mut from = 0;
            while let Some(found) = code[from..].find(name) {
                let at = from + found;
                from = at + name.len();
                let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
                if at > 0 && ident(bytes[at - 1]) {
                    continue;
                }
                let mut rest = code[from..].trim_start();
                if skip_first_arg {
                    let Some(comma) = rest.find(',') else { continue };
                    rest = rest[comma + 1..].trim_start();
                }
                let Some(body) = rest.strip_prefix('"') else { continue };
                let mut text = String::new();
                let mut chars = body.chars();
                while let Some(c) = chars.next() {
                    match c {
                        '"' => break,
                        '\\' => match chars.next() {
                            Some('n') => text.push('\n'),
                            Some(other) => text.push(other),
                            None => break,
                        },
                        other => text.push(other),
                    }
                }
                out.push(text);
            }
        }
        out
    }

    #[test]
    fn every_text_has_a_german_entry_and_none_is_unused() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut used = BTreeSet::new();
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "rs") && path.file_name().is_some_and(|n| n != "i18n.rs") {
                used.extend(sources_in(&std::fs::read_to_string(&path).unwrap()));
            }
        }
        assert!(used.len() > 100, "the scan found only {} texts", used.len());
        let known: BTreeSet<String> = DE.iter().map(|(en, _)| en.to_string()).collect();
        let missing: Vec<&String> = used.difference(&known).collect();
        assert!(missing.is_empty(), "texts without a German entry: {missing:#?}");
        let unused: Vec<&String> = known.difference(&used).collect();
        assert!(unused.is_empty(), "German entries no code uses: {unused:#?}");
        assert_eq!(known.len(), DE.len(), "a source text is listed twice");
        for (en, de) in DE {
            assert_eq!(placeholders(en), placeholders(de), "placeholders differ: {en}");
        }
    }
}
