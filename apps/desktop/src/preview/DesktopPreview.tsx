import { useEffect, type CSSProperties } from "react";
import { bridge } from "@/bridge";
import { Toast } from "@/components/Toast";
import { useDesktop } from "@/state/desktop";
import { MainWindow } from "@/windows/MainWindow";
import { MeetingBar } from "@/windows/MeetingBar";
import { NativeWindow } from "@/windows/NativeWindow";
import { QuickCapture } from "@/windows/QuickCapture";
import { TrayMenu } from "@/windows/TrayMenu";
import { PreviewBar } from "./PreviewBar";
import { Taskbar } from "./Taskbar";

const MAIN_BASE: CSSProperties = {
  position: "absolute",
  left: 24,
  right: 24,
  top: 56,
  bottom: 56,
  transformOrigin: "50% 100%",
  transition: "transform 220ms var(--ease-snappy), opacity 200ms var(--ease-snappy)",
};
const MAIN_MIN: CSSProperties = {
  transform: "translateY(80px) scale(0.92)",
  opacity: 0,
  pointerEvents: "none",
};

/**
 * Browser preview of the whole desktop (design/reference/Desktop.dc.html): a Windows desktop with
 * the main window, taskbar + tray, native windows and every HUD / overlay state, all in one page.
 * In the Tauri app each of these pieces is its own window (see src/main.tsx and tauri.conf.json).
 */
export function DesktopPreview({ theme }: { theme: "dark" | "light" }) {
  const d = useDesktop();

  // Alt+Space toggles the overlay, Esc closes overlay → tray → native window (prototype onKey).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === " " || e.code === "Space")) {
        e.preventDefault();
        d.setMode(d.mode === "qc" ? "off" : "qc");
      } else if (e.key === "Escape") {
        if (d.mode === "qc") d.setMode("off");
        else if (d.tray) d.toggleTray(false);
        else if (d.win) d.closeWin();
      }
    };
    window.addEventListener("keydown", onKey);
    const off = bridge().listen("shortcut:quick-capture", () =>
      d.setMode(d.mode === "qc" ? "off" : "qc"),
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [d]);

  return (
    <div
      data-theme={theme === "light" ? "light" : ""}
      tabIndex={-1}
      style={{
        position: "relative",
        height: "100vh",
        overflow: "hidden",
        outline: "none",
        background: "var(--bg-app-shell)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <img
        src="/preview/wallpaper.webp"
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.85,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in srgb, var(--bg-app-shell) 35%, transparent)",
        }}
      />

      <PreviewBar />
      <MainWindow placement={d.winst === "min" ? { ...MAIN_BASE, ...MAIN_MIN } : MAIN_BASE} />
      <Taskbar />
      {d.tray && <TrayMenu />}
      {d.win && <NativeWindow win={d.win} />}
      {/* The meeting bar: collapsed ("pill") or with its panel ("hud"), one part since 0.6.8. */}
      {(d.mode === "hud" || d.mode === "pill") && <MeetingBar />}
      {d.mode === "qc" && <QuickCapture />}
      <Toast />
    </div>
  );
}
