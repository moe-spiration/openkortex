"use server";

import { t } from "@/i18n";
import type { SyncStatusRow } from "@/lib/settings/sync-status";
import { runAction, type ActionResult } from "./run";

/*
 * Vault card (WP-M): the md-sync heartbeats of the signed-in user (kortex.sync_status, RLS read)
 * and the "Sync" button, which only sets sync_requested_at (the one column users may write).
 * The daemon sees the request via Realtime, reconciles and writes sync_handled_at.
 */

const COLUMNS =
  "device_id, device_name, vault_path, daemon_version, state, realtime, last_heartbeat_at, last_sync_at, " +
  "last_success_at, last_error, last_error_at, pending_local, pending_ingest, items_tracked, sync_requested_at, sync_handled_at";

export async function getSyncStatus(): Promise<ActionResult<SyncStatusRow[]>> {
  return runAction("getSyncStatus", async ({ client, userId }) => {
    const { data, error } = await client
      .from("sync_status")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("last_heartbeat_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SyncStatusRow[];
  });
}

/** Asks the daemon(s) for a full sync now. Returns the request time. */
export async function requestSync(deviceId?: string): Promise<ActionResult<{ requestedAt: string; devices: number }>> {
  return runAction("requestSync", async ({ client, userId }) => {
    const requestedAt = new Date().toISOString();
    let q = client.from("sync_status").update({ sync_requested_at: requestedAt }).eq("user_id", userId);
    if (deviceId) q = q.eq("device_id", deviceId);
    const { data, error } = await q.select("device_id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error(t("No md-sync daemon connected"));
    return { requestedAt, devices: data.length };
  });
}
