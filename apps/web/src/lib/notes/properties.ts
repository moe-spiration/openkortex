import { t, tn, tx } from "@/i18n";
import type { KnowledgeItem } from "@/lib/workspace-data";
import { isDomainObjectType } from "@/lib/objects/schema";

/*
 * Smart Property Header (Tactile Craft v2, comment K2): which properties the drawer shows and how.
 * Visible: Typ (once, as the type menu), Erfasst, Tags (with one AI suggestion). Behind "N weitere: Ordner, Objekte,
 * Aufgaben · automatisch gesetzt": Ordner (with automatisch/manuell), Objekte (linked domain objects) and the task
 * progress when the note has tasks. Pure helpers, tested in properties.test.ts.
 */

export interface SourceLine {
  /** Domain of the source URL, or a description ("PDF · 530 Seiten", the vault folder). */
  label: string;
  /** External link when the item has a source URL. */
  href: string | null;
  /** Duration or page count, if known. */
  extra: string | null;
}

export type StatusTone = "new" | "ok" | "run" | "mute" | "crit";

export interface StatusPill {
  tone: StatusTone;
  label: string;
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/** "14 Min.", "42:10", "1:12:04" from metadata (duration_sec / duration). */
export function durationOf(meta: Record<string, unknown>): string | null {
  const sec = typeof meta.duration_sec === "number" ? meta.duration_sec : typeof meta.durationSec === "number" ? meta.durationSec : null;
  if (sec !== null && sec > 0) {
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
  }
  if (typeof meta.duration === "string" && meta.duration.trim()) return meta.duration.trim();
  if (typeof meta.reading_minutes === "number" && meta.reading_minutes > 0) return t("{n} min", { n: Math.round(meta.reading_minutes) });
  return null;
}

export function sourceLine(item: KnowledgeItem): SourceLine {
  const url = item.source?.url ?? null;
  const host = url ? hostOf(url) : null;
  const pages = item.source?.pageCount ?? (typeof item.metadata.page_count === "number" ? item.metadata.page_count : null);
  const pagesLabel = pages ? tn(pages, "{n} page", "{n} pages") : null;
  const extra = durationOf(item.metadata) ?? (host ? pagesLabel : null);
  if (host) return { label: host, href: url, extra };
  const format = item.source?.file?.format;
  if (format === "pdf" || format === "epub") return { label: [format.toUpperCase(), pagesLabel].filter(Boolean).join(" · "), href: null, extra: durationOf(item.metadata) };
  const folder = item.path.split("/")[0] ?? "";
  return { label: folder || "Vault", href: null, extra };
}

/** Pipeline status as a pill; plain processed notes show none (nothing to say). */
export function statusPill(item: KnowledgeItem): StatusPill | null {
  switch (item.status) {
    case "inbox":
      return { tone: "new", label: tx("status", "New") };
    case "processing":
      return { tone: "run", label: t("Processing") };
    case "error":
      return { tone: "crit", label: t("Error") };
    case "archived":
      return { tone: "mute", label: t("Archived") };
    case "processed":
      return { tone: "ok", label: t("Processed") };
    default:
      return null;
  }
}

/** Linked domain objects (persons, projects, …) of a note, in link order. */
export function linkedObjects(item: KnowledgeItem, all: Record<string, KnowledgeItem>): KnowledgeItem[] {
  return item.links.map((id) => all[id]).filter((o): o is KnowledgeItem => !!o && o.id !== item.id && isDomainObjectType(o.type));
}

export interface TaskProgress {
  done: number;
  total: number;
}

export function taskProgress(item: KnowledgeItem): TaskProgress | null {
  const total = item.actionItems.length;
  return total ? { done: item.actionItems.filter((a) => a.done).length, total } : null;
}

/** The collapsed "weitere" row: count and names of the properties behind it. */
export function moreProps(item: KnowledgeItem): { count: number; label: string; names: string[] } {
  const names = [t("Folder"), t("Objects"), ...(taskProgress(item) ? [t("Tasks")] : [])];
  return { count: names.length, names, label: t("{n} more: {names}", { n: names.length, names: names.join(", ") }) };
}

/** "manuell" when the user placed the item (the organizer leaves it alone, CLAUDE.md rule 3), else "automatisch". */
export const placementHint = (item: Pick<KnowledgeItem, "manualPlacement">): string => (item.manualPlacement ? t("manual") : t("automatic"));

/** Key Takeaways from the pipeline's metadata (key_takeaways, takeaways). */
export function takeawaysOf(item: Pick<KnowledgeItem, "metadata">): string[] {
  const raw = item.metadata.key_takeaways ?? item.metadata.takeaways;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);

/**
 * Local tag suggestions: known tags whose name parts occur in the text and that the item does not have yet,
 * best match first. Used for the AI chip in the drawer and the new-note editor (after the first paragraph).
 */
export function suggestTags(text: string, known: readonly string[], existing: readonly string[] = [], limit = 3): string[] {
  const inText = new Set(words(text));
  if (!inText.size) return [];
  const have = new Set(existing.map((t) => t.toLowerCase()));
  const scored: { tag: string; score: number }[] = [];
  for (const tag of new Set(known)) {
    if (have.has(tag.toLowerCase())) continue;
    const parts = words(tag.replace(/^#/, ""));
    const hits = parts.filter((p) => inText.has(p)).length;
    if (hits) scored.push({ tag, score: hits / parts.length + hits * 0.01 });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map((s) => s.tag);
}

/** First paragraph written? (the new-note editor offers tag suggestions from then on) */
export function hasFirstParagraph(md: string): boolean {
  return md
    .split(/\r?\n[ \t]*\r?\n/)
    .some((b) => b.replace(/^[#>\-*+\s\d.[\]x]+/i, "").trim().length >= 24);
}
