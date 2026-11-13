import {
  DOMAIN_OBJECT_FOLDERS,
  DOMAIN_OBJECT_TYPES,
  PRIORITIES,
  isDomainObjectType,
  type DomainObjectMetadataMap,
  type DomainObjectType,
} from "@kortex/db/domain";
import { getLocale, t, tx } from "@/i18n";

/*
 * Field sets of the 7 domain objects, typed against DomainObjectMetadataMap in @kortex/db:
 * the mapped type below fails to compile if a field is missing or unknown, so this table can
 * never drift from domain.ts. It drives the Smart Object pill bar, the property editor and
 * metadata validation.
 *
 * Labels and placeholders are getters (read in the language of the moment). The enum `options` are
 * the values stored in the frontmatter and stay as they are; `objectOptionLabel` gives their
 * display text.
 */

export type FieldKind = "text" | "link" | "date" | "number" | "money" | "percent" | "list" | "enum" | "url" | "record";

export interface FieldDef {
  label: string;
  kind: FieldKind;
  /** Shown as a pill in the one-line Smart Property bar (the rest only in the editor). */
  pill: boolean;
  options?: readonly string[];
  placeholder?: string;
}

type FieldTable = { [T in DomainObjectType]: { [K in keyof Required<DomainObjectMetadataMap[T]>]: FieldDef } };

export const OBJECT_FIELDS: FieldTable = {
  person: {
    role: { get label() { return t("Role"); }, kind: "text", pill: true, get placeholder() { return t("e.g. Lead Architect"); } },
    organization: { get label() { return t("Organization"); }, kind: "link", pill: true, get placeholder() { return t("Organization"); } },
    relationship: { get label() { return t("Relationship"); }, kind: "text", pill: true, get placeholder() { return t("e.g. colleague"); } },
    contact_info: { get label() { return t("Contact"); }, kind: "record", pill: false, get placeholder() { return t("email: name@company.com"); } },
  },
  project: {
    project_status: { get label() { return t("Status"); }, kind: "enum", pill: true, options: ["Idee", "Geplant", "In Arbeit", "Review", "Pausiert", "Fertig"] },
    priority: { get label() { return t("Priority"); }, kind: "enum", pill: true, options: PRIORITIES },
    tech_stack: { get label() { return t("Tech stack"); }, kind: "list", pill: true, placeholder: "Next.js, Supabase" },
    target_date: { get label() { return tx("property", "Target date"); }, kind: "date", pill: true },
    repo_or_url: { get label() { return t("Repo / URL"); }, kind: "url", pill: false, placeholder: "https://" },
  },
  organization: {
    industry: { get label() { return t("Industry"); }, kind: "text", pill: true, get placeholder() { return t("e.g. automotive"); } },
    org_type: { get label() { return t("Kind"); }, kind: "enum", pill: true, options: ["Kunde", "Partner", "Venture", "Bank", "Arbeitgeber", "Lieferant", "Community"] },
    location: { get label() { return tx("site", "Location"); }, kind: "text", pill: true },
    website: { get label() { return t("Website"); }, kind: "url", pill: true, placeholder: "https://" },
    key_contacts: { get label() { return t("Contacts"); }, kind: "list", pill: false, placeholder: "Sven Keller, Louisa Brandt" },
  },
  concept: {
    category: { get label() { return t("Category"); }, kind: "text", pill: true },
    maturity: { get label() { return t("Maturity"); }, kind: "enum", pill: true, options: ["Idee", "Erkundet", "Erprobt", "Etabliert"] },
    related_tools: { get label() { return t("Tools"); }, kind: "list", pill: true },
  },
  tool: {
    tool_category: { get label() { return t("Category"); }, kind: "text", pill: true },
    usage_status: { get label() { return t("Usage"); }, kind: "enum", pill: true, options: ["Im Stack", "Täglich", "Wöchentlich", "Gelegentlich", "Testphase", "Ausgemustert"] },
    pricing: { get label() { return t("Price"); }, kind: "text", pill: true },
    url: { get label() { return t("URL"); }, kind: "url", pill: true, placeholder: "https://" },
  },
  asset: {
    asset_type: { get label() { return t("Asset type"); }, kind: "text", pill: true, get placeholder() { return t("e.g. real estate"); } },
    location: { get label() { return tx("site", "Location"); }, kind: "text", pill: true },
    status: { get label() { return t("Status"); }, kind: "enum", pill: true, options: ["In Prüfung", "Aktiv", "Gekauft", "Vermietet", "Verkauft"] },
    monthly_value: { get label() { return t("Monthly value"); }, kind: "money", pill: true },
  },
  goal: {
    goal_timeframe: { get label() { return t("Timeframe"); }, kind: "text", pill: true, get placeholder() { return t("e.g. Q2 2027"); } },
    target_metric: { get label() { return t("Target metric"); }, kind: "text", pill: true },
    progress_pct: { get label() { return t("Progress"); }, kind: "percent", pill: true },
    status: { get label() { return t("Status"); }, kind: "enum", pill: false, options: ["Offen", "Auf Kurs", "Gefährdet", "Erreicht"] },
  },
};

