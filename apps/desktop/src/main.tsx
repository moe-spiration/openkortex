// First: registers the German catalog before any other module of the app is evaluated.
import { followLocale, startLocale } from "./i18n";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { StrictMode, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { bridge, isTauri, type HudMode, type WindowLabel } from "./bridge";
import { Toast } from "./components/Toast";
import {
  ACCENT_STORAGE_KEY,
  FONT_SCALE_KEY,
  LOOK_KEY,
  THEME_KEY,
  applyAccent,
  applyFontScale,
  applyLook,
  applyTheme,
  parseFontScale,
  parseLook,
  parseTheme,
  readFontScale,
  readLook,
  readTheme,
  resolveAccent,
  resolveTheme,
  type ThemePref,
} from "./theme";
import { NATIVE_WINDOWS, resolveWindow } from "./windowRoute";
import { DesktopPreview } from "./preview/DesktopPreview";
import { DesktopProvider, useDesktop } from "./state/desktop";
import { MainWindow } from "./windows/MainWindow";
import { MeetingBar } from "./windows/MeetingBar";
import { NativeWindow } from "./windows/NativeWindow";
import { QuickCapturePalette } from "./windows/QuickCapture";
import { TrayMenu } from "./windows/TrayMenu";

/*
 * One bundle, one entry per Tauri window: tauri.conf.json opens `index.html?window=<label>`.
 * Without `window` (browser, `pnpm dev`) the full desktop preview renders instead.
 */

const FILL: CSSProperties = { position: "relative", width: "100%", height: "100%" };
const AT_ORIGIN: CSSProperties = { position: "relative" };

/** The meeting bar: collapsed ("pill") or with its panel ("hud"); the window takes the content's height. */
function HudWindow() {
  const d = useDesktop();
  if (d.mode !== "pill" && d.mode !== "hud") return null;
  return <MeetingBar placement={AT_ORIGIN} fitWindow />;
}

function NativeRoot({ label }: { label: WindowLabel }) {
  switch (label) {
    case "main":
      return (
        <>
          <MainWindow placement={FILL} />
          <Toast />
        </>
      );
    case "hud":
      return <HudWindow />;
    case "capture":
      return <QuickCapturePalette />;
    case "tray":
      return <TrayMenu placement={AT_ORIGIN} />;
    default:
      return (
        <div style={FILL}>
          <NativeWindow win={label as (typeof NATIVE_WINDOWS)[number]} placement={FILL} />
          <Toast />
        </div>
      );
  }
}

const params = new URLSearchParams(window.location.search);
// Native: every window loads index.html and is identified by its Tauri label. Browser: ?window=<label>.
const label = resolveWindow(isTauri() ? getCurrentWindow().label : params.get("window"));
// Light / dark: ?theme= (preview, screenshots), else the stored choice, else Windows (prefers-color-scheme).
const systemDark = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let themePref: ThemePref = "system";
const showTheme = () => applyTheme(document.documentElement, resolveTheme(themePref, systemDark?.matches ?? true));
// Tactile Craft v2: one accent, everything else derives in CSS (?accent=violet | %2310B981, or the stored one).
let store: Storage | null = null;
try {
  store = window.localStorage;
} catch {
  store = null;
}
// Language before the first render: the one remembered from the core, else the system language.
startLocale(store);
// The core holds the choice (desktop.json) and its own texts follow it: take its language when it
// differs, and reload when the settings window changes it (every text is rebuilt).
void bridge()
  .invoke("get_locale")
  .then((locale) => followLocale(locale, store), () => undefined);
bridge().listen("settings:locale", ({ locale }) => followLocale(locale, store));
themePref = readTheme(params.get("theme"), store);
const theme = resolveTheme(themePref, systemDark?.matches ?? true);
showTheme();
systemDark?.addEventListener("change", showTheme);
bridge().listen("settings:theme", ({ theme: next }) => {
  if (params.get("theme")) return;
  themePref = parseTheme(next);
  showTheme();
});
applyAccent(document.documentElement, resolveAccent(params.get("accent"), store));
applyFontScale(document.documentElement, readFontScale(store));
applyLook(document.documentElement, readLook(params.get("look"), store));
// Settings in one window changes the font size of every open window (same origin, `storage` fires in the others).
window.addEventListener("storage", (e) => {
  if (e.key === FONT_SCALE_KEY) applyFontScale(document.documentElement, parseFontScale(e.newValue));
  if (e.key === LOOK_KEY) applyLook(document.documentElement, parseLook(e.newValue));
  if (e.key === ACCENT_STORAGE_KEY && !params.get("accent")) applyAccent(document.documentElement, e.newValue);
  if (e.key === THEME_KEY && !params.get("theme")) {
    themePref = parseTheme(e.newValue);
    showTheme();
  }
});
if (label && label !== "main") document.documentElement.classList.add("kx-transparent");
// Natively the HUD window starts hidden (tauri.conf.json): every window starts "off" and follows the
// core's `hud:mode` events, so the tray offers "Show live HUD", not "Hide live HUD".
const initialMode: HudMode = label === "capture" ? "qc" : isTauri() ? "off" : "hud";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopProvider initialMode={initialMode}>
      {label ? <NativeRoot label={label} /> : <DesktopPreview theme={theme} />}
    </DesktopProvider>
  </StrictMode>,
);
