import { DIco } from "@/components/icons";
import { TASKBAR_TIME } from "@/data";
import { t } from "@/i18n";
import { useDesktop } from "@/state/desktop";

/** Mock Windows taskbar with the Kortex tray icon (browser preview only; the real tray is native). */
export function Taskbar() {
  const d = useDesktop();
  const label = d.winst === "min" ? t("Open Kortex window") : t("Minimize Kortex");
  return (
    <div
      className="kx-taskbar"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 40 }}
    >
      <span className="kx-tb-ico" />
      <span className="kx-tb-ico" />
      <button
        type="button"
        className="kxb kx-tb-ico is-kortex"
        aria-label={label}
        title={label}
        onClick={() => d.setWinst(d.winst === "min" ? "open" : "min")}
        style={{ cursor: "pointer" }}
      />
      <span className="kx-tb-ico" />
      <span className="kx-tb-ico" />
      <div className="kx-tray">
        <button
          type="button"
          className="kxb"
          aria-label={t("Kortex tray menu")}
          aria-expanded={d.tray}
          onClick={() => d.toggleTray()}
          style={{
            position: "relative",
            display: "grid",
            placeItems: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            ...(d.tray ? { background: "var(--bg-hover)" } : null),
          }}
        >
          <span className="kx-appmark" style={{ width: 14, height: 14 }} />
          {d.phase === "live" && (
            <span
              style={{
                position: "absolute",
                right: 5,
                top: 6,
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--status-urgent)",
                boxShadow: "0 0 0 2px var(--bg-app-shell)",
              }}
              aria-hidden
            />
          )}
        </button>
        <DIco name="wifi" sm />
        <span>DE</span>
        <span style={{ display: "grid", lineHeight: "14px", textAlign: "right" }}>
          <span>{TASKBAR_TIME.time}</span>
          <span>{TASKBAR_TIME.date}</span>
        </span>
      </div>
    </div>
  );
}
