"use client";

import { useEffect, useSyncExternalStore } from "react";
import { connectDesktopWindow, hasWindowControls, subscribeWindowControls, windowControls } from "@/lib/shell/window-controls";
import { t } from "@/i18n";
import { Ico } from "./icons";

/*
 * Window buttons of the titlebar in the desktop app (Ruhe D1): the titlebar is the window's only frame there.
 * Kept apart from Titlebar.tsx so the shell can change without touching the desktop wiring.
 */

/** True once the desktop app accepted the custom frame; connects on first use. Server snapshot false (hydration). */
export function useWindowControls(): boolean {
  useEffect(() => {
    void connectDesktopWindow();
  }, []);
  return useSyncExternalStore(subscribeWindowControls, hasWindowControls, () => false);
}

export function WindowButtons() {
  const w = windowControls();
  return (
    <span className="tc-win" aria-label={t("Window buttons")}>
      <button type="button" className="tc-wbtn" aria-label={t("Minimize")} onClick={() => void w.minimize()}>
        <Ico name="minus" />
      </button>
      <button type="button" className="tc-wbtn tc-wbtn--max" aria-label={t("Maximize")} onClick={() => void w.toggleMaximize()}>
        <Ico name="square" />
      </button>
      <button type="button" className="tc-wbtn tc-wbtn--close" aria-label={t("Close")} onClick={() => void w.close()}>
        <Ico name="x" />
      </button>
    </span>
  );
}
