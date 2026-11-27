/*
 * Living dossiers on the phone (docs/agent-copilot.md, read side of apps/web/src/lib/dossier.ts): the entry of a
 * person, company or project carries "Where things stand" and "Open points" (agent) and "My notes" (user) as plain
 * Markdown sections, with the headings in either language. The phone only reads them, for the Ruhe dossier page.
 * Pure, covered by tests.
 */

export type DossierKey = "state" | "open" | "own";

export const DOSSIER_TYPES = ["person", "organization", "project"] as const;
export const isDossierType = (type?: string | null): boolean => !!type && (DOSSIER_TYPES as readonly string[]).includes(type);

const HEADINGS: Record<DossierKey, readonly [string, string]> = {
  state: ["Where things stand", "Stand der Dinge"],
  open: ["Open points", "Offene Punkte"],
  own: ["My notes", "Eigene Notizen"],
};
const ORDER: readonly DossierKey[] = ["state", "open", "own"];

const norm = (s: string) =>
  s
    .replace(/[*_`]/g, "")
    .replace(/[:：]\s*$/, "")
    .trim()
    .toLowerCase();
const keyOf = (heading: string): DossierKey | null => ORDER.find((k) => HEADINGS[k].some((h) => norm(h) === norm(heading))) ?? null;

export interface DossierView {
  /** "Where things stand" as Markdown; "" when missing. */
  state: string;
  /** Open points, one per list item; ticked items are left out. */
  open: string[];
  /** The user's own notes as Markdown. */
  own: string;
  /** Everything outside the three sections (without a leading H1 title), as Markdown. */
  rest: string;
}

export function readDossier(md: string): DossierView {
  const lines = md.split("\n");
  const heads: { line: number; level: number; key: DossierKey | null }[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ line: i, level: m[1]!.length, key: keyOf(m[2]!) });
  });
  const found: { key: DossierKey; start: number; end: number }[] = [];
  heads.forEach((h, i) => {
    if (!h.key || found.some((s) => s.key === h.key)) return;
    const next = heads.slice(i + 1).find((n) => n.level <= h.level);
    found.push({ key: h.key, start: h.line, end: next ? next.line : lines.length });
  });
  const body = (key: DossierKey) => {
    const s = found.find((x) => x.key === key);
    return s ? lines.slice(s.start + 1, s.end).join("\n").trim() : "";
  };
  const open = body("open")
    .split("\n")
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && !m[1]?.trim())
    .map((m) => m[2]!.trim());
  const inside = (i: number) => found.some((s) => i >= s.start && i < s.end);
  const restLines = lines.filter((_, i) => !inside(i));
  const firstText = restLines.findIndex((l) => l.trim());
  if (firstText >= 0 && /^#\s+/.test(restLines[firstText]!)) restLines.splice(firstText, 1);
  return { state: body("state"), open, own: body("own"), rest: restLines.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
