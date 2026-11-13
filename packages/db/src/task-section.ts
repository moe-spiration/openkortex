// Portable-Markdown-Spiegel der Aufgaben einer Quelle (Notiz, Meeting, Clip): die `action_items` mit
// `source_item_id` stehen zusätzlich als Abschnitt im content_md der Quelle:
//
//   ## Aufgaben
//
//   - [ ] Folien senden · Zeitrahmen: diese Woche · Kontext: warum <!-- task:<uuid> -->
//   - [x] Vertrag prüfen <!-- task:<uuid> -->
//
// Richtung DB → Markdown: `withTaskSection` (rendert per `formatTaskLine`, Text außerhalb des Abschnitts
// und fremde Zeilen darin bleiben unberührt). Richtung Markdown → DB: `planTaskSectionSync` (Abgleich
// über den `<!-- task:<id> -->`-Marker, sonst über `matchKey` des Titels innerhalb der Quelle).
// Aufgaben ohne Quelle haben keine Notiz und bleiben nur in der DB. Siehe docs/tasks-export.md.

import { getLocale, type Locale } from "@kortex/i18n";
import type { Insert, KortexClient, Update } from "./client";
import { contentHash, matchKey } from "./dedup";
import { formatTaskLine, normalizeTimeframe, parseTaskLine, type ParsedTaskLine } from "./tasks";

/**
 * Heading of the task section per language. It is written into `content_md` and found again later,
 * so it is a fixed table: a NEW section gets the heading of the current language, every reader
 * accepts both, and an existing section keeps its heading and the language of its lines (a German
 * note is never rewritten in English, whoever touches it).
 */
export const TASKS_HEADINGS: Readonly<Record<Locale, string>> = { en: "## Tasks", de: "## Aufgaben" };
/** Heading a new section gets in `locale` (default: the current language). */
export const tasksHeading = (locale: Locale = getLocale()): string => TASKS_HEADINGS[locale];
/** The German heading (the only one before the interface became bilingual). Prefer `tasksHeading()`. */
export const TASKS_HEADING = TASKS_HEADINGS.de;
const HEADING_RE = /^## (Aufgaben|Tasks)[ \t]*$/m;
const headingLocale = (word: string): Locale => (word === "Tasks" ? "en" : "de");

/** Description of a task typed by the user (web Tasks hub, vault line), not extracted by the AI. */
export const MANUAL_TASK_DESCRIPTION = "manual";

/** An action item as the section needs it. */
export interface SectionTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  timeframe: string | null;
  context: string | null;
  /** Title of the linked project / goal object (rendered as `Projekt: [[…]]`, read-only). */
  project?: string | null;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * [start, end) of the section incl. heading plus the language of its heading; null without one.
 * Ends at the next `#`/`##` heading. With several task headings the first one is the section.
 */
function sectionRange(md: string): [number, number, Locale] | null {
  const m = HEADING_RE.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = /^#{1,2} /m.exec(rest);
  return [m.index, next ? m.index + m[0].length + next.index : md.length, headingLocale(m[1]!)];
}

/** Task lines of the "## Aufgaben" / "## Tasks" section; null when the note has none (then nothing changes). */
export function parseTaskSection(md: string): ParsedTaskLine[] | null {
  const norm = md.replace(/\r\n?/g, "\n");
  const range = sectionRange(norm);
  if (!range) return null;
  return norm
    .slice(range[0], range[1])
    .split("\n")
    .slice(1)
    .flatMap((l) => {
      const p = parseTaskLine(l);
      return p ? [p] : [];
    });
}

/**
 * The note with its task section ("## Aufgaben" / "## Tasks") showing `tasks` (cancelled ones and tasks that already stand
 * as a checklist line elsewhere in the body are left out). Replaces the section's task lines (those with
 * an id marker or the title of a shown task), keeps any other text in it, appends the section when the
 * note has none and there is something to show. The rest of the note is never touched. An existing
 * section keeps its heading and is rendered in that heading's language; a new one uses the current language.
 */
