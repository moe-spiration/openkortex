import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { bridge } from "@/bridge";
import { DIco, type DIconId } from "@/components/icons";
import { trayStatus } from "@/data";
import { PRODUCT_NAME, t } from "@/i18n";
import { useDesktop } from "@/state/desktop";
import { useClock } from "@/state/clock";

type TrayItem =
  | { sep: true }
  | { sep?: false; icon: DIconId; label: string; hint: string; danger?: boolean; pick: () => void };

export const TRAY_PLACEMENT: CSSProperties = {
  position: "absolute",
  right: 120,
  bottom: 54,
  zIndex: 55,
};

/**
 * Tray menu (Desktop.dc.html "Tray-Menü"). Native Windows tray menus can't be styled, so the Rust
 * side opens this as a small frameless window anchored to the tray icon (tray.rs).
 */
export function TrayMenu({ placement = TRAY_PLACEMENT }: { placement?: CSSProperties }) {
  const d = useDesktop();
  const clock = useClock();
  const live = d.phase === "live";
  // "Beenden" during a recording asks once (audit D-08); the core then stops and uploads first.
  const [confirmQuit, setConfirmQuit] = useState(false);
  useEffect(() => {
    if (!confirmQuit) return;
    const timer = setTimeout(() => setConfirmQuit(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmQuit]);
  const items: TrayItem[] = [
    {
      icon: "hud",
      label: d.mode === "hud" ? t("Hide live HUD") : t("Show live HUD"),
      hint: "Ctrl+Shift+H",
      pick: () => d.setMode(d.mode === "hud" ? "off" : "hud"),
    },
    { icon: "mic", label: t("Capture a thought"), hint: "Ctrl+Shift+Space", pick: d.startVoiceNote },
    {
      icon: "search",
      label: t("Quick capture and ask"),
      hint: "Alt+Space",
      pick: () => d.setMode("qc"),
    },
    {
      icon: live ? "stop" : "rec",
      label: live ? t("Stop recording") : t("Start recording"),
      hint: "Ctrl+Shift+R",
      pick: d.toggleRecording,
    },
    { sep: true },
    { icon: "cal", label: t("Meeting center"), hint: "", pick: () => d.openWin("meetings") },
    { icon: "sliders", label: t("Audio setup"), hint: "", pick: () => d.openWin("audio") },
    ...(d.connected ? [] : [{ icon: "link", label: t("Connect account"), hint: "", pick: d.openConnect } as const]),
    { icon: "gear", label: t("Settings"), hint: "", pick: () => d.openWin("settings") },
    { sep: true },
    {
      icon: "power",
      label: confirmQuit ? t("Recording in progress: save and quit?") : t("Quit Kortex"),
      hint: confirmQuit ? t("Click confirms") : "",
      danger: true,
      pick: () => {
        if (live && !confirmQuit) {
          setConfirmQuit(true);
          return;
        }
        setConfirmQuit(false);
        d.toggleTray(false);
        if (bridge().native) void bridge().invoke("quit_app");
        else d.say(t("Kortex stays open in the prototype"));
      },
    },
  ];
  return (
    <div
      className="kx-menu kx-slide-up"
      role="menu"
      aria-label={`${PRODUCT_NAME} Tray`}
      style={{ ...placement, width: 320 }}
    >
      <div className="kxh-row" style={{ gap: 10, padding: "10px 10px 8px" }}>
        <span className="kx-appmark" style={{ width: 22, height: 22 }} />
        <span className="kxh-col" style={{ gap: 0 }}>
          <strong style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{PRODUCT_NAME}</strong>
          <span className="kx-help">
            {trayStatus({ connected: d.connected, live, clock, session: d.meeting.session.state })}
          </span>
        </span>
      </div>
      <hr className="kx-divider" />
      {items.map((item, i) =>
        item.sep ? (
          <hr key={i} className="kx-divider" />
        ) : (
          <Fragment key={item.label}>
            <button
              type="button"
              className={"kxb kx-menu-item " + (item.danger ? "kx-menu-item--danger" : "")}
              role="menuitem"
              style={{ width: "100%", height: 36 }}
              onClick={item.pick}
            >
              <DIco name={item.icon} />
              <span>{item.label}</span>
              <span className="kx-hint">{item.hint}</span>
            </button>
          </Fragment>
        ),
      )}
    </div>
  );
}
