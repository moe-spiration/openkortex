import type { WindowLabel } from "./bridge";

/** Window labels that tauri.conf.json opens with `?window=<label>`. */
export const WINDOW_LABELS: WindowLabel[] = [
  "main",
  "hud",
  "capture",
  "tray",
  "meetings",
  "audio",
  "settings",
];
export const NATIVE_WINDOWS = ["meetings", "audio", "settings"] as const;

/** `?window=` → known label, or null for the browser desktop preview. */
export function resolveWindow(param: string | null): WindowLabel | null {
  return param && (WINDOW_LABELS as string[]).includes(param) ? (param as WindowLabel) : null;
}
