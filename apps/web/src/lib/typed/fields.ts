import { isDomainObjectType, typeDefinition, typeStatuses } from "@kortex/db";
import { getLocale, msg, t, tx } from "@/i18n";
import { parseGermanNumber } from "@/lib/objects/schema";

/*
 * Editable properties of the typed items (movie, book, product, place, receipt, ...), derived from the type
 * registry (packages/db/src/type-registry.ts): metadata.status from the type's status enum, the other fields from
 * its Zod schema. Pure, used by the note view's property section, the notes store and the save action.
 * Structured fields (product specs, session tabs) are not edited here; they keep their stored value.
 */

export type TypedKind = "text" | "longtext" | "number" | "date" | "enum" | "list";

export interface TypedField {
  key: string;
  label: string;
  kind: TypedKind;
  options?: readonly string[];
  min?: number;
  max?: number;
}

/** English sources, translated in `typedFieldsOf`. */
const LABELS: Record<string, string> = {
  status: msg("Status"),
  rating: msg("Rating (0–10)"),
  feedback: msg("Feedback"),
  kind: msg("Kind"),
  year: msg("Year"),
  genres: msg("Genres"),
  director: msg("Director"),
  cast: msg("Cast"),
  imdb_id: msg("IMDb ID"),
  pitch: msg("What it's about"),
  author: msg("Author"),
  isbn: msg("ISBN"),
  themes: msg("Topics"),
  price: msg("Price"),
  currency: msg("Currency"),
  shop: msg("Shop"),
  url: msg("URL"),
  category: msg("Category"),
  location: msg("Location"),
  note: msg("Note"),
  language: msg("Language"),
  source: msg("Source"),
  amount: msg("Amount"),
  date: msg("Date"),
  issuer: msg("Issuer"),
  tax: msg("Tax"),
  variables: msg("Variables"),
  use_case: msg("Use case"),
};

const OPTION_LABELS: Record<string, () => string> = {
  to_watch: () => tx("status", "Watchlist"),
  watched: () => tx("status", "Watched"),
  want_to_read: () => tx("status", "Want to read"),
  reading: () => tx("status", "Reading"),
  read: () => tx("status", "Read"),
  wishlist: () => tx("status", "Wishlist"),
  owned: () => tx("status", "Owned"),
  movie: () => tx("kind", "Movie"),
  series: () => tx("kind", "Series"),
  restaurant: () => tx("kind", "Restaurant"),
  travel: () => tx("kind", "Travel"),
  other: () => tx("kind", "Other"),
};

/** Label of an enum value (status, kind, category) in the current language; unknown values as they are. */
export const optionLabel = (v: string): string => OPTION_LABELS[v]?.() ?? v;

/** System fields that are written by capture, not by hand. */
const SKIP = new Set(["saved_at"]);

/** Minimal view of a Zod v4 schema node (read only, no Zod import needed). */
interface Node {
  type?: string;
  def?: { type?: string; innerType?: Node; element?: Node };
  options?: readonly string[];
  maxLength?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
}

const defType = (n: Node | undefined): string | undefined => n?.def?.type ?? n?.type;

function kindOf(key: string, raw: Node): Omit<TypedField, "key" | "label"> | null {
  let n: Node | undefined = raw;
  while (n && (defType(n) === "optional" || defType(n) === "nullable" || defType(n) === "default")) n = n.def?.innerType;
  switch (defType(n)) {
    case "enum":
      return { kind: "enum", options: n!.options ?? [] };
    case "number":
      return { kind: "number", ...(n!.minValue != null && Number.isFinite(n!.minValue) ? { min: n!.minValue } : {}), ...(n!.maxValue != null && Number.isFinite(n!.maxValue) ? { max: n!.maxValue } : {}) };
    case "string":
      if (key === "date") return { kind: "date" };
      return { kind: (n!.maxLength ?? 0) > 500 ? "longtext" : "text" };
    case "array":
      return defType(n!.def?.element) === "string" ? { kind: "list" } : null;
    default:
      return null; // records, objects: structured, not edited here
  }
}

/** Editable fields of a typed type, status first and feedback last; empty for free types and domain objects. */
export function typedFieldsOf(type: string | undefined): TypedField[] {
  const schema = type && !isDomainObjectType(type) ? typeDefinition(type)?.metadata : null;
  if (!schema) return [];
  const statuses = typeStatuses(type!);
  const out: TypedField[] = [];
  for (const [key, node] of Object.entries(schema.shape as Record<string, Node>)) {
    if (SKIP.has(key)) continue;
    const k = kindOf(key, node);
    if (!k) continue;
    out.push({ key, label: LABELS[key] ? t(LABELS[key]) : key, ...k, ...(key === "status" && statuses.length ? { kind: "enum" as const, options: statuses } : {}) });
  }
  const rank = (f: TypedField) => (f.key === "status" ? 0 : f.key === "rating" ? 2 : f.key === "feedback" ? 3 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Stored metadata reduced to the type's schema fields (what the note view may show and edit). */
export function typedMetadata(type: string, metadata: Record<string, unknown>): Record<string, unknown> {
  const schema = typeDefinition(type)?.metadata;
  if (!schema) return {};
  return Object.fromEntries(Object.keys(schema.shape).filter((k) => k in metadata).map((k) => [k, metadata[k]]));
}

/** Input text of a stored value. */
export function typedInput(field: TypedField, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (field.kind === "list" && Array.isArray(value)) return value.join(", ");
  if (field.kind === "number" && typeof value === "number") return getLocale() === "de" ? String(value).replace(".", ",") : String(value);
  return String(value);
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false; error: string };

/** Parses an input to the stored value (`undefined` = remove the field). Final check: validateTypeMetadata on save. */
export function parseTypedValue(field: TypedField, input: unknown): ParsedValue {
  if (input === undefined || input === null || (typeof input === "string" && !input.trim())) return { ok: true, value: undefined };
  switch (field.kind) {
    case "number": {
      const n = typeof input === "number" ? input : parseGermanNumber(input);
      if (!Number.isFinite(n)) return { ok: false, error: t("Not a number") };
      if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max))
        return { ok: false, error: t("Allowed: {min} to {max}", { min: field.min ?? "…", max: field.max ?? "…" }) };
      return { ok: true, value: field.key === "year" ? Math.round(n) : n };
    }
    case "date": {
      const v = String(input).trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, value: v } : { ok: false, error: t("Date as YYYY-MM-DD") };
    }
    case "enum": {
      const v = String(input).trim();
      return field.options?.includes(v) ? { ok: true, value: v } : { ok: false, error: t("Allowed: {options}", { options: field.options?.map(optionLabel).join(", ") ?? "" }) };
    }
    case "list": {
      const arr = (Array.isArray(input) ? input : String(input).split(",")).map((x) => String(x).trim()).filter(Boolean);
      return { ok: true, value: arr.length ? arr : undefined };
    }
    default: {
      const v = String(input).trim();
      return { ok: true, value: v || undefined };
    }
  }
}
