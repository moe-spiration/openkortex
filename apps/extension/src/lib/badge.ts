// C2 Autosave: the toolbar badge is the feedback that survives the popup closing. Pure mapping
// here (tested), the chrome.action calls live in the background worker.
import type { SubmitResult } from "./outbox";

export interface BadgeView {
  text: string;
  /** Badge background; the status tokens of Tactile Craft (synced / processing / urgent). */
  color: string;
}

/** How long the badge stays before the plain icon comes back. */
export const BADGE_MS = 4000;

export function badgeFor(result: SubmitResult): BadgeView {
  if (!result.ok) return { text: "!", color: "#EF4444" };
  if (!result.delivered) return { text: "…", color: "#F59E0B" };
  return { text: "✓", color: "#10B981" };
}