export { DOMAIN_OBJECT_FOLDERS, DOMAIN_OBJECT_TYPES, isDomainObjectType };

/** Display text of a stored enum value of a domain object ("In Arbeit" → "In progress"); unknown values as they are. */
const OPTION_TEXT: Record<string, () => string> = {
  Idee: () => tx("status", "Idea"),
  Geplant: () => tx("status", "Planned"),
  "In Arbeit": () => tx("status", "In progress"),
  Review: () => tx("status", "Review"),
  Pausiert: () => tx("status", "Paused"),
  Fertig: () => tx("finish", "Done"),
  Kunde: () => tx("org", "Customer"),
  Partner: () => tx("org", "Partner"),
  Venture: () => tx("org", "Venture"),
  Bank: () => tx("org", "Bank"),
  Arbeitgeber: () => tx("org", "Employer"),
  Lieferant: () => tx("org", "Supplier"),
  Community: () => tx("org", "Community"),
  Erkundet: () => tx("status", "Explored"),
  Erprobt: () => tx("status", "Proven"),
  Etabliert: () => tx("status", "Established"),
  "Im Stack": () => tx("status", "In the stack"),
  Täglich: () => tx("usage", "Daily"),
  Wöchentlich: () => tx("usage", "Weekly"),
  Gelegentlich: () => tx("usage", "Occasionally"),
  Testphase: () => tx("status", "Trial"),
  Ausgemustert: () => tx("status", "Retired"),
  "In Prüfung": () => tx("status", "Under review"),
  Aktiv: () => tx("status", "Active"),
  Gekauft: () => tx("status", "Bought"),
  Vermietet: () => tx("status", "Rented out"),
  Verkauft: () => tx("status", "Sold"),
  Offen: () => tx("status", "Open"),
  "Auf Kurs": () => tx("status", "On track"),
  Gefährdet: () => tx("status", "At risk"),
  Erreicht: () => tx("status", "Achieved"),
};

export const objectOptionLabel = (value: string): string => OPTION_TEXT[value]?.() ?? value;

/** Title of a freshly created object ("Neu" in the title bar and the object hub). */
export const NEW_OBJECT_TITLE: Record<DomainObjectType, string> = {
  get person() {
    return t("New person");
  },
  get project() {
    return t("New project");
  },
  get organization() {
    return t("New organization");
  },
  get concept() {
    return t("New concept");
  },
  get tool() {
    return t("New tool");
  },
  get asset() {
    return t("New asset");
  },
  get goal() {
    return t("New goal");
  },
};

export function fieldsOf(type: DomainObjectType): [string, FieldDef][] {
  return Object.entries(OBJECT_FIELDS[type]);
}

