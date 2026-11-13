/*
 * Item results of the command palette (Cmd/Ctrl+K): the local title match shows at once, the hybrid search
 * (GET /api/search, vector + full text) replaces it once it answers. Pure, so the merge is unit-tested.
 */

export interface PaletteHit {
  id: string;
  title: string;
  /** Folder or matching passage. */
  hint: string;
  /** Registry type (knowledge_items.type) when known. */
  type?: string;
}

/** Shortest query that goes to the server (shorter ones only match titles locally). */
export const REMOTE_MIN_CHARS = 2;
/** Wait after the last keystroke before asking the server. */
export const REMOTE_DEBOUNCE_MS = 220;

/**
 * Hybrid hits first (better ranking, finds content and meaning), then local title matches the server did not return
 * (e.g. items saved a second ago). `remote` null = no answer yet: the local hits as they are.
 */
export function mergePaletteHits(local: readonly PaletteHit[], remote: readonly PaletteHit[] | null, limit = 8): PaletteHit[] {
  if (!remote) return local.slice(0, limit);
  const seen = new Set<string>();
  const out: PaletteHit[] = [];
  for (const h of [...remote, ...local]) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
  }
  return out.slice(0, limit);
}

/** Server result → palette hit: the passage as hint when there is one, else the folder. */
export function hitFromSearch(r: { item_id: string; title: string; type: string; folder_path: string | null; snippet: string }): PaletteHit {
  const snippet = r.snippet.trim();
  return { id: r.item_id, title: r.title, type: r.type, hint: snippet ? (snippet.length > 90 ? snippet.slice(0, 89) + "…" : snippet) : (r.folder_path ?? "") };
}