export function withTaskSection(md: string, tasks: readonly SectionTask[]): string {
  const norm = md.replace(/\r\n?/g, "\n");
  const range = sectionRange(norm);
  const outside = range ? norm.slice(0, range[0]) + norm.slice(range[1]) : norm;
  const bodyKeys = new Set(
    outside.split("\n").flatMap((l) => {
      const p = parseTaskLine(l);
      return p ? [matchKey(p.title)] : [];
    }),
  );
  const shown = tasks.filter((t) => t.status !== "cancelled" && !bodyKeys.has(matchKey(t.title)));
  const shownKeys = new Set(shown.map((t) => matchKey(t.title)));
  const locale = range ? range[2] : getLocale();
  const heading = TASKS_HEADINGS[locale];
  const lines = shown.map((t) =>
    formatTaskLine(
      {
        id: t.id,
        title: t.title,
        done: t.status === "done",
        project: t.project ?? null,
        timeframe: t.timeframe,
        due: t.due_date,
        context: t.context,
      },
      locale,
    ),
  );
  if (!range) {
    if (!lines.length) return md;
    return `${norm.trimEnd()}${norm.trim() ? "\n\n" : ""}${heading}\n\n${lines.join("\n")}\n`;
  }
  const kept = norm
    .slice(range[0], range[1])
    .split("\n")
    .slice(1)
    .filter((l) => {
      const p = parseTaskLine(l);
      // Ours: rendered fresh below (or the task is gone). Anything else is the user's text.
      return !(p && (p.id || shownKeys.has(matchKey(p.title))));
    });
  while (kept.length && !kept[0]!.trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();
  const section = [heading, "", ...lines, ...(lines.length && kept.length ? [""] : []), ...kept]
    .join("\n")
    .trimEnd();
  const before = norm.slice(0, range[0]).trimEnd();
  const after = norm.slice(range[1]).trim();
  const out = [before, section, after].filter(Boolean).join("\n\n");
  return norm.endsWith("\n") || !norm ? `${out}\n` : out;
}

// --- Markdown → action_items ----------------------------------------------------------------------

export type SectionTaskPatch = Pick<
  Update<"action_items">,
  "title" | "status" | "completed_at" | "timeframe" | "context" | "due_date"
>;

export interface TaskSectionPlan {
  update: { id: string; patch: SectionTaskPatch }[];
  /** Lines without a matching task (and without an id marker): new tasks of the source item. */
  insert: ParsedTaskLine[];
}

const dueDay = (due: string | null | undefined) => (due ? due.slice(0, 10) : null);
const dueValue = (day: string | null) => (day ? `${day}T00:00:00Z` : null);

/**
 * What a changed section means for the source item's tasks. A line with an id marker is authoritative
 * for its task (title, done, timeframe, due, context; a removed key clears the field). A line without a
 * marker matches by `matchKey(title)` and only sets what it states (done, present keys), never clears.
 * A marker whose task is gone (deleted elsewhere) is ignored, so a stale file never resurrects it; new
 * lines become inserts (one per title key, never a second task with a known title). The project link is
 * read-only here. Removed lines delete nothing.
 */
export function planTaskSectionSync(
  existing: readonly SectionTask[],
  lines: readonly ParsedTaskLine[],
  now: string,
): TaskSectionPlan {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const byKey = new Map<string, SectionTask>();
  for (const t of existing) if (!byKey.has(matchKey(t.title))) byKey.set(matchKey(t.title), t);
  const matched = new Set<string>();
  const plan: TaskSectionPlan = { update: [], insert: [] };
  const insertKeys = new Set<string>();

  const diff = (t: SectionTask, p: ParsedTaskLine, authoritative: boolean) => {
    const patch: SectionTaskPatch = {};
    const done = t.status === "done";
    if (p.done && !done) Object.assign(patch, { status: "done", completed_at: now });
    else if (!p.done && done) Object.assign(patch, { status: "open", completed_at: null });
    if (authoritative && clean(p.title) && clean(p.title) !== clean(t.title)) patch.title = clean(p.title);
    const tf = normalizeTimeframe(t.timeframe);
    if ((authoritative || p.timeframe) && p.timeframe !== tf) patch.timeframe = p.timeframe;
    if ((authoritative || p.due) && p.due !== dueDay(t.due_date)) patch.due_date = dueValue(p.due);
    const ctx = clean(p.context) || null;
    if ((authoritative || ctx) && ctx !== (clean(t.context) || null)) patch.context = ctx;
    if (Object.keys(patch).length) plan.update.push({ id: t.id, patch });
  };

  for (const p of lines) {
    if (!p.id) continue;
    const t = byId.get(p.id);
    if (!t || matched.has(t.id)) continue;
    matched.add(t.id);
    diff(t, p, true);
  }
  for (const p of lines) {
    if (p.id) continue;
    const key = matchKey(p.title);
    if (!key) continue;
    const t = byKey.get(key);
    if (t) {
      if (!matched.has(t.id)) {
        matched.add(t.id);
        diff(t, p, false);
      }
      continue;
    }
    if (insertKeys.has(key)) continue;
    insertKeys.add(key);
    plan.insert.push(p);
  }
  return plan;
}

/** Insert row for a new vault line (a task the user typed, hence `manual`). */
export function taskInsertFromLine(
  userId: string,
  itemId: string,
  p: ParsedTaskLine,
  now: string,
): Insert<"action_items"> {
  return {
    user_id: userId,
    source_item_id: itemId,
    title: clean(p.title),
    description: MANUAL_TASK_DESCRIPTION,
    status: p.done ? "done" : "open",
    completed_at: p.done ? now : null,
    timeframe: p.timeframe,
    due_date: dueValue(p.due),
    context: clean(p.context) || null,
  };
}

// --- I/O (service role or user client; every query scoped to `userId`) -------------------------------

interface PgErr {
  message?: string;
  code?: string;
}
const fail = (what: string, error: PgErr): never => {
  throw Object.assign(new Error(`task section ${what}: ${error.message ?? String(error)}`), {
    code: error.code,
  });
};

/** The source item's tasks in creation order, with project titles. */
export async function loadSectionTasks(
  db: KortexClient,
  userId: string,
  itemId: string,
): Promise<SectionTask[]> {
  const { data, error } = await db
    .from("action_items")
    .select("id,title,status,due_date,timeframe,context,project_item_id,created_at")
    .eq("user_id", userId)
    .eq("source_item_id", itemId)
    .order("created_at")
    .order("id");
  if (error) fail("load tasks", error);
  const rows = data ?? [];
  const projectIds = [...new Set(rows.flatMap((r) => (r.project_item_id ? [r.project_item_id] : [])))];
  const titles = new Map<string, string>();
  if (projectIds.length) {
    const res = await db
      .from("knowledge_items")
      .select("id,title")
      .eq("user_id", userId)
      .in("id", projectIds);
    if (res.error) fail("load projects", res.error);
    for (const p of res.data ?? []) titles.set(p.id, p.title);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    due_date: r.due_date,
    timeframe: r.timeframe,
    context: r.context,
    project: r.project_item_id ? (titles.get(r.project_item_id) ?? null) : null,
  }));
}

