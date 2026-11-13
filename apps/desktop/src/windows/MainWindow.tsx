import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CSSProperties } from "react";
import { bridge } from "@/bridge";
import { DIco } from "@/components/icons";
import { PRODUCT_NAME, t } from "@/i18n";
import { useDesktop } from "@/state/desktop";
import { Clock } from "@/state/clock";

/** Browser preview only: where "Web-App öffnen" leads (VITE_KORTEX_WEB_URL, else apps/web on :3000). */
export const WEB_URL: string = import.meta.env.VITE_KORTEX_WEB_URL ?? "http://localhost:3000/home";

const win = () => Promise.resolve(getCurrentWindow());

/**
 * Main window of the browser preview, and natively the bundled page `main` holds until the web app is loaded.
 * Natively `main` starts hidden and the core navigates it to the web app top-level, then shows it (lib.rs
 * `reveal_main`), so this page is only seen when the web app takes long. There is no iframe: the web app sends
 * `frame-ancestors 'none'`, which made WebView2 show "Dieser Inhalt wird blockiert".
 */
export function MainWindow({ placement }: { placement: CSSProperties }) {
  const d = useDesktop();
  const live = d.phase === "live";
  const native = bridge().native;
  return (
    <div className="kx-window kxd-main" style={placement} aria-hidden={d.winst === "min" ? "true" : "false"}>
      {/* Tactile Craft v2: the frame titlebar (lum-0 with the accent glow) and Windows-style buttons (.tc-win). */}
      <div className="kxd-titlebar" data-tauri-drag-region>
        <span className="kx-appmark kxd-appmark" aria-hidden />
        <span className="kxd-brand">{PRODUCT_NAME}</span>
        {live && (
          <span className="kxd-rec">
            <span className="kx-live-dot" aria-hidden />
            <span className="kx-num">REC <Clock /></span>
          </span>
        )}
        <span className="kxh-grow" data-tauri-drag-region />
        <span className="tc-win" aria-label={t("Window buttons")}>
          <button
            type="button"
            className="tc-wbtn"
            aria-label={t("Minimize")}
            onClick={() => {
              d.minimize();
              if (native) void win().then((w) => w.minimize());
            }}
          >
            <DIco name="min" />
          </button>
          <button
            type="button"
            className="tc-wbtn tc-wbtn--max"
            aria-label={t("Maximize")}
            onClick={() => native && void win().then((w) => w.toggleMaximize())}
          >
            <DIco name="max" />
          </button>
          <button
            type="button"
            className="tc-wbtn tc-wbtn--close"
            aria-label={t("Minimize to tray")}
            onClick={() => {
              if (native) void bridge().invoke("hide_to_tray");
              d.say(t("Kortex keeps running in the tray"));
            }}
          >
            <DIco name="x" />
          </button>
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          placeItems: "center",
          alignContent: "center",
          gap: 10,
          padding: 24,
          textAlign: "center",
          background: "var(--lum-1)",
        }}
      >
        <span className="kx-appmark" style={{ width: 28, height: 28 }} aria-hidden />
        <strong style={{ fontSize: "calc(15px * var(--kx-fs, 1))" }}>{native ? t("Loading Kortex …") : t("The Kortex web app runs here")}</strong>
        <span className="kx-help" style={{ maxWidth: 420 }}>
          {native
            ? t("The web app appears in this window in a moment. On first start the settings ask for the address of your Kortex server. If it stays empty otherwise, check the internet connection.")
            : t("The Windows app loads the web app directly into this window (no iframe). In the preview it opens in its own tab.")}
        </span>
        {!native && (
          <a className="kx-btn kx-btn--secondary" href={WEB_URL} target="_blank" rel="noreferrer">
            {t("Open web app")}
          </a>
        )}
      </div>
    </div>
  );
}
