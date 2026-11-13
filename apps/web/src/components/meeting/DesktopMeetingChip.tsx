"use client";

import { t } from "@/i18n";
import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { fmtElapsed } from "./live-store";

/*
 * Orbit-Bar chip of the Windows app's native meeting recording (0.6.4, lib/shell/desktop-bridge.ts):
 * live dot and running clock (unless the live meeting chip next to it already shows one) and
 * "Meeting beenden". Minimized, the same recording is the HUD pill.
 */
export function DesktopMeetingChip({
  startedAt,
  showClock,
  onStop,
}: {
  startedAt: number | null;
  showClock: boolean;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showClock || startedAt == null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [showClock, startedAt]);
  const sec = startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {showClock && (
        <span
          className="kx-orbit-livechip"
          role="status"
          aria-label={t("Meeting recording in progress")}
          title={t("Meeting recording in progress (microphone and system audio)")}
        >
          <span className="kx-live-dot" aria-hidden />
          <span className="kx-num">{fmtElapsed(sec)}</span>
        </span>
      )}
      <button
        type="button"
        className="kx-orbit-livechip"
        title={t("End meeting")}
        aria-label={t("Stop meeting recording")}
        onClick={onStop}
      >
        <Square
          aria-hidden
          className="kx-ico kx-ico--sm"
          style={{ color: "var(--crit, #e5484d)" }}
        />
      </button>
    </span>
  );
}
