// Every app command gets an `allow-<command>` permission; capabilities/local.json grants them to
// the local windows only, so the remote web app in `main` cannot call them (review N5 #8).
const COMMANDS: &[&str] = &[
    "get_meeting_state",
    "start_recording",
    "stop_recording",
    "upload_recording",
    "discard_recording",
    "account_status",
    "connect_account",
    "disconnect_account",
    "set_hud_mode",
    "set_stealth",
    "list_audio_devices",
    "select_audio_device",
    "get_autostart",
    "set_autostart",
    "test_recording",
    "quick_capture",
    "start_voice_note",
    "stop_voice_note",
    "connect_token",
    "meeting_clip",
    "meeting_task",
    "refresh_coaching",
    "open_in_main",
    "open_window",
    "show_main",
    "hide_to_tray",
    "quit_app",
    "launcher_search",
    "launcher_ask",
    "paste_text",
    "grab_selection",
    "close_launcher",
    "pending_connect",
    "confirm_connect",
    "dismiss_connect",
    "open_connect",
    "get_reminders",
    "set_reminders",
    "set_server",
    "get_locale",
    "set_locale",
    "vault_status",
    "vault_pick_folder",
    "vault_check_folder",
    "vault_set_folder",
    "vault_set_enabled",
    "vault_skip_setup",
    "vault_sync_now",
    "vault_open",
    "run_selftest",
    "stop_web_recording",
    "set_theme",
    // Only these five reach the web app in `main` (runtime capability, main_bridge.rs).
    "main_meeting_state",
    "main_start_meeting",
    "main_stop_meeting",
    "main_web_recording",
    "main_window",
];

/// One string value of the instance file. No JSON dependency in the build script: the file is flat
/// and written by hand, a missing or odd value simply means "no default".
fn instance_value(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let rest = &json[json.find(&needle)? + needle.len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    let value = rest[..rest.find('"')?].trim().trim_end_matches('/');
    (!value.is_empty()).then(|| value.to_string())
}

/// A private deployment preconfigures its builds: `KORTEX_DEFAULT_WEB_URL` / `KORTEX_DEFAULT_SUPABASE_URL`
/// in the build environment, or `webUrl` / `supabaseUrl` in kortex.instance.json in the repository
/// root. Without either the app carries no server address and asks on first start (config.rs).
fn instance_defaults() {
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../kortex.instance.json");
    let json = std::fs::read_to_string(&file).unwrap_or_default();
    if file.exists() {
        println!("cargo:rerun-if-changed={}", file.display());
    }
    for (var, key) in [("KORTEX_DEFAULT_WEB_URL", "webUrl"), ("KORTEX_DEFAULT_SUPABASE_URL", "supabaseUrl")] {
        println!("cargo:rerun-if-env-changed={var}");
        let from_env = std::env::var(var).ok().map(|v| v.trim().trim_end_matches('/').to_string()).filter(|v| !v.is_empty());
        if let Some(value) = from_env.or_else(|| instance_value(&json, key)) {
            println!("cargo:rustc-env={var}={value}");
        }
    }
}

/// Display name of the product (packages/i18n/product.json, "Kortex" unless the open-source export
/// wrote its own) as `KORTEX_PRODUCT_NAME` for `i18n::PRODUCT_NAME`.
fn product_name() {
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/i18n/product.json");
    println!("cargo:rerun-if-changed={}", file.display());
    let json = std::fs::read_to_string(&file).unwrap_or_default();
    let name = instance_value(&json, "name").unwrap_or_else(|| "Kortex".to_string());
    println!("cargo:rustc-env=KORTEX_PRODUCT_NAME={name}");
}

fn main() {
    instance_defaults();
    product_name();
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
