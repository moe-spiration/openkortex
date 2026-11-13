"use client";

import { t } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT } from "@/lib/mock/settings";
import { isLiveData } from "@/lib/workspace-data";
import { getSyncStatus, requestSync } from "@/server/settings/sync";
import { vaultView, type SyncStatusRow, type VaultView } from "./sync-status";

/*
 * Vault card state. Live: the md-sync heartbeat (polled every 20 s while the card is open, every
 * 2 s while a requested sync runs). Mock: the prototype values.
 */

const POLL_MS = 20_000;
const FAST_MS = 2_000;
const REQUEST_TIMEOUT_MS = 90_000;

const MOCK_VIEW: VaultView = {
  known: true,
  online: true,
  deviceId: "mock",
  get deviceName() {
    return t("This computer");
  },
  vaultPath: ACCOUNT.vaultPath,
  version: "0.0.0",
  lastSync: ACCOUNT.lastSync,
  lastHeartbeat: ACCOUNT.lastSync,
  pending: 0,
  pendingText: "",
  error: null,
  requestOpen: false,
  realtime: "connected",
};

export type SyncPhase = "idle" | "requesting" | "running";

export function useSyncStatus(showToast: (m: string) => void) {
  const live = isLiveData();
  const [rows, setRows] = useState<SyncStatusRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [now, setNow] = useState(() => new Date());
  const requestedAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    const res = await getSyncStatus().catch(() => ({ ok: false as const, error: t("Server not reachable") }));
    setNow(new Date());
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    setError(null);
    setRows(res.data);
    return res.data;
  }, []);

  useEffect(() => {
    if (!live) return;
    void load();
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  // While a requested sync runs: poll fast until the daemon marks it handled (or give up).
  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(async () => {
      const data = await load();
      const at = requestedAt.current ?? 0;
      const handled = data?.some((r) => r.sync_handled_at && Date.parse(r.sync_handled_at) >= at);
      if (handled) {
        setPhase("idle");
        showToast(t("Sync finished"));
      } else if (Date.now() - at > REQUEST_TIMEOUT_MS) {
        setPhase("idle");
        showToast(t("The daemon did not answer"));
      }
    }, FAST_MS);
    return () => clearInterval(timer);
  }, [phase, load, showToast]);

  const view: VaultView = live ? vaultView(rows ?? [], now) : MOCK_VIEW;

  const sync = useCallback(async () => {
    if (phase !== "idle") return;
    if (!live) {
      setPhase("running");
      showToast(t("Sync started"));
      setTimeout(() => setPhase("idle"), 1200);
      return;
    }
    if (!view.known) {
      showToast(t("No md-sync daemon connected. Start md-sync on your computer."));
      return;
    }
    if (!view.online) {
      showToast(t("Daemon offline: the sync starts as soon as md-sync runs again"));
    }
    setPhase("requesting");
    const res = await requestSync(view.deviceId ?? undefined).catch(() => ({ ok: false as const, error: t("Server not reachable") }));
    if (!res.ok) {
      setPhase("idle");
      showToast(t("Sync not requested: {error}", { error: res.error }));
      return;
    }
    requestedAt.current = Date.parse(res.data.requestedAt);
    if (view.online) {
      setPhase("running");
      showToast(t("Sync requested"));
    } else setPhase("idle");
  }, [phase, live, view.known, view.online, view.deviceId, showToast]);

  return { live, view, loading: live && rows === null && !error, error, phase, sync, reload: load };
}
