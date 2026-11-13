import { LIFE_AREAS, NOTES, OBJECT_ITEMS } from "@/lib/workspace-data";
import { fieldValue, linkIndex, monogram, objectColumns, objectStatusTone, OBJECT_STATUS_FIELD, shortDate, type DomainKind, type ObjectColumn, type StatusTone } from "@/lib/data/collections";
import { objectEntry, type EntryObject, type ViewEntry } from "./entries";
import { intlLocale, t } from "@/i18n";

/*
 * Record table of one object hub (Tactile Craft v2, dummy `Objects`), built on the server from the snapshot: the
 * frontmatter columns some object of the type has, linked entries (both link directions), objects mentioned in the
 * same entries, last contact (latest linked entry), Life area (metadata.life_area) and status. Nothing is invented:
 * missing values stay empty and columns nobody fills are left out.
 */

export interface ObjectRow {
  entry: ViewEntry;
  mono: string;
  /** Display values of the frontmatter columns by key. */
  values: Record<string, string>;
  linked: number;
  related: EntryObject[];
  /** Latest linked entry (ISO day) or metadata.last_contact. */
  last?: string;
  life?: { label: string; icon: string; tone: string };
  status?: { label: string; tone: StatusTone };
}

export interface ObjectTable {
  columns: ObjectColumn[];
  rows: ObjectRow[];
  /** Optional columns that at least one row fills. */
  has: { related: boolean; life: boolean; last: boolean; status: boolean };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function objectTable(type: DomainKind, filter?: (e: ViewEntry) => boolean): ObjectTable {
  const objects = OBJECT_ITEMS.filter((o) => o.type === type);
  const { itemsOf, objectsOf } = linkIndex(NOTES, OBJECT_ITEMS);
  const dateOf = new Map(NOTES.map((n) => [n.id, n.date]));
  const byId = new Map(OBJECT_ITEMS.map((o) => [o.id, o]));
  const statusKey = OBJECT_STATUS_FIELD[type];
  const columns = objectColumns(type, objects);

  const rows = objects
    .map((o): ObjectRow => {
      const entry = objectEntry(o);
      const items = itemsOf.get(o.id) ?? [];
      const relatedIds = new Set<string>();
      for (const i of items) for (const other of objectsOf.get(i) ?? []) if (other !== o.id) relatedIds.add(other);
      for (const l of o.links) if (byId.has(l) && l !== o.id) relatedIds.add(l);
      const related = [...relatedIds].flatMap((id) => {
        const r = byId.get(id);
        return r ? [{ id, title: r.title, kind: r.type as EntryObject["kind"], mono: monogram(r.title) }] : [];
      });
      const dates = items.map((i) => dateOf.get(i)).filter((d): d is string => !!d).sort();
      const last = dates.at(-1) ?? str(o.metadata.last_contact);
      const area = LIFE_AREAS.find((a) => a.key === str(o.metadata.life_area));
      const status = statusKey ? str(o.metadata[statusKey]) : undefined;
      const values: Record<string, string> = {};
      for (const c of columns) {
        const v = fieldValue(c.key, o.metadata[c.key]);
        if (v !== undefined) values[c.key] = v;
      }
      return {
        entry,
        mono: monogram(o.title),
        values,
        linked: items.length,
        related,
        ...(last ? { last } : {}),
        ...(area ? { life: { label: area.label, icon: area.icon, tone: area.tone } } : {}),
        ...(status ? { status: { label: status, tone: objectStatusTone(status) } } : {}),
      };
    })
    .filter((r) => !filter || filter(r.entry))
    .sort((a, b) => b.linked - a.linked || a.entry.title.localeCompare(b.entry.title, intlLocale()));

  return {
    columns,
    rows,
    has: {
      related: rows.some((r) => r.related.length > 0),
      life: rows.some((r) => !!r.life),
      last: rows.some((r) => !!r.last),
      status: rows.some((r) => !!r.status),
    },
  };
}

/** "Today" / "3 days ago" / the short date, relative to today. */
export function lastLabel(day: string, today: string): string {
  const d = Math.round((new Date(today + "T12:00:00Z").getTime() - new Date(day.slice(0, 10) + "T12:00:00Z").getTime()) / 864e5);
  if (Number.isNaN(d)) return day;
  if (d <= 0) return t("Today");
  if (d === 1) return t("Yesterday");
  if (d < 14) return t("{n} days ago", { n: d });
  return shortDate(day.slice(0, 10));
}
