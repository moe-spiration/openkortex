import { INBOX_TARGET_FOLDERS } from "@/lib/workspace-data";
import type { ReviewItem } from "./useInbox";

/* Ruhe Inbox (InboxRuhe.tsx): which view bar tab a proposal belongs to and the short folder name on its chip. */

export type InboxLens = "all" | "suggested" | "unclear";

/** Below this organizer confidence a proposal counts as unclear. */
export const UNCLEAR_BELOW = 60;

/** Lens of a proposal: unclear without a target or with low confidence, else suggested. */
export function lensOf(row: Pick<ReviewItem, "chosenTarget">, confidence: number | undefined): Exclude<InboxLens, "all"> {
  return !row.chosenTarget || (confidence !== undefined && confidence < UNCLEAR_BELOW) ? "unclear" : "suggested";
}

/** Short name of a vault folder for the chip: the target's label, else its last path segment. */
export function folderLabel(path: string): string {
  const known = INBOX_TARGET_FOLDERS.find((x) => x.path === path);
  if (known) return known.label;
  const last = path.split("/").filter(Boolean).pop() ?? path;
  return last.replace(/^\d+_/, "").replace(/_/g, " ");
}
