import { useCallback, useEffect, useState } from "react";
import { Button } from "@kortex/ui";
import { Cloud, CloudOff, RotateCw } from "lucide-react";
import { msg, t } from "../i18n";
import { createApiClient } from "../lib/api";
import { syncLibrary, type SyncState } from "../lib/library";
import { chromeStore, loadSettings } from "../lib/settings";

const api = createApiClient({ getSettings: () => loadSettings(chromeStore) });

/** Pulls the server list (sessions or prompts) on mount and on demand; the view re-reads storage afterwards. */
export function useLibrarySync(type: "session" | "prompt") {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    setBusy(true);
    void syncLibrary(chromeStore, api, type).then((s) => {
      setSync(s);
      setBusy(false);
    });
  }, [type]);
  useEffect(refresh, [refresh]);
  return { sync, busy, refresh };
}

const TEXT = {
  synced: msg("Synced with Kortex"),
  local: msg("Local only, Kortex not connected"),
  offline: msg("Offline, last state from Kortex"),
} as const;
const DETAIL = {
  synced: msg("Shows local entries and all from Kortex"),
  local: msg("No token entered or mock mode on: only entries from this browser are shown"),
  offline: msg("Kortex is unreachable right now; the list shows the last synced state"),
} as const;

/** One meta line: where the list comes from, plus a refresh button. */
export function SyncLine({ sync, busy, onRefresh }: { sync: SyncState | null; busy: boolean; onRefresh: () => void }) {
  const text = busy || !sync ? t("Syncing with Kortex …") : sync.state === "error" ? t("Local only: {message}", { message: sync.message }) : t(TEXT[sync.state]);
  const ok = sync?.state === "synced";
  const detail = !busy && sync ? (sync.state === "error" ? sync.message : t(DETAIL[sync.state])) : undefined;
  return (
    <div className="kxh-row kx-t-meta text-muted kx-sp-sync" aria-live="polite" title={detail}>
      {busy ? <span className="kx-spinner" aria-hidden /> : ok ? <Cloud className="size-3.5 shrink-0" aria-hidden /> : <CloudOff className="size-3.5 shrink-0" aria-hidden />}
      <span className="kxh-grow kx-truncate">{text}</span>
      <Button size="icon-sm" variant="ghost" aria-label={t("Sync with Kortex")} title={t("Sync with Kortex")} onClick={onRefresh} disabled={busy}>
        <RotateCw />
      </Button>
    </div>
  );
}
