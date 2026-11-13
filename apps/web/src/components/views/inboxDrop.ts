import { t } from "@/i18n";

/*
 * Drop and paste on the Inbox page. The capture itself is the shell's `useCapture().captureData`
 * (optimistic job in the shell store → /api/ingest → status polling), so the page's "In Arbeit"
 * list shows the same job and status as the footbar and the palette.
 */

/** Data kinds the Inbox accepts from a drag (files, links, plain text). */
export const DROP_TYPES = ["Files", "text/uri-list", "text/plain"] as const;

/** True when a drag carries something the Inbox can capture (for the drop outline / dropEffect). */
export function acceptsDrop(types: readonly string[] | null | undefined): boolean {
  return !!types && types.some((type) => (DROP_TYPES as readonly string[]).includes(type));
}

/**
 * Hands a drop or paste to the capture hook. Returns how many captures started; when nothing
 * usable was in the data, tells the user instead of failing silently.
 */
export function takeInboxData(
  dt: DataTransfer | null,
  captureData: (dt: DataTransfer | null) => number,
  notify: (message: string) => void,
): number {
  if (!dt) return 0;
  const n = captureData(dt);
  if (n === 0) notify(t("Nothing to capture: drop a file, link or text"));
  return n;
}
