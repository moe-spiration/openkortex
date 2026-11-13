import { typeStatuses, validateTypeMetadata } from "@kortex/db";
import type { AuthContext } from "../auth";
import { findStatusTarget } from "../chat/action";
import { getItem, mergeJson, updateItem } from "../repo";

/*
 * "Film X gesehen" / "Dune gelesen, hat mir gefallen" by voice or quick capture is a status update
 * for an entry that already exists, not a new note. Deterministic (no AI call): a short one-line
 * capture with a past-tense verb whose title matches exactly one existing movie/book/product.
 * Anything else, and every capture without a matching entry, is stored as a note as before.
 */

export interface StatusCapture {
  title: string;
  type: "movie" | "book" | "product";
  status: string;
  feedback: string | null;
}

const VERBS: Record<string, { type: StatusCapture["type"]; status: string }> = {
  gesehen: { type: "movie", status: "watched" },
  geschaut: { type: "movie", status: "watched" },
  gelesen: { type: "book", status: "read" },
  ausgelesen: { type: "book", status: "read" },
  gekauft: { type: "product", status: "owned" },
};

const PATTERN =
  /^(?:ich\s+(?:habe|hab)\s+)?(.+?)\s+(?:(?:habe|hab)\s+ich\s+)?(?:(?:jetzt|gerade|heute|gestern|endlich|schon|nun)\s+)*(gesehen|geschaut|gelesen|ausgelesen|gekauft)\b[\s,.;:!-]*(.*)$/i;

const LEADING_NOUN = /^(?:(?:den|die|das|der|ein|eine)\s+)?(?:film|serie|buch|roman|produkt)\s+/i;

export function parseStatusCapture(text: string): StatusCapture | null {
  const t = text.trim();
  if (!t || t.length > 160 || t.includes("\n")) return null;
  const m = PATTERN.exec(t);
  if (!m) return null;
  const title = m[1]!.replace(LEADING_NOUN, "").replace(/^["„“'«]|["“”'»]$/g, "").trim();
  const verb = VERBS[m[2]!.toLowerCase()];
  if (!title || !verb || title.split(/\s+/).length > 8) return null;
  const feedback = m[3]!.trim().replace(/[.!]+$/, "");
  return { ...verb, title, feedback: feedback || null };
}

export interface StatusCaptureResult {
  id: string;
  type: string;
  status: string;
  folder_path: string;
  is_manual_placement: boolean | null;
}

/**
 * Applies the capture to the existing entry (status set, feedback only when there is none yet; every
 * other field stays) and returns it, or null when the text is no status update or nothing matches.
 */
export async function applyStatusCapture(
  ctx: AuthContext,
  text: string,
): Promise<StatusCaptureResult | null> {
  const parsed = parseStatusCapture(text);
  if (!parsed) return null;
  const target = await findStatusTarget(ctx, parsed.title, parsed.type, { exact: true });
  if (!target || !typeStatuses(target.type).includes(parsed.status)) return null;
  const patch: Record<string, unknown> = { status: parsed.status };
  const current = (target.metadata ?? {}) as { feedback?: unknown };
  if (parsed.feedback && !current.feedback) patch.feedback = parsed.feedback;
  const checked = validateTypeMetadata(target.type, patch);
  if (!checked.ok) return null;
  await updateItem(ctx.client, ctx.userId, target.id, {
    metadata: mergeJson(target.metadata, checked.metadata),
  });
  const item = await getItem(ctx.client, ctx.userId, target.id, [
    "id",
    "type",
    "status",
    "folder_path",
    "is_manual_placement",
  ]);
  return item as StatusCaptureResult | null;
}
