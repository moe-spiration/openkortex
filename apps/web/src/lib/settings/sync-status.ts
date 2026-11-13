/*
 * Vault card (Settings > Vault und Sync) from the md-sync heartbeat in kortex.sync_status (WP-M).
 * Pure: shared by server/settings/sync.ts, the hook and the tests.
 */

import { intlLocale, t, tn } from "@/i18n";

export interface SyncStatusRow {
  device_id: string;
  device_name: string | null;
  vault_path: string | null;
  daemon_version: string | null;
  state: string;
  realtime: string | null;
  last_heartbeat_at: string;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  pending_local: number;
  pending_ingest: number;
  items_tracked: number | null;
  sync_requested_at: string | null;
  sync_handled_at: string | null;
}

/** The daemon beats every 60 s; three missed beats = offline. */
export const STALE_MS = 3 * 60 * 1000;

export interface VaultView {
  /** A daemon ever reported for this user. */
  known: boolean;
  online: boolean;
  deviceId: string | null;
  deviceName: string | null;
  vaultPath: string | null;
  version: string | null;
  /** "heute 11:18", "gestern 21:05", "22. Okt., 09:12" or "–". */
  lastSync: string;
  lastHeartbeat: string;
  pending: number;
  pendingText: string;
  error: string | null;
  /** A web request newer than the daemon's last handled one. */
  requestOpen: boolean;
  realtime: string | null;
}

function dayKey(d: Date, timeZone?: string) {
  return d.toLocaleDateString("en-CA", { timeZone });
}

/** "heute 11:18" / "gestern 21:05" / "22. Okt., 09:12". */
export function relativeTime(iso: string | null | undefined, now = new Date(), timeZone?: string): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const time = d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit", timeZone });
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone);
  const day = dayKey(d, timeZone);
  if (day === today) return t("today {time}", { time });
  if (day === yesterday) return t("yesterday {time}", { time });
  return `${d.toLocaleDateString(intlLocale(), { day: "numeric", month: "short", timeZone })}, ${time}`;
}

const latest = (...isos: (string | null | undefined)[]) =>
  isos.filter((x): x is string => !!x).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

/** Picks the device that reported last and shapes the card. */
export function vaultView(rows: readonly SyncStatusRow[], now = new Date(), timeZone?: string): VaultView {
  const row = [...rows].sort((a, b) => Date.parse(b.last_heartbeat_at) - Date.parse(a.last_heartbeat_at))[0];
  if (!row)
    return {
      known: false,
      online: false,
      deviceId: null,
      deviceName: null,
      vaultPath: null,
      version: null,
      lastSync: "–",
      lastHeartbeat: "–",
      pending: 0,
      pendingText: "",
      error: null,
      requestOpen: false,
      realtime: null,
    };
  const fresh = now.getTime() - Date.parse(row.last_heartbeat_at) <= STALE_MS;
  const online = fresh && row.state === "running";
  const pending = (row.pending_local ?? 0) + (row.pending_ingest ?? 0);
  const parts: string[] = [];
  if (row.pending_local) parts.push(tn(row.pending_local, "{n} held-back deletion", "{n} held-back deletions"));
  if (row.pending_ingest) parts.push(t("{n} in AI enrichment", { n: row.pending_ingest }));
  const requested = row.sync_requested_at ? Date.parse(row.sync_requested_at) : NaN;
  const handled = row.sync_handled_at ? Date.parse(row.sync_handled_at) : NaN;
  const errorRecent = row.last_error && row.last_error_at && (!row.last_success_at || Date.parse(row.last_error_at) > Date.parse(row.last_success_at));
  return {
    known: true,
    online,
    deviceId: row.device_id,
    deviceName: row.device_name,
    vaultPath: row.vault_path,
    version: row.daemon_version,
    lastSync: relativeTime(latest(row.last_success_at, row.last_sync_at), now, timeZone),
    lastHeartbeat: relativeTime(row.last_heartbeat_at, now, timeZone),
    pending,
    pendingText: parts.join(" · "),
    error: errorRecent ? row.last_error : null,
    requestOpen: !Number.isNaN(requested) && (Number.isNaN(handled) || handled < requested),
    realtime: row.realtime,
  };
}

/** `<vault>/00_Inbox/Dropzone` with the separator the vault path uses (Windows or POSIX). */
export function dropzonePath(vaultPath: string): string {
  const sep = vaultPath.includes("\\") && !vaultPath.includes("/") ? "\\" : "/";
  return `${vaultPath.replace(/[\\/]+$/, "")}${sep}00_Inbox${sep}Dropzone`;
}
