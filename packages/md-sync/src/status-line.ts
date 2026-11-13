/*
 * Status lines for the desktop sidecar (apps/desktop/src-tauri/src/vault.rs parses them):
 *   `@@kortex-status {json}`  every heartbeat (state, last sync, pending work, dropzone counters)
 *   `@@kortex-fatal {json}`   right before the daemon exits ({ kind: "config" | "auth" | "error", message })
 * One line each, so the reader can split stdout by newline and ignore normal log lines.
 */
export const STATUS_PREFIX = "@@kortex-";

export function statusLine(kind: "status" | "fatal", payload: Record<string, unknown>): string {
  return `${STATUS_PREFIX}${kind} ${JSON.stringify(payload)}\n`;
}
