// Backfill-Plan für knowledge_items.source_url_norm. Der partielle UNIQUE-Index
// (user_id, source_url_norm) verträgt keine doppelten Werte; Altbestand kann aber Duplikate
// enthalten. Der Plan gibt dem ältesten Eintrag je Gruppe den Wert, alle weiteren bleiben NULL
// (kein Datenverlust, kein Indexfehler) und werden zum Zusammenführen gemeldet.

export interface BackfillRow {
  id: string;
  user_id: string;
  source_url: string | null;
  created_at: string;
}

export interface NormBackfillPlan {
  assign: Array<{ id: string; source_url_norm: string }>;
  /** Duplikate: bleiben NULL; `keptId` ist der Eintrag, der den Wert bekommt. */
  duplicates: Array<{ id: string; keptId: string; source_url_norm: string }>;
}

export function planSourceUrlNormBackfill(
  rows: readonly BackfillRow[],
  normalize: (url: string) => string | null,
): NormBackfillPlan {
  const sorted = [...rows].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const owner = new Map<string, string>(); // "user\0norm" -> id
  const plan: NormBackfillPlan = { assign: [], duplicates: [] };
  for (const row of sorted) {
    const norm = row.source_url ? normalize(row.source_url) : null;
    if (!norm) continue;
    const key = `${row.user_id}\0${norm}`;
    const keptId = owner.get(key);
    if (keptId === undefined) {
      owner.set(key, row.id);
      plan.assign.push({ id: row.id, source_url_norm: norm });
    } else {
      plan.duplicates.push({ id: row.id, keptId, source_url_norm: norm });
    }
  }
  return plan;
}
