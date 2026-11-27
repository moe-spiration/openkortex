import type { KnowledgeItemType } from "@kortex/db";
import { BrainError } from "./util";

// Reading queue, read status and managed daily-note sections: what an outside assistant (Noema's
// Morning Brief) needs without a seventh tool. Pure helpers; the tools in tools.ts wire them up.

export const READ_STATUSES = ["unread", "read", "skipped"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

/** Types the reading queue draws from: clippings and documents with free metadata. */
export const READING_TYPES = [
  "article",
  "video",
  "podcast",
  "social",
  "bookmark",
  "pdf",
  "epub",
] as const satisfies readonly KnowledgeItemType[];

export const isReadingType = (type: string): boolean =>
  (READING_TYPES as readonly string[]).includes(type);

/**
 * Unread at `at`: no `metadata.read_status` (or "unread") and not snoozed past that instant.
 * A snooze (remind_at in the future) hides an item from the queue until it is due again.
 */
export function isUnread(
  metadata: Record<string, unknown> | null | undefined,
  remindAt: string | null | undefined,
  at: string,
): boolean {
  const status = metadata?.read_status;
  if (status === "read" || status === "skipped") return false;
  return !remindAt || Date.parse(remindAt) <= Date.parse(at);
}

/** Metadata patch for a read status; "unread" removes both keys again. */
export function readStatusPatch(status: ReadStatus, now: Date): Record<string, unknown> {
  if (status === "unread") return { read_status: null, read_at: null };
  return { read_status: status, read_at: now.toISOString() };
}

const FENCE = /^\s*(```|~~~)/;
const TOP_HEADING = /^#{1,2}\s/;

/** Section bodies sit under a `##` heading, so they may only use `###` and deeper. */
export function checkSectionBody(body: string): void {
  let fenced = false;
  for (const line of body.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced && TOP_HEADING.test(line)) {
      throw new BrainError('Section content must not contain "#" or "##" headings (use "###" and deeper)');
    }
  }
}

/**
 * Replaces the `## <heading>` section of a Markdown note (up to the next `#`/`##` heading) with
 * `body`, or appends it at the end. Everything else in the note stays as it is, so the same call
 * twice gives the same note (idempotent).
 */
export function upsertSection(markdown: string, heading: string, body: string): string {
  const title = heading.trim();
  const block = [`## ${title}`, "", ...body.trim().split("\n")];
  const lines = markdown.replace(/\s+$/, "").split("\n");
  const want = title.toLowerCase();
  let start = -1;
  let end = lines.length;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !TOP_HEADING.test(line)) continue;
    if (start >= 0) {
      end = i;
      break;
    }
    const m = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[1]!.toLowerCase() === want) start = i;
  }
  if (start < 0) {
    const head = lines.join("\n").trim();
    return `${head ? `${head}\n\n` : ""}${block.join("\n")}\n`;
  }
  const after = lines.slice(end);
  // The heading line stays as the user or an earlier call wrote it.
  block[0] = lines[start]!;
  return [...lines.slice(0, start), ...block, ...(after.length ? ["", ...after] : [])].join("\n").trimEnd() + "\n";
}
