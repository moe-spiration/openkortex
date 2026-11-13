import { typeFromTags, typeFromUrl, type RegisteredType } from "@kortex/db";
import { RETYPABLE_TYPES } from "../enrichment/auto-organizer";
import { isTypedExtractionType, type TypedExtractionType } from "./extraction";

/** URL rules at or above this confidence retype without asking the model. */
export const URL_RULE_MIN_CONFIDENCE = 0.85;

export interface TypeResolution {
  /** Typed type to run the extraction for (movie, book, …), or null. */
  extractAs: TypedExtractionType | null;
  /** Type set without extraction (a clip URL no adapter took → video, a reel → social), or null. */
  directType: RegisteredType | null;
  /** Why: "hint" | "url:<rule>" | "organizer" | "tag" | null. */
  reason: string | null;
}

const NONE: TypeResolution = { extractAs: null, directType: null, reason: null };

/**
 * Which type a generic capture (note/article/bookmark) really is. Order: the client's hint, a
 * clear URL rule (registry), the organizer's own `suggestedType`, then the tags it assigned
 * ("buch" → book). Other item types are never touched.
 */
export function resolveItemType(p: {
  payloadType: string;
  typeHint?: string | undefined;
  url?: string | undefined;
  suggestedType: TypedExtractionType | null;
  tags: readonly string[];
}): TypeResolution {
  if (!RETYPABLE_TYPES.has(p.payloadType)) return NONE;
  if (isTypedExtractionType(p.typeHint)) return { extractAs: p.typeHint, directType: null, reason: "hint" };
  const byUrl = typeFromUrl(p.url);
  if (byUrl && byUrl.confidence >= URL_RULE_MIN_CONFIDENCE) {
    const reason = `url:${byUrl.rule}`;
    return isTypedExtractionType(byUrl.type)
      ? { extractAs: byUrl.type, directType: null, reason }
      : byUrl.type === p.payloadType
        ? NONE
        : { extractAs: null, directType: byUrl.type, reason };
  }
  if (p.suggestedType) return { extractAs: p.suggestedType, directType: null, reason: "organizer" };
  const byTag = typeFromTags(p.tags);
  if (byTag && isTypedExtractionType(byTag)) return { extractAs: byTag, directType: null, reason: "tag" };
  return NONE;
}
