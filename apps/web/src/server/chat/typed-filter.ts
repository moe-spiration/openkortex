import { typeStatuses } from "@kortex/db";

/*
 * "Welche Filme will ich sehen?" is a filter question, not a similarity question. This turns such
 * a question into the same filter brain_search takes (type + metadata.status), without an AI call:
 * a small keyword table over the registry's types and status values. No match: the normal hybrid
 * search runs unchanged.
 */

export interface TypedFilter {
  type: "movie" | "book" | "product";
  /** Lifecycle value for metadata.status, or null when the question names only the type. */
  status: string | null;
}

const TYPE_WORDS: ReadonlyArray<readonly [TypedFilter["type"], RegExp]> = [
  ["movie", /\b(film\w*|serie\w*|movie\w*|series|kino)\b/i],
  ["book", /\b(buch|bücher|buecher|book\w*|roman\w*)\b/i],
  ["product", /\b(produkt\w*|product\w*)\b/i],
];

/** First matching pattern wins, so negations ("noch nicht gesehen") come before the plain verb. */
const STATUS_CUES: Record<TypedFilter["type"], ReadonlyArray<readonly [string, RegExp]>> = {
  movie: [
    ["to_watch", /nicht (?:\w+ )?(?:gesehen|geschaut)|noch sehen|sehen will|will\b.*\b(?:sehen|schauen|anschauen)|anschauen|schauen|watchlist|to.?watch|want to watch/i],
    ["watched", /gesehen|geschaut|watched/i],
  ],
  book: [
    ["want_to_read", /nicht (?:\w+ )?gelesen|noch lesen|lesen will|will\b.*\blesen|leseliste|to.?read|want to read/i],
    ["reading", /gerade|am lesen|lese ich|reading/i],
    ["read", /gelesen|\bread\b/i],
  ],
  product: [
    ["owned", /besitze|habe ich|gekauft|\bowned\b/i],
    ["wishlist", /wunsch|kaufen|wishlist|haben will|will\b.*\bhaben/i],
  ],
};

/** Words that make a bare "meine Filme" a list question too. */
const LIST_CUE = /\b(welche|alle|liste|zeig\w*|auflisten|which|list|show|what)\b/i;

export function parseTypedFilter(question: string): TypedFilter | null {
  const q = question.trim();
  if (!q || q.length > 200) return null;
  const type = TYPE_WORDS.find(([, re]) => re.test(q))?.[0];
  if (!type) return null;
  const allowed = typeStatuses(type);
  const status = STATUS_CUES[type].find(([s, re]) => allowed.includes(s) && re.test(q))?.[0] ?? null;
  // A type word alone ("Film Empfehlungen für Mathe") is no filter; it needs a status or a list cue.
  if (!status && !LIST_CUE.test(q)) return null;
  return { type, status };
}
