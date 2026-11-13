/*
 * Griply (the task tool for goals, projects, habits and tasks) seen from Kortex. Kortex reads the
 * hierarchy to show an area's goals and hands tasks over; it keeps no goals, habits or scores of its
 * own. This file is the pure part (shapes, parsing, matching), covered by tests. The connection
 * itself (OAuth sign-in, MCP calls) lives in server/griply.
 */

export const GRIPLY_APP_URL = "https://app.griply.app";
export const GRIPLY_REF = (id: string) => `griply:${id}`;

export interface GriplyItem {
  id: string;
  name: string;
  /** YYYY-MM-DD, when the item has a deadline. */
  deadline?: string;
  /** 0 to 100, as Griply counts it. */
  progress?: number;
}

export interface GriplyHabit {
  id: string;
  name: string;
  /** Completion over the last four weeks, in percent. */
  rate?: number;
}

export interface GriplyArea {
  id: string;
  name: string;
  goals: GriplyItem[];
  projects: GriplyItem[];
  habits: GriplyHabit[];
}

export interface GriplyOverview {
  areas: GriplyArea[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A tool result of the MCP server as JSON: structured content first, else the first text part. */
export function toolJson(result: unknown): unknown {
  const r = rec(result);
  if (r.structuredContent && typeof r.structuredContent === "object") return r.structuredContent;
  for (const part of list(r.content)) {
    if (part.type !== "text" || typeof part.text !== "string") continue;
    try {
      return JSON.parse(part.text);
    } catch {
      /* not JSON: try the next part */
    }
  }
  return undefined;
}

/** Text of a failed tool call (isError), for the message shown to the user. */
export function toolErrorText(result: unknown): string | undefined {
  const r = rec(result);
  if (r.isError !== true) return undefined;
  return list(r.content).map((p) => str(p.text)).filter(Boolean).join(" ") || "error";
}

const open = (i: Record<string, unknown>) => i.completed !== true && i.archived !== true;
const inArea = (i: Record<string, unknown>, areaId: string) => list(i.lifeAreas).some((a) => a.id === areaId);
const item = (i: Record<string, unknown>): GriplyItem | undefined => {
  const id = str(i.id);
  const name = str(i.name);
  if (!id || !name) return undefined;
  const deadline = str(i.deadline);
  const progress = num(i.progressPercent);
  return { id, name, ...(deadline ? { deadline } : {}), ...(progress !== undefined ? { progress: Math.round(progress) } : {}) };
};
const byDeadline = (a: GriplyItem, b: GriplyItem) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.name.localeCompare(b.name);

/**
 * The answer of get_hierarchy (one or more pages), grouped by life area: open goals, open projects
 * and habits. Unknown fields are ignored, so a changed answer never breaks the page.
 */
export function parseHierarchy(pages: readonly unknown[]): GriplyOverview {
  const all = pages.map(rec);
  const areas = all.flatMap((p) => list(p.lifeAreas)).filter((a) => a.archived !== true);
  const goals = all.flatMap((p) => list(p.goals)).filter(open);
  const projects = all.flatMap((p) => list(p.projects)).filter(open);
  const habits = all.flatMap((p) => list(p.habits));
  const seen = new Set<string>();
  const out: GriplyArea[] = [];
  for (const a of areas) {
    const id = str(a.id);
    const name = str(a.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const pick = (rows: Record<string, unknown>[]) => {
      const ids = new Set<string>();
      return rows
        .filter((r) => inArea(r, id))
        .map(item)
        .filter((x): x is GriplyItem => !!x && !ids.has(x.id) && !!ids.add(x.id))
        .sort(byDeadline);
    };
    out.push({
      id,
      name,
      goals: pick(goals),
      projects: pick(projects),
      habits: habits
        .filter((h) => inArea(h, id))
        .flatMap((h) => {
          const hid = str(h.id);
          const hname = str(h.name);
          const rate = num(h.completionRate4w);
          return hid && hname ? [{ id: hid, name: hname, ...(rate !== undefined ? { rate: Math.round(rate) } : {}) }] : [];
        }),
    });
  }
  return { areas: out };
}

/** The cursor of the next page of get_hierarchy, if any. */
export const nextCursor = (page: unknown): string | undefined => str(rec(page).nextCursor);

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

/** Other names an area of Kortex goes by in a task tool (English and German). */
const AREA_ALIASES: Record<string, readonly string[]> = {
  health: ["health", "fitness", "gesundheit"],
  career: ["career", "work", "job", "karriere", "beruf"],
  finance: ["finance", "money", "wealth", "finanzen", "geld"],
  ventures: ["ventures", "business", "company", "unternehmen", "firma"],
  relations: ["relations", "relationships", "love", "social", "family", "friends", "beziehungen", "liebe", "familie", "freunde"],
  growth: ["growth", "personaldev", "personal development", "learning", "wachstum", "lernen", "entwicklung"],
};

/**
 * The Griply life area that belongs to a Kortex area: by its key, its label and the usual other
 * names. Names are compared loosely ("Love & Social" matches relations, "PersonalDev" matches growth);
 * an exact name wins over a part of one.
 */
export function matchGriplyArea(overview: GriplyOverview, key: string, labels: readonly string[] = []): GriplyArea | undefined {
  const names = [...new Set([key, ...labels, ...(AREA_ALIASES[key] ?? [])].map(norm).filter((k) => k.length >= 3))];
  const exact = overview.areas.find((a) => names.includes(norm(a.name)));
  if (exact) return exact;
  return overview.areas.find((a) => {
    const n = norm(a.name);
    return n.length >= 3 && names.some((k) => n.includes(k) || k.startsWith(n));
  });
}

/**
 * The address of the user's Griply MCP server, as pasted from Griply's settings. Only https, no
 * local or private hosts (the Kortex server calls this address). Returns the cleaned URL or null.
 */
export function cleanServerUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  u.hash = "";
  return u.toString();
}

export interface HandoverTask {
  id: string;
  title: string;
  /** ISO date or timestamp of the due day. */
  due?: string | null;
  context?: string | null;
  priority?: string | null;
}

/** One task as create_tasks wants it. The Kortex id makes a repeated hand-over return the same task. */
export function griplyTaskInput(task: HandoverTask): Record<string, unknown> {
  const due = task.due?.slice(0, 10);
  const description = task.context?.trim();
  const priority = task.priority === "high" || task.priority === "medium" || task.priority === "low" ? task.priority : undefined;
  return {
    name: task.title.trim().slice(0, 500),
    clientRequestId: task.id,
    ...(due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? { deadline: due } : {}),
    ...(description ? { description: description.slice(0, 5000) } : {}),
    ...(priority ? { priority } : {}),
  };
}

/** The id of the task create_tasks made, or the reason it did not. */
export function createdTaskId(result: unknown): { id: string } | { error: string } {
  const failed = toolErrorText(result);
  if (failed) return { error: failed };
  const json = rec(toolJson(result));
  const first = list(json.results ?? json.tasks ?? json.items ?? json.created)[0] ?? json;
  const id = str(first.id) ?? str(rec(first.task).id) ?? str(rec(first.item).id);
  if (id && first.created !== false) return { id };
  return { error: str(first.reason) ?? str(first.error) ?? str(json.error) ?? "no id" };
}
