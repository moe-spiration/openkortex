import type { HudMode } from "@/bridge";
import { WIN_TITLES, type NativeWin } from "@/data";
import { msg, t } from "@/i18n";
import { useDesktop, type WinState } from "@/state/desktop";

// English sources (also the proper names "Alt+Space" and "Audio"); shown with `t(label)`.
const MODES: [HudMode, string][] = [
  ["pill", msg("Pill")],
  ["hud", msg("Live HUD")],
  ["qc", "Alt+Space"],
  ["off", msg("Off")],
];
const WIN_STATES: [WinState, string][] = [
  ["open", msg("Open")],
  ["min", msg("Minimized")],
];
const WINS: [NativeWin, string][] = [
  ["meetings", WIN_TITLES.meetings],
  ["audio", "Audio"],
  ["settings", WIN_TITLES.settings],
];

const sep = (
  <span style={{ width: 1, height: 20, background: "var(--border-subtle)" }} aria-hidden />
);

/** State switcher of the browser preview (the prototype's "Prototyp-Steuerung"); not part of the native app. */
export function PreviewBar() {
  const d = useDesktop();
  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 6px 5px 14px",
        borderRadius: "var(--radius-pill)",
        background: "var(--bg-floating-glass)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        backdropFilter: "blur(16px) saturate(160%)",
        boxShadow: "var(--shadow-floating)",
      }}
    >
      <span className="kx-eyebrow">Overlay</span>
      <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Overlay state")}>
        {MODES.map(([m, label]) => (
          <button
            key={m}
            type="button"
            className="kx-tab"
            role="tab"
            aria-selected={d.mode === m}
            onClick={() => d.setMode(m)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {sep}
      <span className="kx-eyebrow">{t("Window")}</span>
      <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Window state")}>
        {WIN_STATES.map(([w, label]) => (
          <button
            key={w}
            type="button"
            className="kx-tab"
            role="tab"
            aria-selected={d.winst === w}
            onClick={() => d.setWinst(w)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {sep}
      <span className="kx-eyebrow">Native</span>
      <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Native windows")}>
        {WINS.map(([w, label]) => (
          <button
            key={w}
            type="button"
            className="kx-tab"
            role="tab"
            aria-selected={d.win === w}
            onClick={() => d.openWin(w)}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
