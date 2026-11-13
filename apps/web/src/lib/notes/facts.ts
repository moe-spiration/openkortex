import { getLocale, intlLocale, t } from "@/i18n";
import type { KnowledgeItem } from "@/lib/workspace-data";
import { isDomainObjectType } from "@/lib/objects/schema";
import { optionLabel, typedFieldsOf } from "@/lib/typed/fields";
import { durationOf } from "./properties";

/*
 * Feinschliff Live, note head: the date line under the type glyph and the read-only key facts shown as pills next to
 * the tags. Pure helpers, tested in facts.test.ts. Domain objects show their own editable pills (PropertyPills).
 */

export interface KeyFact {
  key: string;
  label: string;
  value: string;
}

const MAX_FACTS = 3;
const LONG = 48;

const show = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : null;
  if (typeof v === "number") return getLocale() === "de" ? String(v).replace(".", ",") : String(v);
  if (typeof v === "boolean") return v ? t("Yes") : t("No");
  if (typeof v === "string") return v.trim() || null;
  return null;
};

/** Up to three filled facts of a typed item (status, rating, author …) plus its duration or page count. */
export function keyFacts(item: Pick<KnowledgeItem, "type" | "dbType" | "metadata">): KeyFact[] {
  if (isDomainObjectType(item.type)) return [];
  const out: KeyFact[] = [];
  for (const f of typedFieldsOf(item.dbType)) {
    if (f.kind === "longtext") continue;
    const raw = item.metadata[f.key];
    const v = f.kind === "enum" && typeof raw === "string" ? optionLabel(raw) : show(raw);
    if (!v || v.length > LONG) continue;
    out.push({ key: f.key, label: f.label.replace(/\s*\(.*\)$/, ""), value: f.key === "rating" ? `${v}/10` : v });
    if (out.length >= MAX_FACTS) break;
  }
  const dur = durationOf(item.metadata);
  if (dur && out.length < MAX_FACTS + 1) out.push({ key: "duration", label: t("Duration"), value: dur });
  const pages = item.metadata.page_count;
  if (typeof pages === "number" && pages > 0 && !dur) out.push({ key: "pages", label: t("Pages"), value: String(pages) });
  return out;
}

const DAY_MS = 86_400_000;
const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T12:00:00Z`) / DAY_MS);

/** "Heute 09:30", "Gestern 21:30", else "Di, 27. Okt. 10:00" (the year only when it is not the current one). */
export function whenLine(date: string, time: string, today: string): string {
  const diff = dayNo(today) - dayNo(date);
  const at = time ? ` ${time}` : "";
  if (diff === 0) return t("Today") + at;
  if (diff === 1) return t("Yesterday") + at;
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return time;
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const label = d.toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
  return `${label}${at}`;
}

/** Initials of a name for the avatar stack ("Sven Bauer" → "SB"). */
export function initialsOf(name: string): string {
  const all = name.trim().split(/\s+/).filter(Boolean);
  const named = all.filter((w) => !w.endsWith("."));
  const parts = named.length ? named : all;
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "·";
}

/** Label of the people pill: one or two names, else "Sven, Anna +2". */
export function peopleLabel(names: readonly string[]): string {
  // First name, skipping titles such as "Dr." or "Prof.".
  const first = names.map((n) => n.trim().split(/\s+/).find((w) => !w.endsWith(".")) ?? n);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${first[0]}, ${first[1]}`;
  return `${first[0]}, ${first[1]} +${names.length - 2}`;
}
