/**
 * `@` opens the entity search only at a word start: after nothing, whitespace or an opening
 * bracket/quote. Mid-word (`name@host`, e-mail addresses) it stays a plain character.
 */
export function mentionAllowed(charBefore: string): boolean {
  return charBefore === "" || /[\s([{"'„«]/.test(charBefore);
}

export interface MentionTarget {
  id: string;
  title: string;
  path?: string;
  /** Type label of the item (Person, Projekt, Buch, ...), shown as a hint when the host knows it. */
  typeLabel?: string;
}

const MAX_MENTION_RESULTS = 8;

/** Entities whose title contains the query (prefix hits first); empty query: the first ones as given. */
export function searchMentions<T extends MentionTarget>(targets: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const hits = targets.filter((t) => t.title.toLowerCase().includes(q));
  if (q) hits.sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)));
  return hits.slice(0, MAX_MENTION_RESULTS);
}
