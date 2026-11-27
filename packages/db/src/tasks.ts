// Rich action items: timeframe vocabulary, portable Markdown line and export (checklist, CSV).
// Shared by ai-core (extractor), web, mobile and mcp-server. Pure, no I/O. See docs/tasks-export.md.
import { getLocale, type Locale } from "@kortex/i18n";

/** Named timeframes; a concrete day is stored as `YYYY-MM-DD` in the same `action_items.timeframe` text column. */
export const TIMEFRAMES = ["today", "this_week", "later"] as const;
export type NamedTimeframe = (typeof TIMEFRAMES)[number];

/**
 * Words of the named timeframes per language. They are also WRITTEN INTO and PARSED FROM task lines
 * in the vault (`Zeitrahmen: diese Woche` / `Timeframe: this week`), so they are a fixed table and
 * not catalog entries: a reader accepts every language, whatever the current one is.
 */
const TIMEFRAME_WORDS: Record<Locale, Record<NamedTimeframe, string>> = {
  en: { today: "today", this_week: "this week", later: "later" },
  de: { today: "heute", this_week: "diese Woche", later: "später" },
};

/** Labels in the current language (getters, so the exported shape stays a plain record). */
export const TIMEFRAME_LABEL: Record<NamedTimeframe, string> = {
  get today() {
    return TIMEFRAME_WORDS[getLocale()].today;
  },
  get this_week() {
    return TIMEFRAME_WORDS[getLocale()].this_week;
  },
  get later() {
    return TIMEFRAME_WORDS[getLocale()].later;
  },
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts a named timeframe (also its English or German label) or an ISO day; anything else becomes null. */
export function normalizeTimeframe(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const day = trimmed.slice(0, 10);
  if (ISO_DAY.test(day)) return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? null : day;
  const s = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if ((TIMEFRAMES as readonly string[]).includes(s)) return s;
  for (const words of Object.values(TIMEFRAME_WORDS))
    for (const k of TIMEFRAMES) if (words[k].toLowerCase().replace(" ", "_") === s) return k;
  return null;
}

/** Label of a timeframe in `locale` (default: the current language); an ISO day stays as it is. */
export const timeframeLabel = (tf: string | null | undefined, locale: Locale = getLocale()): string => {
  const n = normalizeTimeframe(tf);
  if (!n) return "";
  return (TIMEFRAME_WORDS[locale] as Record<string, string>)[n] ?? n;
};

/** Bucket used by the filters (web and mobile): named timeframes as is, a day relative to `today`. */
export function timeframeBucket(tf: string | null | undefined, today: string): NamedTimeframe | null {
  const n = normalizeTimeframe(tf);
  if (!n) return null;
  if ((TIMEFRAMES as readonly string[]).includes(n)) return n as NamedTimeframe;
  if (n <= today) return "today";
  const d = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 864e5;
  const weekEnd = d(today) + ((7 - new Date(`${today}T12:00:00Z`).getUTCDay()) % 7);
  return d(n) <= weekEnd ? "this_week" : "later";
}

// --- Export ------------------------------------------------------------------------------------------

export interface ExportTask {
  title: string;
  done?: boolean;
  priority?: string | null;
  /** ISO day or timestamp. */
  due?: string | null;
  timeframe?: string | null;
  context?: string | null;
  /** Title of the linked project / goal object. */
  project?: string | null;
  assignee?: string | null;
  externalRef?: string | null;
  /** Task id: rendered as a trailing `<!-- task:<id> -->` marker (vault round trip, docs/tasks-export.md). */
  id?: string | null;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Keys of a task line per language. Like the timeframe words they are stored in the vault and read
 * back, so they are a fixed table: `formatTaskLine` writes one language, `parseTaskLine` reads all.
 */
const LINE_KEYS: Record<Locale, { assignee: string; project: string; timeframe: string; due: string; context: string }> = {
  en: { assignee: "Owner", project: "Project", timeframe: "Timeframe", due: "Due", context: "Context" },
  de: { assignee: "Zuständig", project: "Projekt", timeframe: "Zeitrahmen", due: "Fällig", context: "Kontext" },
};

/**
 * Assignees that mean the user (the extractors' default "Me", the German "Ich"): a task line leaves them
 * out, since every task without an owner is the user's anyway.
 */
const SELF_ASSIGNEES = new Set(["me", "ich", "self", "user"]);
/** The assignee worth showing on a task line, or null for none or the user. */
export function shownAssignee(assignee: string | null | undefined): string | null {
  const a = assignee?.replace(/\s+/g, " ").trim().replace(/^@/, "");
  return a && !SELF_ASSIGNEES.has(a.toLowerCase()) ? a : null;
}
type LineKey = keyof (typeof LINE_KEYS)["en"];
const LINE_KEY_OF = new Map<string, LineKey>(
  Object.values(LINE_KEYS).flatMap((keys) => (Object.entries(keys) as [LineKey, string][]).map(([k, word]) => [word, k] as const)),
);
const LINE_KEY_RE = new RegExp(`^(${[...LINE_KEY_OF.keys()].join("|")}): (.+)$`);

/**
 * One portable checklist line: `- [ ] Title · Owner: Max · Project: [[Kortex]] · Timeframe: this week ·
 * Due: 2026-11-05 · Context: why <!-- task:<id> -->` (German: `Zuständig:`, `Projekt:`, `Zeitrahmen: diese Woche`,
 * `Fällig:`, `Kontext:`; the owner only when it is not the user). Every key and the id marker are optional (exports leave the id out);
 * `parseTaskLine` reads both languages back. `locale` defaults to the current language.
 */
export function formatTaskLine(task: ExportTask, locale: Locale = getLocale()): string {
  const key = LINE_KEYS[locale];
  const parts = [clean(task.title)];
  const owner = shownAssignee(task.assignee);
  if (owner) parts.push(`${key.assignee}: ${owner}`);
  if (task.project?.trim()) parts.push(`${key.project}: [[${clean(task.project)}]]`);
  const tf = timeframeLabel(task.timeframe, locale);
  if (tf) parts.push(`${key.timeframe}: ${tf}`);
  if (task.due) parts.push(`${key.due}: ${task.due.slice(0, 10)}`);
  if (task.context?.trim()) parts.push(`${key.context}: ${clean(task.context)}`);
  const marker = task.id?.trim() ? ` <!-- task:${task.id.trim()} -->` : "";
  return `- [${task.done ? "x" : " "}] ${parts.join(" · ")}${marker}`;
}

export interface ParsedTaskLine {
  title: string;
  done: boolean;
  /** `Owner:` / `Zuständig:` (read-only, like the project). */
  assignee: string | null;
  project: string | null;
  timeframe: string | null;
  due: string | null;
  context: string | null;
  /** Id from the `<!-- task:<id> -->` marker; null for a line typed by hand (or a stripped marker). */
  id: string | null;
}

const LINE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/;
const ID_MARKER = /\s*<!--\s*task:([\w-]+)\s*-->$/;

/** Inverse of `formatTaskLine` (English and German keys); lines without trailing `Key: value` segments yield only the title. */
export function parseTaskLine(line: string): ParsedTaskLine | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const marker = ID_MARKER.exec(m[2]!);
  const body = marker ? m[2]!.slice(0, marker.index).trimEnd() : m[2]!;
  if (!body) return null;
  const segs = body.split(" · ");
  const out: ParsedTaskLine = {
    title: "",
    done: m[1] !== " ",
    assignee: null,
    project: null,
    timeframe: null,
    due: null,
    context: null,
    id: marker?.[1] ?? null,
  };
  const titleParts: string[] = [];
  for (const seg of segs) {
    const kv = LINE_KEY_RE.exec(seg);
    // The first segment is always the title; later non-key segments belong to it too.
    if (!kv || titleParts.length === 0) {
      titleParts.push(seg);
      continue;
    }
    const v = kv[2]!.trim();
    const field = LINE_KEY_OF.get(kv[1]!);
    if (field === "assignee") out.assignee = v;
    else if (field === "project") out.project = /^\[\[(.+)\]\]$/.exec(v)?.[1] ?? v;
    else if (field === "timeframe") out.timeframe = normalizeTimeframe(v);
    else if (field === "due") out.due = ISO_DAY.test(v) ? v : null;
    else out.context = v;
  }
  out.title = titleParts.join(" · ");
  return out;
}

/** Markdown checklist for the clipboard / a `.md` download. */
export function tasksToMarkdown(tasks: readonly ExportTask[], opts: { title?: string } = {}): string {
  const lines = tasks.map((task) => formatTaskLine(task));
  return `${opts.title ? `# ${opts.title}\n\n` : ""}${lines.join("\n")}\n`;
}

export const CSV_COLUMNS = ["title", "status", "priority", "project", "timeframe", "due", "context", "assignee", "external_ref"] as const;

const csvCell = (v: string): string => {
  // Spreadsheet formula injection: a cell that starts with = + - @ is read as a formula by Excel.
  const safe = /^[=+@]/.test(v) || /^-\D/.test(v) ? `'${v}` : v;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** RFC 4180 CSV (comma separated, CRLF), UTF-8; callers prepend a BOM when Excel is the target. */
export function tasksToCsv(tasks: readonly ExportTask[]): string {
  const rows = tasks.map((t) =>
    [
      clean(t.title),
      t.done ? "done" : "open",
      t.priority ?? "",
      t.project ? clean(t.project) : "",
      normalizeTimeframe(t.timeframe) ?? "",
      t.due ? t.due.slice(0, 10) : "",
      t.context ? clean(t.context) : "",
      t.assignee ?? "",
      t.externalRef ?? "",
    ].map(csvCell),
  );
  return [CSV_COLUMNS.join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}
