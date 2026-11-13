import { useRef } from "react";
import type { KnowledgeItem } from "@/lib/workspace-data";

/*
 * Render stability for the note sheet (fx2-perf): a keystroke in the editor gives the note a new object (new contentMd,
 * a re-derived links array). The header, properties and footer do not show the text, so they get the previous object
 * as long as nothing but the text changed, and their memo boundaries hold.
 */

const sameArray = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/** True when `a` and `b` differ at most in `contentMd` (arrays compared element by element, everything else by identity). */
export function sameExceptText(a: KnowledgeItem, b: KnowledgeItem): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof KnowledgeItem)[];
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (k === "contentMd") continue;
    const x = a[k];
    const y = b[k];
    if (Object.is(x, y)) continue;
    if (Array.isArray(x) && Array.isArray(y) && sameArray(x, y)) continue;
    return false;
  }
  return true;
}

/**
 * The note without its live text: the same object while only `contentMd` changes. Its `contentMd` may be older than the
 * store's, so anything that shows or sends the text takes the live item instead.
 */
export function useItemMeta(item: KnowledgeItem): KnowledgeItem {
  const ref = useRef(item);
  if (!sameExceptText(ref.current, item)) ref.current = item;
  return ref.current;
}

/** The previous array while the new one has the same elements (by identity). */
export function useSameArray<T>(next: T[]): T[] {
  const ref = useRef(next);
  if (!sameArray(ref.current, next)) ref.current = next;
  return ref.current;
}
