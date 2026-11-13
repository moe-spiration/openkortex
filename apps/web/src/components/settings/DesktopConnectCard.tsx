"use client";

import { useState } from "react";
import { Ico } from "@/components/shell/icons";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { desktopConnectLink, desktopTokenName } from "@/lib/settings/desktop-connect";
import { createApiToken } from "@/server/auth/api-tokens/actions";
import { card } from "@/app/(workspace)/settings/rows";
import { t } from "@/i18n";

/**
 * "Mit Windows-App verbinden": creates a personal API token with every scope (capture, search, ask, vault sync) and hands
 * it to the installed Kortex Windows app through `kortex://connect`. The token never shows up here; the app
 * asks once "Verbinden?" and keeps it in the Windows Credential Manager. Without the app installed the browser
 * simply does nothing, so the card says what to do then.
 */
export function DesktopConnectCard() {
  const { showToast } = useShell();
  const live = isLiveData();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await createApiToken(desktopTokenName(new Date()), null, { search: true, ask: true, sync: true });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    // Hand-off to the OS protocol handler; the page stays where it is.
    window.location.href = desktopConnectLink(r.data.token, window.location.origin);
    setSent(true);
    showToast(t("Handed over to the Windows app"));
  };

  return (
    <div style={{ ...card, display: "grid", gap: 12 }}>
      <div className="kxh-row" style={{ gap: 12 }}>
        <span className="kx-icontile kx-icontile--lg" aria-hidden>
          <Ico name="monitor" />
        </span>
        <span className="kxh-col kxh-grow" style={{ gap: 2, minWidth: 0 }}>
          <strong className="kx-h-card">{t("Windows app")}</strong>
          <span className="kx-help">
            {t("Connects the installed Kortex app for Windows with your account: capture, ask, search, meeting transcript, coaching, reminders and the vault folder on the PC. This creates its own API token, which you can revoke below at any time.")}
          </span>
        </span>
        {live && (
          <button type="button" className="kx-btn kx-btn--primary" style={{ flex: "none" }} disabled={busy} onClick={() => void connect()}>
            {busy ? t("Creating token …") : t("Connect to Windows app")}
          </button>
        )}
      </div>
      {!live && <span className="kx-help">{t("Available with an account.")}</span>}
      {sent && (
        <span className="kx-help">
          {t("Confirm “Connect” in the Windows app. If nothing happens, the app is not installed or too old (0.6.0 or later): run the installer and click here again.")}
        </span>
      )}
      {error && (
        <span className="kx-help" role="alert" style={{ color: "var(--status-urgent-text)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