export interface ValidationResult {
  /** Only known fields, coerced to their kind; empty values dropped. */
  metadata: Record<string, unknown>;
  /** Field key → message for values that could not be kept. */
  errors: Record<string, string>;
  /** Keys that are not part of the type's field set (dropped from metadata). */
  dropped: string[];
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses "4.200", "4.200,50", "4,5", "4200 €", "45 %" the German way. In English "4,200.50" and "4.2" are read the
 * English way; a comma that is no thousands separator ("4,5") still counts as the decimal comma.
 */
export function parseGermanNumber(input: unknown): number {
  if (typeof input === "number") return input;
  let s = String(input).replace(/[\s€%]/g, "");
  if (getLocale() !== "de") {
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    return s ? Number(s) : NaN;
  }
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return s ? Number(s) : NaN;
}

function coerce(def: FieldDef, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } | { ok: true; value: undefined } {
  if (value === null || value === undefined || value === "") return { ok: true, value: undefined };
  switch (def.kind) {
    case "text":
    case "link": {
      const v = String(value).trim();
      return { ok: true, value: v || undefined };
    }
    case "url": {
      const v = String(value).trim();
      if (!v) return { ok: true, value: undefined };
      return /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v) ? { ok: true, value: v } : { ok: false, error: t("Not a valid URL") };
    }
    case "date": {
      const v = String(value).trim();
      return isoDate.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, value: v } : { ok: false, error: t("Date as YYYY-MM-DD") };
    }
    case "number":
    case "money": {
      const n = parseGermanNumber(value);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: t("Not a number") };
    }
    case "percent": {
      const n = parseGermanNumber(value);
      if (!Number.isFinite(n)) return { ok: false, error: t("Not a number") };
      return n < 0 || n > 100 ? { ok: false, error: t("0 to 100") } : { ok: true, value: Math.round(n) };
    }
    case "list": {
      const arr = Array.isArray(value) ? value : String(value).split(",");
      const items = arr.map((x) => String(x).trim()).filter(Boolean);
      return { ok: true, value: items.length ? items : undefined };
    }
    case "enum": {
      const v = String(value).trim();
      return def.options?.includes(v) ? { ok: true, value: v } : { ok: false, error: t("Allowed: {options}", { options: def.options?.map(objectOptionLabel).join(", ") ?? "" }) };
    }
    case "record": {
      if (typeof value === "object" && !Array.isArray(value)) return { ok: true, value };
      // "key: value" pairs separated by commas or new lines
      const rec: Record<string, string> = {};
      for (const part of String(value).split(/[,\n]/)) {
        const [k, ...rest] = part.split(":");
        if (k?.trim() && rest.length) rec[k.trim()] = rest.join(":").trim();
      }
      return Object.keys(rec).length ? { ok: true, value: rec } : { ok: false, error: t("Format: key: value") };
    }
  }
}

/** Validates and normalises metadata against the type's field set (domain.ts). */
export function validateMetadata(type: DomainObjectType, metadata: Record<string, unknown>): ValidationResult {
  const fields = OBJECT_FIELDS[type] as Record<string, FieldDef>;
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const def = fields[key];
    if (!def) {
      dropped.push(key);
      continue;
    }
    const r = coerce(def, value);
    if (!r.ok) errors[key] = r.error;
    else if (r.value !== undefined) out[key] = r.value;
  }
  return { metadata: out, errors, dropped };
}

/**
 * Metadata after a type change: fields the new type shares (e.g. location, status) are kept
 * and re-validated, everything else is dropped. Converting to a plain note keeps nothing.
 */
export function convertMetadata(to: DomainObjectType | "note", metadata: Record<string, unknown>): Record<string, unknown> {
  if (to === "note") return {};
  return validateMetadata(to, metadata).metadata;
}

/** Folder an item should live in after becoming a domain object; null when it can stay. */
export function folderSuggestionFor(to: DomainObjectType | "note", currentPath: string): string | null {
  if (to === "note") return null;
  const target = DOMAIN_OBJECT_FOLDERS[to];
  const folder = currentPath.split("/").slice(0, -1).join("/");
  return folder === target ? null : target;
}
