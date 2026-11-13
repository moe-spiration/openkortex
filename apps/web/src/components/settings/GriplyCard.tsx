"use client";

import { useCallback, useEffect, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { connectGriply, disconnectGriplyAction, getGriplyStatus } from "@/server/griply/actions";
import type { GriplyStatus } from "@/server/griply/service";
import { card } from "@/app/(workspace)/settings/rows";
import { intlLocale, t } from "@/i18n";

/**
 * Griply connection (Settings > Connectors): the user pastes the address of their Griply MCP server,
 * signs in at Griply and chooses there what Kortex may do. Kortex then shows the goals of a life area
 * and hands tasks over. The sign-in data stays on the server.
 */
export function GriplyCard() {
  const { showToast } = useShell();
  const live = isLiveData();
  const [status, setStatus] = useState<GriplyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const r = await getGriplyStatus();
    if (r.ok) {
      setStatus(r.data);
      setUrl((u) => u || r.data.serverUrl || "");
    } else setError(r.error);
  }, []);

  useEffect(() => {
    if (live) void load();
  }, [live, load]);

  // Back from Griply's sign-in page (?griply=connected|failed, set by the callback route).
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("griply");
    if (result === "failed") setError(t("The sign-in at Griply did not work. Start it again."));
    if (result === "connected") showToast(t("Griply is connected"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    const r = await connectGriply(url);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    setStatus(r.data.status);
    // Griply's own page: sign in there, choose the access, then Griply sends the browser back.
    if (r.data.url) window.location.assign(r.data.url);
    else setBusy(false);
  };

  const disconnect = async () => {
    if (busy) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setBusy(true);
    const r = await disconnectGriplyAction();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setStatus(r.data);
    showToast(t("Griply disconnected"));
  };

  const connected = status?.state === "connected";
  return (
    <div style={{ ...card, display: "grid", gap: 14 }} data-testid="griply-card">
      <div className="kxh-row" style={{ gap: 12 }}>
        <span className="kx-icontile kx-icontile--lg" aria-hidden>
          <Ico name="o-goal" />
        </span>
        <span className="kxh-col kxh-grow" style={{ gap: 2 }}>
          <strong className="kx-h-card">Griply</strong>
          <span className="kx-help">
            {t("Goals, habits and tasks stay in Griply. Kortex shows the goals of a life area on its page and hands tasks over from the board.")}
          </span>
        </span>
        {live && status && (
          <span className={`kx-status ${connected ? "kx-status--done" : "kx-status--progress"}`}>
            {connected ? t("Connected") : status.state === "pending" ? t("Sign-in open") : t("Off")}
          </span>
        )}
      </div>
      <hr className="kx-hairline" />

      {!live ? (
        <span className="kx-help">{t("Available with an account (in mock mode there is no server that signs in to Griply).")}</span>
      ) : !status && !error ? (
        <span className="kx-help">{t("Loading")}</span>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {connected && (
            <span className="kx-help">
              {status.access === "write"
                ? t("Kortex may read and change: tasks from the board are created in Griply directly.")
                : t("Kortex may only read. To hand tasks over directly, connect again and choose “Read and change” in Griply.")}{" "}
              {status.connectedAt && t("Connected on {date}.", { date: new Date(status.connectedAt).toLocaleDateString(intlLocale()) })}
            </span>
          )}
          <span className="kx-label">{t("Address of your Griply MCP server")}</span>
          <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="kx-control kxh-grow" style={{ minWidth: 220 }}>
              <input
                aria-label={t("Address of your Griply MCP server")}
                placeholder="https://"
                value={url}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void connect()}
              />
            </span>
            <button type="button" className={`kx-btn kx-btn--sm ${connected ? "kx-btn--secondary" : "kx-btn--primary"}`} disabled={busy || !url.trim()} onClick={() => void connect()}>
              {connected ? t("Connect again") : t("Connect")}
            </button>
            {status && status.state !== "off" && (
              <button
                type="button"
                className={`kx-btn kx-btn--sm ${confirming ? "kx-btn--danger" : "kx-btn--ghost"}`}
                disabled={busy}
                onBlur={() => setConfirming(false)}
                onClick={() => void disconnect()}
              >
                {confirming ? t("Really disconnect?") : t("Disconnect")}
              </button>
            )}
          </div>
          {!connected && (
            <span className="kx-help">
              {t("You find the address in Griply under Settings > Integrations > MCP server, on the card “Other AI app”. After “Connect” Griply opens: sign in, choose “Read and change” under Access and allow it.")}
            </span>
          )}
        </div>
      )}
      {error && <span className="kx-help kx-help--error">{error}</span>}
    </div>
  );
}
