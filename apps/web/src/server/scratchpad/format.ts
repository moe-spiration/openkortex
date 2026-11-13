import { t } from "@/i18n";
import { createHash } from "node:crypto";

/*
 * Scratchpad document (`00_Inbox/Scratchpad.md`): one Markdown list, one entry per bullet:
 *
 *   - 2026-10-31 14:05 · first line
 *     further lines, indented by two spaces (code fences included)
 *
 * Pure functions; the entry id is a short hash of timestamp + text, so it survives re-reads.
 */

export const SCRATCHPAD_TITLE = "Scratchpad";
export const SCRATCHPAD_FOLDER = "00_Inbox";
export const SCRATCHPAD_MAX_ENTRY = 20_000;

export interface ScratchEntry {
  id: string;
  /** `YYYY-MM-DD HH:mm` */
  at: string;
  text: string;
}

const HEAD = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ?(.*)$/;

export const entryId = (at: string, text: string) =>
  createHash("sha256").update(`${at}\n${text}`).digest("hex").slice(0, 10);

/** Local-looking stamp in the given zone offset-free form (server passes its clock). */
export function stamp(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function parseEntries(md: string): ScratchEntry[] {
  const out: ScratchEntry[] = [];
  let cur: { at: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.lines.join("\n").replace(/\s+$/, "");
    out.push({ id: entryId(cur.at, text), at: cur.at, text });
    cur = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const m = HEAD.exec(line);
    if (m) {
      flush();
      cur = { at: m[1]!, lines: [m[2]!] };
    } else if (cur && (line.startsWith("  ") || line === "")) {
      cur.lines.push(line.startsWith("  ") ? line.slice(2) : "");
    }
    // anything else (heading, preface) is kept by the writers, not parsed as an entry
  }
  flush();
  return out;
}

export function formatEntry(e: Pick<ScratchEntry, "at" | "text">): string {
  const [first = "", ...rest] = e.text.replace(/\s+$/, "").split(/\r?\n/);
  return [`- ${e.at} · ${first}`, ...rest.map((l) => (l ? `  ${l}` : ""))].join("\n");
}

/** Appends one entry (newest last) and keeps any other content in the file. */
export function appendEntry(md: string, e: Pick<ScratchEntry, "at" | "text">): string {
  const base = md.replace(/\s+$/, "");
  return `${base}${base ? "\n" : ""}${formatEntry(e)}\n`;
}

/** Drops the entries with these ids; the rest of the document stays byte-identical. */
export function removeEntries(md: string, ids: ReadonlySet<string>): string {
  const lines = md.split(/\r?\n/);
  const keep: string[] = [];
  let skipping = false;
  let i = 0;
  while (i < lines.length) {
    const m = HEAD.exec(lines[i]!);
    if (m) {
      let j = i + 1;
      while (j < lines.length && !HEAD.test(lines[j]!) && (lines[j]!.startsWith("  ") || lines[j] === "")) j++;
      const block = lines.slice(i, j);
      const [parsed] = parseEntries(block.join("\n"));
      skipping = !!parsed && ids.has(parsed.id);
      if (!skipping) keep.push(...block);
      i = j;
    } else {
      keep.push(lines[i]!);
      i++;
    }
  }
  return keep.join("\n").replace(/\n{3,}/g, "\n\n");
}

export const initialDoc = () =>
  `# ${SCRATCHPAD_TITLE}\n\n${t("Quick ideas, one entry per bullet.")}\n\n`;

/** Archive of cleaned-up lines (`10_Notes/Scratchpad-Archiv.md`): same bullet format, so nothing leaves the vault as JSON. */
export const SCRATCHPAD_ARCHIVE_TITLE = "Scratchpad-Archiv";
export const SCRATCHPAD_ARCHIVE_FOLDER = "10_Notes";

export const archiveInitialDoc = () =>
  `# ${SCRATCHPAD_ARCHIVE_TITLE}\n\n${t("Cleaned-up Scratchpad entries, one entry per bullet.")}\n\n`;

/** Appends the entries (oldest first) to an archive document; entries already in it are skipped. */
export function appendArchive(md: string, entries: readonly Pick<ScratchEntry, "at" | "text">[]): string {
  const have = new Set(parseEntries(md).map((e) => entryId(e.at, e.text)));
  let out = md;
  for (const e of entries) {
    if (have.has(entryId(e.at, e.text.replace(/\s+$/, "")))) continue;
    out = appendEntry(out, e);
  }
  return out;
}