/**
 * DB → Markdown: rewrites the source item's "## Aufgaben" section from its tasks. Compare-and-set on
 * `updated_at`, so a concurrent edit of the note wins (the next task change renders again). Returns
 * whether the note changed and the task ids seen (md-sync maps DELETE events back to the note).
 */
export async function refreshTaskSection(
  db: KortexClient,
  userId: string,
  itemId: string,
): Promise<{ changed: boolean; taskIds: string[] }> {
  const { data: item, error } = await db
    .from("knowledge_items")
    .select("content_md,updated_at")
    .eq("user_id", userId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) fail("load item", error);
  if (!item) return { changed: false, taskIds: [] };
  const tasks = await loadSectionTasks(db, userId, itemId);
  const taskIds = tasks.map((t) => t.id);
  const md = item.content_md ?? "";
  const next = withTaskSection(md, tasks);
  if (next.trimEnd() === md.trimEnd()) return { changed: false, taskIds };
  const res = await db
    .from("knowledge_items")
    .update({ content_md: next, content_hash: await contentHash(next) })
    .eq("user_id", userId)
    .eq("id", itemId)
    .eq("updated_at", item.updated_at)
    .select("id");
  if (res.error) fail("update item", res.error);
  return { changed: (res.data?.length ?? 0) > 0, taskIds };
}

/**
 * Markdown → DB: applies an edited "## Aufgaben" section (vault file, note body) to the source item's
 * tasks. Null when the note has no section.
 */
export async function applyTaskSection(
  db: KortexClient,
  userId: string,
  itemId: string,
  md: string,
  now: string = new Date().toISOString(),
): Promise<TaskSectionPlan | null> {
  const lines = parseTaskSection(md);
  if (!lines) return null;
  const existing = await loadSectionTasks(db, userId, itemId);
  const plan = planTaskSectionSync(existing, lines, now);
  for (const u of plan.update) {
    const res = await db
      .from("action_items")
      .update(u.patch)
      .eq("user_id", userId)
      .eq("id", u.id);
    if (res.error) fail("update task", res.error);
  }
  if (plan.insert.length) {
    const res = await db
      .from("action_items")
      .insert(plan.insert.map((p) => taskInsertFromLine(userId, itemId, p, now)));
    if (res.error) fail("insert tasks", res.error);
  }
  return plan;
}
