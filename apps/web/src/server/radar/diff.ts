import { byLocale } from "@kortex/i18n";
import { t, tn } from "@/i18n";
import { createHash } from "node:crypto";

/*
 * Text snapshot and line diff of the delta radar. Small on purpose: the snapshot is the page's text
 * (Markdown, links reduced to their text, whitespace collapsed) capped to SNAPSHOT_MAX chars, and the
 * diff is "lines that appeared / disappeared". Hash and diff are computed on the same capped text.
 */

export const SNAPSHOT_MAX = 6000;
const LINE_MAX = 200;
const DIFF_LINES = 8;
/* The section is written in the account language and found again under either heading (older notes are German). */
const SECTIONS = { en: "## Changes", de: "## Änderungen" } as const;
const MAX_ENTRIES = 10;

/** Page Markdown → normalised lines (no images, link targets, empty or duplicate lines). */
export function snapshotLines(markdown: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/, "")
      .replace(/[*_`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line.length < 2 || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/** The capped snapshot text of a page (whole lines, at most SNAPSHOT_MAX characters). */
export function snapshotText(markdown: string): string {
  const kept: string[] = [];
  let size = 0;
  for (const line of snapshotLines(markdown)) {
    if (size + line.length + 1 > SNAPSHOT_MAX) break;
    kept.push(line);
    size += line.length + 1;
  }
  return kept.join("\n");
}

export const textHash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

export interface LineDiff {
  added: string[];
  removed: string[];
  /** Counts before the lists were cut. */
  addedCount: number;
  removedCount: number;
}

const cut = (s: string) => (s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s);

/** Lines that are new / gone between two snapshot texts (order-insensitive). */
export function diffSnapshots(before: string, after: string): LineDiff {
  const b = new Set(before.split("\n").filter(Boolean));
  const a = new Set(after.split("\n").filter(Boolean));
  const added = [...a].filter((l) => !b.has(l));
  const removed = [...b].filter((l) => !a.has(l));
  return {
    added: added.slice(0, DIFF_LINES).map(cut),
    removed: removed.slice(0, DIFF_LINES).map(cut),
    addedCount: added.length,
    removedCount: removed.length,
  };
}

/** Plain summary when no model is available: "3 Zeilen neu, 1 entfernt". */
export function countSummary(d: LineDiff): string {
  const parts: string[] = [];
  if (d.addedCount) parts.push(tn(d.addedCount, "{n} line new", "{n} lines new"));
  if (d.removedCount) parts.push(t("{n} removed", { n: d.removedCount }));
  return parts.join(", ") || t("Content changed");
}

/** Prompt input of the summary call: the changed lines only, bounded. */
export function diffPrompt(title: string, d: LineDiff): string {
  const list = (label: string, lines: string[]) => (lines.length ? `${label}:\n${lines.map((l) => `- ${l}`).join("\n")}` : "");
  const l = byLocale({ en: { page: "Page", added: "New", removed: "Removed" }, de: { page: "Seite", added: "Neu", removed: "Entfernt" } });
  return [`${l.page}: ${title}`, list(l.added, d.added), list(l.removed, d.removed)].filter(Boolean).join("\n\n").slice(0, 3000);
}

export const diffSystem = (): string =>
  byLocale({
    en:
      "You summarise changes on a watched web page. Answer in English in one or two short sentences " +
      "(at most 240 characters), only with what the lines say: what is new, what is gone. No introduction, no guesses.",
    de:
      "Du fasst Änderungen auf einer beobachteten Webseite zusammen. Antworte auf Deutsch in einem bis zwei kurzen Sätzen " +
      "(höchstens 240 Zeichen), nur mit dem, was in den Zeilen steht: was ist neu, was ist weggefallen. Keine Einleitung, keine Vermutungen.",
  });

/**
 * Appends "- YYYY-MM-DD: summary" to the item's "## Änderungen" section (created at the end when missing).
 * Keeps the newest MAX_ENTRIES bullets. The rest of the Markdown is left untouched.
 */
export function appendChangeEntry(contentMd: string, day: string, summary: string): string {
  const entry = `- ${day}: ${summary.replace(/\s+/g, " ").trim()}`;
  const md = contentMd.replace(/\s+$/, "");
  // An existing section wins, whichever language it was written in.
  const found = [SECTIONS.en, SECTIONS.de]
    .map((section) => ({ section, start: md.startsWith(`${section}\n`) ? 0 : md.indexOf(`\n${section}\n`) + 1 || -1 }))
    .find((x) => x.start >= 0);
  if (!found) return `${md}\n\n${byLocale(SECTIONS)}\n\n${entry}\n`;
  const { start } = found;
  const bodyStart = start + found.section.length + 1;
  const next = md.slice(bodyStart).search(/\n## /);
  const end = next < 0 ? md.length : bodyStart + next;
  const bullets = md
    .slice(bodyStart, end)
    .split("\n")
    .filter((l) => l.startsWith("- "));
  const kept = [...bullets, entry].slice(-MAX_ENTRIES);
  return `${md.slice(0, bodyStart)}\n${kept.join("\n")}\n${md.slice(end)}`.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}
