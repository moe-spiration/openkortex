import { useEffect, useState, type CSSProperties } from "react";
import { bridge } from "@/bridge";
import { DIco, type DIconId } from "@/components/icons";
import { Keys } from "@/components/Key";
import { trayStatus } from "@/data";
import { PRODUCT_NAME, t } from "@/i18n";
import { useDesktop } from "@/state/desktop";
import { useClock } from "@/state/clock";

interface TrayItem {
  icon: DIconId;
  label: string;
  /** Shortcut shown as flat keys ("Ctrl+Shift+H"), or a short note. */
  keys?: string;
  note?: string;
  danger?: boolean;
  pick: () => void;
}

export const TRAY_PLACEMENT: CSSProperties = {
  position: "absolute",
  right: 120,
  bottom: 54,
  zIndex: 55,
};

/**
 * Tray menu (Desktop.dc.html "Tray-Menü"). Native Windows tray menus can't be styled, so the Rust
 * side opens this as a small frameless window anchored to the tray icon (tray.rs).
 * Ruhe (D4): brand and status in one quiet line, three groups set apart by space instead of dividers,
 * shortcuts as flat keys.
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
  const groups: TrayItem[][] = [
    [
      {
        icon: "hud",
        label: d.mode === "hud" ? t("Hide live HUD") : t("Show live HUD"),
        keys: "Ctrl+Shift+H",
        pick: () => d.setMode(d.mode === "hud" ? "off" : "hud"),
      },
      { icon: "mic", label: t("Capture a thought"), keys: "Ctrl+Shift+Space", pick: d.startVoiceNote },
      { icon: "search", label: t("Quick capture and ask"), keys: "Alt+Space", pick: () => d.setMode("qc") },
      {
        icon: live ? "stop" : "rec",
        label: live ? t("Stop recording") : t("Start recording"),
        keys: "Ctrl+Shift+R",
        pick: d.toggleRecording,
      },
    ],
    [
      { icon: "cal", label: t("Meeting center"), pick: () => d.openWin("meetings") },
      { icon: "sliders", label: t("Audio setup"), pick: () => d.openWin("audio") },
      ...(d.connected ? [] : [{ icon: "link", label: t("Connect account"), pick: d.openConnect } as const]),
      { icon: "gear", label: t("Settings"), pick: () => d.openWin("settings") },
    ],
    [
      {
        icon: "power",
        label: confirmQuit ? t("Recording in progress: save and quit?") : t("Quit Kortex"),
        note: confirmQuit ? t("Click confirms") : undefined,
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
    ],
  ];
  return (
    <div className="kxd-tray kx-slide-up" role="menu" aria-label={`${PRODUCT_NAME} Tray`} style={{ ...placement, width: 320 }}>
      <div className="kxd-tray-head">
        <span className="kx-appmark kxd-tray-mark" aria-hidden />
        <strong>{PRODUCT_NAME}</strong>
        {live && <span className="kxd-mb-dot kxd-tray-dot" aria-hidden />}
        <span className="kxd-tray-status kx-truncate">
          {trayStatus({ connected: d.connected, live, clock, session: d.meeting.session.state })}
        </span>
      </div>
      {groups.map((items, g) => (
        <div key={g} className="kxd-tray-group" role="group">
          {items.map((item) => (
            <button
              key={item.icon + item.label}
              type="button"
              className={"kxd-tray-item" + (item.danger ? " is-danger" : "")}
              role="menuitem"
              onClick={item.pick}
            >
              <DIco name={item.icon} sm />
              <span className="kx-truncate">{item.label}</span>
              {item.keys ? <Keys keys={item.keys} /> : item.note ? <span className="kxd-tray-note">{item.note}</span> : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
