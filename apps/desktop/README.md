# OpenKortex for Windows (`apps/desktop`)

Tauri v2 app: the web app in its own window, Alt+Space quick capture and launcher, a floating meeting
HUD with live transcript and coaching from dual-channel audio (microphone plus system audio, no bot
in the call), reminders as Windows notifications, a tray menu, and the Markdown vault sync as a
bundled sidecar.

## Structure

```
apps/desktop
├─ index.html, vite.config.ts      Vite + React 19 + Tailwind v4 (+ @kortex/ui styles), dev port 3400
├─ src/
│  ├─ main.tsx                     picks the view per Tauri window label (browser: ?window=<label>)
│  ├─ bridge/                      contract.ts (commands + events, mirrored in Rust), index.ts
│  │                               (real @tauri-apps/api bridge), mock.ts (browser simulation)
│  ├─ state/desktop.tsx            app state on top of the bridge
│  ├─ windows/                     MainWindow, Hud, Pill, QuickCapture, TrayMenu, NativeWindow
│  └─ preview/                     browser-only desktop mock: wallpaper, taskbar, state switcher
├─ test/                           vitest
├─ scripts/build-sidecar.mjs       bundles packages/md-sync with a Node runtime into src-tauri/sidecar/
└─ src-tauri/                      Rust core
   ├─ tauri.conf.json              windows main / hud / capture / tray, CSP, bundle
   └─ src/                         audio.rs, live.rs, launcher.rs, inject.rs, window.rs, connect.rs,
                                   secrets.rs, vault.rs, tray.rs, …
```

## Connect it to your server

There is no built-in address. On first start the settings window asks for your server (the address
of the web app), checks `GET <server>/api/instance` and stores it. Sign in there with your account,
or connect from the web app (Settings → Connectors → connect the Windows app, which opens a
`kortex://connect` link). The token is kept in the Windows Credential Manager.

## Run the interface without Rust

```bash
pnpm --filter @kortex/desktop dev    # http://localhost:3400, full desktop preview on a mock bridge
```

`?theme=light` switches the theme, `?window=hud` (or `capture`, `tray`, `meetings`, `audio`,
`settings`, `main`) shows one window exactly as Tauri renders it.

## Build

Needs Windows with Rust (MSVC toolchain) and the Visual Studio Build Tools.

```bash
cd apps/desktop/src-tauri && cargo test --lib
pnpm --filter @kortex/desktop tauri build
```

The installer lands in `src-tauri/target/release/bundle/nsis/` (unsigned: SmartScreen asks once on
first start). It registers the `kortex://` scheme for the connect link and carries the Node runtime
that runs the vault sync. The release workflow (`.github/workflows/release.yml`) builds the same
installer for every version tag.
