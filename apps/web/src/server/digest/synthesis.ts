import { byLocale } from "@kortex/i18n";
import { intlLocale, t, tx } from "@/i18n";
import { generateText, Output } from "ai";
import { z } from "zod";
import { modelFor, modelIdFor, type ModelRouter } from "@kortex/ai-core";
import type { KortexClient } from "@kortex/db";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import { ensureFolderPath, insertItem, mergeJson, updateItem } from "../repo";
import { weekYearLabel } from "../life/dates";
import { deDate, EXCLUDED_TYPES, indexDigestChunks, isoWeek } from "./service";

/*
 * Deep synthesis (S12): one weekly and one monthly digest across the whole vault, plus the focus
 * profile the copilot may use as background.
 *
 *   90_Digests/Weekly/YYYY-Www.md   themes, connections, open loops, questions, 3 suggestions
 *   90_Digests/Monthly/YYYY-MM.md   the same for a month, built from the weekly syntheses + items
 *   40_AI_Memories/Focus-Profile.md current focus topics, projects, recurring interests
 *
 * The file name is the slug (md-sync writes `<folder_path>/<slug>.md`, frontmatter from the row).
 * Exactly one AI call per digest, on the user's ADR-06 route (weekly: summarize, monthly:
 * chat_reasoning), with a bounded prompt. The focus profile comes out of the same call. A period
 * that already has its digest is never generated again (no AI call) unless `rerun` is set; then
 * the same item is updated in place.
 */

export const WEEKLY_SYNTHESIS_FOLDER = "90_Digests/Weekly";
export const MONTHLY_SYNTHESIS_FOLDER = "90_Digests/Monthly";
export const FOCUS_PROFILE_FOLDER = "40_AI_Memories";
export const FOCUS_PROFILE_SLUG = "Focus-Profile";
/**
 * Heading in the focus profile whose content the user owns: kept on every rewrite. A new profile
 * gets the heading of the account language; an existing one is found under either.
 */
export const FOCUS_OWN_NOTES_HEADINGS = { en: "## Own notes", de: "## Eigene Notizen" } as const;
/** The German heading (profiles written before the app was bilingual). */
export const FOCUS_OWN_NOTES_HEADING = FOCUS_OWN_NOTES_HEADINGS.de;

/** Where the user-owned part starts in a focus profile, -1 when it has none. */
const ownNotesIndex = (body: string): number => {
  const hits = Object.values(FOCUS_OWN_NOTES_HEADINGS)
    .map((h) => body.indexOf(h))
    .filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : -1;
};

/** User-owned part of a new focus profile: goals, themes, ignore list. */
export const focusOwnTemplate = (): string =>
  byLocale({
    en: `${FOCUS_OWN_NOTES_HEADINGS.en}

You maintain this section yourself. The syntheses read it and never overwrite it.

### Goals

-

### Topics

-

### Ignore

- `,
    de: `${FOCUS_OWN_NOTES_HEADINGS.de}

Diesen Abschnitt pflegst Du selbst. Die Synthesen lesen ihn und überschreiben ihn nie.

### Ziele

-

### Themen

-

### Ignorieren

- `,
  });

/** Prompt budgets (characters). Roughly 6k / 10k input tokens. */
export const PROMPT_BUDGET = { weekly: 24_000, monthly: 40_000 } as const;
const ITEM_CHARS = { weekly: 600, monthly: 280 } as const;
const MAX_ITEMS = { weekly: 120, monthly: 200 } as const;
const MAX_TASKS = 60;
const WEEKLY_DIGEST_CHARS = 4_000;
const FOCUS_CHARS = 1_500;

export type SynthesisKind = "weekly" | "monthly";

export interface SynthesisPeriod {
  kind: SynthesisKind;
  /** "2026-W44" / "2026-10": slug, file name and cron period. */
  key: string;
  /** "KW 44/2026" / "Oktober 2026" (German), "Week 44/2026" / "October 2026" (English). */
  label: string;
  start: string;
  end: string;
  folder: string;
  title: string;
}

/**
 * The week a weekly synthesis covers: the 7 days up to `now`, labelled with the ISO week of
 * `localDate` (the user's calendar date, same key as the weekly cron run).
 */
export function weeklyPeriod(localDate: Date, now: Date): SynthesisPeriod {
  const { year, week } = isoWeek(localDate);
  const key = `${year}-W${String(week).padStart(2, "0")}`;
  const label = weekYearLabel(week, year);
  return {
    kind: "weekly",
    key,
    label,
    start: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    end: now.toISOString(),
    folder: WEEKLY_SYNTHESIS_FOLDER,
    title: t("Weekly synthesis {label}", { label }),
  };
}

/** The calendar month before `localDate` (run on the 1st: the month that just ended). */
export function monthlyPeriod(localDate: Date): SynthesisPeriod {
  const y = localDate.getUTCFullYear();
  const m = localDate.getUTCMonth(); // 0-based month of the run = end of the period
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  const label = `${new Intl.DateTimeFormat(intlLocale(), { month: "long", timeZone: "UTC" }).format(start)} ${start.getUTCFullYear()}`;
  return {
    kind: "monthly",
    key,
    label,
    start: start.toISOString(),
    end: end.toISOString(),
    folder: MONTHLY_SYNTHESIS_FOLDER,
    title: t("Monthly synthesis {label}", { label }),
  };
}

/** Vault-relative file of a synthesis (what md-sync writes). */
export const synthesisPath = (p: Pick<SynthesisPeriod, "folder" | "key">) =>
  `${p.folder}/${p.key}.md`;

// --- Output -----------------------------------------------------------------------------------

export const SynthesisOutputSchema = z.object({
  headline: z.string(),
  themes: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      /** Titles of the source entries (exactly as given), become [[wiki links]]. */
      items: z.array(z.string()),
    }),
  ),
  connections: z.array(z.string()),
  open_loops: z.array(z.string()),
  questions: z.array(z.string()),
  suggestions: z.array(z.string()),
  /** Weekly: 2-3 sentences for each of the most active areas (names as given in the prompt). */
  areas: z.array(z.object({ name: z.string(), summary: z.string() })).default([]),
  /** Monthly: what rose or fell compared with the previous month. */
  trends: z.array(z.string()).default([]),
  focus: z.object({
    topics: z.array(z.string()),
    projects: z.array(z.string()),
    interests: z.array(z.string()),
  }),
});
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;

// --- Input ------------------------------------------------------------------------------------

export interface SynthesisItem {
  id: string;
  slug?: string | null;
  title: string;
  type: string;
  summary: string | null;
  content_md: string;
  cluster_name: string | null;
  folder_path: string;
  tags: string[] | null;
  updated_at: string;
  /** Only read for `metadata.watch` (watched pages). */
  metadata?: unknown;
}

export interface SynthesisTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  completed_at: string | null;
}

export interface SynthesisInput {
  period: SynthesisPeriod;
  items: SynthesisItem[];
  /** Tasks created or completed in the period. */
  tasks: SynthesisTask[];
  /** Open tasks overall (oldest due first): the open loops. */
  openTasks: SynthesisTask[];
  /** Monthly only: the weekly syntheses of the month. */
  weeklyDigests: Array<{ title: string; content_md: string }>;
  /** Body of the current focus profile (continuity), if any. */
  previousFocus: string | null;
  /** Items with a reminder (snoozed/due) in the period or the following week. */
  reminders: Array<{ title: string; remind_at: string }>;
  /** Weekly: the up to 3 most active areas (see topAreas). */
  areas: Area[];
  /** Monthly: body of the previous month's synthesis (trend baseline). */
  previousMonth: string | null;
}

export interface Area {
  name: string;
  items: number;
}

const SYSTEM_FOLDER = /^\d{2}_/;
const isWatched = (i: SynthesisItem) =>
  !!(i.metadata as { watch?: unknown } | null | undefined)?.watch;

/**
 * The most active areas of the period: the top-level user folder of an item, else its first
 * user tag (digest/ and ai/ tags and the numbered vault folders are system structure).
 * Ranked by item count, ties alphabetically. Deterministic, so the model only writes the prose.
 */
export function topAreas(items: SynthesisItem[], limit = 3): Area[] {
  const count = new Map<string, number>();
  for (const i of items) {
    const top = i.folder_path.split("/")[0] ?? "";
    const tag = (i.tags ?? []).find((t) => !/^(digest|ai)\//.test(t));
    const name = top && !SYSTEM_FOLDER.test(top) ? top : tag;
    if (name) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return [...count]
    .map(([name, n]) => ({ name, items: n }))
    .sort((a, b) => b.items - a.items || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const SYSTEM_BASE = {
  en: `You are the synthesis author of the Second Brain Kortex. You read what the user collected, noted and completed in the period and write a deep, honest synthesis.
Rules:
- Use only the entries, tasks and digests you are given. Do not invent anything, including names or numbers.
- Write in English (unless the sources are clearly German), concrete, without platitudes. Every point is a short sentence.
- "items" of a theme contains only titles exactly as they appear in the sources.
- Empty arrays when there is nothing for a section.
Return a JSON object:
- "headline": 1-2 sentences on the overall picture.
- "themes": 2-6 themes, each with "title", "summary" (2-3 sentences: what happened, why it matters) and "items".
- "connections": non-obvious connections between entries or themes (which entry complements, contradicts or continues which).
- "open_loops": open loops: unfinished tasks, thoughts that were started, pending decisions.
- "questions": questions worth picking up again later.
- "suggestions": exactly 3 concrete suggestions for the next period.
- "areas": only when "Most active areas" are given: per area "name" (exactly as given) and "summary" (2-3 sentences). Otherwise empty.
- "trends": monthly only: 2-5 trends compared with the previous month (rising, falling, new, gone), only when the previous month is given. Otherwise empty.
- The user's focus profile (goals, topics, ignore) takes precedence: weight goals and topics higher, do not mention topics listed under "Ignore".
- "focus": the user's current focus: "topics", "projects", "interests" (recurring interests), each at most 6 short terms. Take the previous focus profile into account, but only what the sources confirm.`,
  de: `Du bist der Synthese-Autor des Second Brain Kortex. Du liest, was der Nutzer im Zeitraum gesammelt, notiert und erledigt hat, und schreibst eine tiefe, ehrliche Synthese.
Regeln:
- Nutze ausschließlich die gelieferten Einträge, Aufgaben und Digests. Erfinde nichts, auch keine Namen oder Zahlen.
- Schreibe auf Deutsch (außer die Quellen sind eindeutig englisch), konkret, ohne Floskeln. Jeder Punkt ist ein kurzer Satz.
- "items" eines Themas enthält nur Titel exakt so, wie sie in den Quellen stehen.
- Leere Arrays, wenn es zu einem Abschnitt nichts gibt.
Liefere ein JSON-Objekt:
- "headline": 1-2 Sätze Gesamtbild.
- "themes": 2-6 Themen, je mit "title", "summary" (2-3 Sätze: was passierte, warum es wichtig ist) und "items".
- "connections": nicht offensichtliche Verbindungen zwischen Einträgen oder Themen (welcher Eintrag welchen ergänzt, widerspricht oder fortsetzt).
- "open_loops": offene Schleifen: unerledigte Aufgaben, angefangene Gedanken, ausstehende Entscheidungen.
- "questions": Fragen, die es wert sind, später wieder aufgegriffen zu werden.
- "suggestions": genau 3 konkrete Vorschläge für den nächsten Zeitraum.
- "areas": nur wenn "Aktivste Bereiche" geliefert werden: je Bereich "name" (exakt wie geliefert) und "summary" (2-3 Sätze). Sonst leer.
- "trends": nur im Monat: 2-5 Trends gegenüber dem Vormonat (steigend, fallend, neu, weggefallen), nur wenn der Vormonat geliefert wird. Sonst leer.
- Das Fokus-Profil des Nutzers (Ziele, Themen, Ignorieren) hat Vorrang: gewichte Ziele und Themen höher, erwähne Themen unter "Ignorieren" nicht.
- "focus": aktueller Fokus des Nutzers: "topics" (Themen), "projects" (Projekte), "interests" (wiederkehrende Interessen), je höchstens 6 kurze Begriffe. Berücksichtige das bisherige Fokus-Profil, aber nur, was die Quellen bestätigen.`,
};

export const synthesisSystem = (kind: SynthesisKind) =>
  byLocale({
    en: `${SYSTEM_BASE.en}\n${
      kind === "weekly"
        ? "The period is one week; the suggestions are for next week."
        : "The period is one month; rely mainly on the weekly syntheses and add from the entries. The suggestions are for next month."
    }`,
    de: `${SYSTEM_BASE.de}\n${
      kind === "weekly"
        ? "Zeitraum ist eine Woche; die Vorschläge gelten für die nächste Woche."
        : "Zeitraum ist ein Monat; stütze Dich vor allem auf die Wochensynthesen und ergänze aus den Einträgen. Die Vorschläge gelten für den nächsten Monat."
    }`,
  });

const PROMPT_LABELS = {
  en: {
    period: "Period",
    to: "to",
    none: "(none)",
    cut: (n: number) => `(+${n} more cut)`,
    ownProfile: "The user's focus profile (goals, topics, ignore):",
    areas: 'Most active areas (write 2-3 sentences each under "areas"):',
    entries: "entries",
    previousMonth: "Previous month (for trends):",
    weeklies: "Weekly syntheses of the month:",
    due: "due",
    tasks: "Tasks in the period (created or completed):",
    openTasks: "All open tasks:",
    reminders: "Reminders (due or snoozed):",
    watched: "Watched pages with a change:",
    items: "Entries (notes, meetings, clippings, documents):",
    previousFocus: "Previous automatic focus profile:",
  },
  de: {
    period: "Zeitraum",
    to: "bis",
    none: "(keine)",
    cut: (n: number) => `(+${n} weitere gekürzt)`,
    ownProfile: "Fokus-Profil des Nutzers (Ziele, Themen, Ignorieren):",
    areas: 'Aktivste Bereiche (schreibe je 2-3 Sätze unter "areas"):',
    entries: "Einträge",
    previousMonth: "Vormonat (für Trends):",
    weeklies: "Wochensynthesen des Monats:",
    due: "fällig",
    tasks: "Aufgaben im Zeitraum (angelegt oder erledigt):",
    openTasks: "Offene Aufgaben insgesamt:",
    reminders: "Erinnerungen (fällig oder zurückgestellt):",
    watched: "Beobachtete Seiten mit Änderung:",
    items: "Einträge (Notizen, Meetings, Clippings, Dokumente):",
    previousFocus: "Bisheriges automatisches Fokus-Profil:",
  },
};

/**
 * The user prompt, bounded by PROMPT_BUDGET: sections are filled in priority order (weekly
 * syntheses, tasks, items, previous focus) and cut with a note once the budget is reached.
 */
export function buildSynthesisPrompt(input: SynthesisInput): string {
  const { period } = input;
  const budget = PROMPT_BUDGET[period.kind];
  const l = byLocale(PROMPT_LABELS);
  const lines: string[] = [
    `${l.period}: ${period.title} (${deDate(period.start)} ${l.to} ${deDate(period.end)})`,
    "",
  ];
  let used = lines.join("\n").length;
  const push = (line: string) => {
    if (used + line.length + 1 > budget) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  const section = <T>(title: string, rows: T[], render: (r: T) => string, empty = l.none) => {
    if (!push(title)) return;
    if (!rows.length) {
      push(empty);
    } else {
      let shown = 0;
      for (const r of rows) {
        if (!push(render(r))) break;
        shown++;
      }
      if (shown < rows.length) push(l.cut(rows.length - shown));
    }
    push("");
  };

  const notes = ownNotesOf(input.previousFocus);
  if (notes) {
    push(l.ownProfile);
    push(clip(notes, FOCUS_CHARS));
    push("");
  }
  if (period.kind === "weekly" && input.areas.length)
    section(
      l.areas,
      input.areas,
      (a) => `- ${oneLine(a.name)} (${a.items} ${l.entries})`,
    );
  if (period.kind === "monthly" && input.previousMonth)
    section(l.previousMonth, [input.previousMonth], (m) =>
      clip(m.trim(), WEEKLY_DIGEST_CHARS),
    );
  if (period.kind === "monthly")
    section(
      l.weeklies,
      input.weeklyDigests,
      (d) => `### ${d.title}\n${clip(d.content_md.trim(), WEEKLY_DIGEST_CHARS)}`,
    );

  const taskLine = (t: SynthesisTask) => {
    const due = t.due_date ? `, ${l.due} ${deDate(t.due_date)}` : "";
    return `- [${t.status}] ${oneLine(t.title)} (${t.priority}${due})`;
  };
  section(
    l.tasks,
    input.tasks.slice(0, MAX_TASKS),
    taskLine,
  );
  section(l.openTasks, input.openTasks.slice(0, MAX_TASKS), taskLine);
  section(
    l.reminders,
    input.reminders.slice(0, 20),
    (r) => `- ${oneLine(r.title)} (${deDate(r.remind_at)})`,
  );
  const watched = input.items.filter(isWatched);
  if (watched.length)
    section(
      l.watched,
      watched.slice(0, 10),
      (i) => `- ${oneLine(i.title)}`,
    );
  section(
    l.items,
    input.items.slice(0, MAX_ITEMS[period.kind]),
    (i) => {
      const body = clip(oneLine(i.summary || i.content_md), ITEM_CHARS[period.kind]);
      const where = i.cluster_name && i.cluster_name !== "General" ? i.cluster_name : i.folder_path;
      const tags = i.tags?.length ? ` #${i.tags.slice(0, 4).join(" #")}` : "";
      return `- [${i.type}] ${oneLine(i.title)} (${deDate(i.updated_at)}, ${where}${tags}): ${body}`;
    },
  );
  const prevFocus = input.previousFocus ?? "";
  const ownAt = ownNotesIndex(prevFocus);
  const auto = (ownAt >= 0 ? prevFocus.slice(0, ownAt) : prevFocus).trim();
  if (auto) {
    push(l.previousFocus);
    push(clip(auto, 800));
  }
  return lines.join("\n").trim();
}

// --- Markdown ---------------------------------------------------------------------------------

const bullets = (points: string[]) =>
  points.length ? points.map((p) => `- ${oneLine(p)}`) : [`- ${tx("list", "None")}`];

/** Wiki link only for titles that really are in the input (the model must not invent links). */
const linkTo = (titles: Map<string, string>, t: string) => {
  const hit = titles.get(oneLine(t).toLowerCase());
  return hit ? `[[${hit}]]` : null;
};

export function renderSynthesisMarkdown(input: SynthesisInput, out: SynthesisOutput): string {
  const { period } = input;
  const weekly = period.kind === "weekly";
  const titles = new Map(
    input.items.map((i) => [oneLine(i.title).toLowerCase(), oneLine(i.title)]),
  );
  const themes = out.themes.flatMap((theme) => {
    const links = theme.items.map((x) => linkTo(titles, x)).filter((x): x is string => !!x);
    return [
      `### ${oneLine(theme.title)}`,
      "",
      oneLine(theme.summary),
      ...(links.length ? ["", t("References: {links}", { links: [...new Set(links)].join(", ") })] : []),
      "",
    ];
  });
  const areaSection =
    weekly && input.areas.length
      ? [
          `## ${t("Areas")}`,
          "",
          ...input.areas.flatMap((a) => {
            const text = out.areas.find(
              (x) => oneLine(x.name).toLowerCase() === a.name.toLowerCase(),
            );
            return [
              t("### {area} ({n} entries)", { area: oneLine(a.name), n: a.items }),
              "",
              text ? oneLine(text.summary) : "–",
              "",
            ];
          }),
        ]
      : [];
  const changed = [
    t("- New/changed entries: {n}", { n: input.items.length }),
    t("- Completed tasks: {n}", { n: input.tasks.filter((x) => x.status === "done").length }),
    t("- Reminders: {n}", { n: input.reminders.length }),
    ...(input.items.some(isWatched)
      ? [t("- Watched pages with a change: {n}", { n: input.items.filter(isWatched).length })]
      : []),
  ];
  const focusLine = (label: string, xs: string[]) =>
    `- **${label}:** ${xs.length ? xs.map(oneLine).join(", ") : "–"}`;
  const header = weekly
    ? t("> Period {start} – {end} · {items} entries · {tasks} tasks", {
        start: deDate(period.start),
        end: deDate(period.end),
        items: input.items.length,
        tasks: input.tasks.length,
      })
    : t("> {label} · {weeklies} weekly syntheses · {items} entries · {tasks} tasks", {
        label: period.label,
        weeklies: input.weeklyDigests.length,
        items: input.items.length,
        tasks: input.tasks.length,
      });
  return [
    `# ${period.title}`,
    "",
    header,
    "",
    oneLine(out.headline),
    "",
    `## ${t("What changed")}`,
    "",
    ...changed,
    "",
    `## ${weekly ? t("Themes of the week") : t("Themes of the month")}`,
    "",
    ...(themes.length ? themes : [`- ${tx("list", "None")}`, ""]),
    ...(!weekly && out.trends.length
      ? [`## ${t("Trends compared with the previous month")}`, "", ...bullets(out.trends), ""]
      : []),
    `## ${t("Connections")}`,
    "",
    ...bullets(out.connections),
    "",
    `## ${t("Open loops & tasks")}`,
    "",
    ...bullets(out.open_loops),
    "",
    `## ${t("Questions to pick up again")}`,
    "",
    ...bullets(out.questions),
    "",
    `## ${weekly ? t("3 suggestions for next week") : t("3 suggestions for next month")}`,
    "",
    ...(out.suggestions.length
      ? out.suggestions.slice(0, 3).map((s, i) => `${i + 1}. ${oneLine(s)}`)
      : [`- ${tx("list", "None")}`]),
    "",
    ...areaSection,
    `## ${t("Focus")}`,
    "",
    focusLine(t("Topics"), out.focus.topics),
    focusLine(t("Projects"), out.focus.projects),
    focusLine(t("Interests"), out.focus.interests),
    "",
    `## ${t("Sources")}`,
    "",
    ...(weekly || !input.weeklyDigests.length
      ? []
      : input.weeklyDigests.map((d) => `- [[${d.title}]]`)),
    ...(input.items.length
      ? input.items
          .slice(0, 40)
          .map((i) => `- [[${oneLine(i.title)}]] · ${i.type} · ${deDate(i.updated_at)}`)
      : weekly || !input.weeklyDigests.length
        ? [`- ${tx("list", "None")}`]
        : []),
  ]
    .join("\n")
    .trim();
}

/** User-owned part of the focus profile (from its "own notes" heading, in either language, to the end). */
export function ownNotesOf(body: string | null | undefined): string | null {
  if (!body) return null;
  const at = ownNotesIndex(body);
  return at >= 0 ? body.slice(at).trim() : null;
}

export function renderFocusProfile(
  period: SynthesisPeriod,
  focus: SynthesisOutput["focus"],
  updatedOn: string,
  ownNotes: string | null,
): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${oneLine(x)}`) : ["- –"]);
  const own = ownNotes ?? focusOwnTemplate();
  // The note names the section as it is headed in this file (an older profile keeps its German heading).
  const ownName = (own.split("\n")[0] ?? "").replace(/^#+\s*/, "");
  return [
    `# ${t("Focus profile")}`,
    "",
    t(
      "> Updated automatically on {date} from [[{title}]]. Kortex rewrites this file with every synthesis; only the section “{section}” stays unchanged.",
      { date: deDate(updatedOn), title: period.title, section: ownName },
    ),
    "",
    `## ${t("Current focus topics")}`,
    "",
    ...list(focus.topics),
    "",
    `## ${t("Projects")}`,
    "",
    ...list(focus.projects),
    "",
    `## ${t("Recurring interests")}`,
    "",
    ...list(focus.interests),
    "",
    own,
  ]
    .join("\n")
    .trim();
}

// --- Data -------------------------------------------------------------------------------------

const ITEM_COLS =
  "id,slug,title,type,summary,content_md,cluster_name,folder_path,tags,updated_at,metadata";
const TASK_COLS = "id,title,status,priority,due_date,completed_at";

async function findItem(
  c: KortexClient,
  userId: string,
  folder: string,
  slug: string,
): Promise<{ id: string; metadata: unknown; content_md: string | null } | null> {
  const { data, error } = await c
    .from("knowledge_items")
    .select("id,metadata,content_md")
    .eq("user_id", userId)
    .eq("folder_path", folder)
    .eq("slug", slug)
    .limit(1);
  if (error) throw new Error(`load ${folder}/${slug}: ${error.message}`);
  return ((data ?? [])[0] as { id: string; metadata: unknown; content_md: string | null }) ?? null;
}

export async function loadSynthesisInput(
  c: KortexClient,
  userId: string,
  period: SynthesisPeriod,
): Promise<SynthesisInput> {
  const prevMonth = period.kind === "monthly" ? monthlyPeriod(new Date(period.start)).key : null;
  const remindEnd = new Date(Date.parse(period.end) + 7 * 86_400_000).toISOString();
  const [items, created, completed, open, weekly, focus, reminders, previous] = await Promise.all([
    c
      .from("knowledge_items")
      .select(ITEM_COLS)
      .eq("user_id", userId)
      .gte("updated_at", period.start)
      .lt("updated_at", period.end)
      .not("type", "in", `(${EXCLUDED_TYPES.join(",")})`)
      .order("updated_at", { ascending: false })
      .limit(MAX_ITEMS[period.kind] + 50),
    c
      .from("action_items")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .gte("created_at", period.start)
      .lt("created_at", period.end)
      .limit(200),
    c
      .from("action_items")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .gte("completed_at", period.start)
      .lt("completed_at", period.end)
      .limit(200),
    c
      .from("action_items")
      .select(TASK_COLS)
      .eq("user_id", userId)
      .in("status", ["open", "in_progress"])
      .order("due_date", { ascending: true })
      .limit(MAX_TASKS),
    period.kind === "monthly"
      ? c
          .from("knowledge_items")
          .select("title,content_md,metadata")
          .eq("user_id", userId)
          .eq("type", "digest")
          .eq("folder_path", WEEKLY_SYNTHESIS_FOLDER)
          .order("slug", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
    findItem(c, userId, FOCUS_PROFILE_FOLDER, FOCUS_PROFILE_SLUG),
    c
      .from("knowledge_items")
      .select("title,remind_at")
      .eq("user_id", userId)
      .gte("remind_at", period.start)
      .lt("remind_at", remindEnd)
      .order("remind_at", { ascending: true })
      .limit(20),
    prevMonth ? findItem(c, userId, MONTHLY_SYNTHESIS_FOLDER, prevMonth) : Promise.resolve(null),
  ]);
  for (const r of [items, created, completed, open, weekly, reminders])
    if (r.error) throw new Error(`load synthesis input: ${r.error.message}`);

  const tasks = new Map<string, SynthesisTask>();
  for (const t of [...(created.data ?? []), ...(completed.data ?? [])] as SynthesisTask[])
    tasks.set(t.id, t);
  // A weekly synthesis belongs to the month its period ends in.
  const inMonth = (m: unknown) => {
    const end = (m as { period_end?: unknown } | null)?.period_end;
    return typeof end === "string" && end > period.start && end <= period.end;
  };
  const kept = ((items.data ?? []) as SynthesisItem[]).filter(
    (i) => !(i.folder_path === FOCUS_PROFILE_FOLDER && i.slug === FOCUS_PROFILE_SLUG),
  );
  return {
    period,
    items: kept,
    tasks: [...tasks.values()],
    openTasks: (open.data ?? []) as SynthesisTask[],
    weeklyDigests: (
      (weekly.data ?? []) as Array<{ title: string; content_md: string; metadata: unknown }>
    )
      .filter((d) => inMonth(d.metadata))
      .reverse()
      .map((d) => ({ title: d.title, content_md: d.content_md ?? "" })),
    previousFocus: focus?.content_md ?? null,
    reminders: (
      (reminders.data ?? []) as Array<{ title: string; remind_at: string | null }>
    ).filter((r): r is { title: string; remind_at: string } => !!r.remind_at),
    previousMonth: previous?.content_md ?? null,
    areas: period.kind === "weekly" ? topAreas(kept) : [],
  };
}

// --- Run --------------------------------------------------------------------------------------

export interface SynthesisResult {
  kind: SynthesisKind;
  period: string;
  path: string;
  /** created/updated: written now; exists: already there (no AI call); empty: nothing to say. */
  status: "created" | "updated" | "exists" | "empty";
  item_id: string | null;
  focus_profile_id: string | null;
}

export const SYNTHESIS_TASK: Record<SynthesisKind, "summarize" | "chat_reasoning"> = {
  weekly: "summarize",
  monthly: "chat_reasoning",
};

export async function generateSynthesis(
  deps: ServerDeps,
  ctx: AuthContext,
  period: SynthesisPeriod,
  models: ModelRouter,
  opts: { rerun?: boolean } = {},
): Promise<SynthesisResult> {
  const c = ctx.client;
  const base = { kind: period.kind, period: period.key, path: synthesisPath(period) };
  await ensureFocusProfile(deps, ctx, period);
  const existing = await findItem(c, ctx.userId, period.folder, period.key);
  if (existing && !opts.rerun)
    return { ...base, status: "exists", item_id: existing.id, focus_profile_id: null };

  const input = await loadSynthesisInput(c, ctx.userId, period);
  if (!input.items.length && !input.tasks.length && !input.weeklyDigests.length)
    return { ...base, status: "empty", item_id: existing?.id ?? null, focus_profile_id: null };

  const task = SYNTHESIS_TASK[period.kind];
  const { output } = await generateText({
    model: modelFor(models, task),
    system: synthesisSystem(period.kind),
    prompt: buildSynthesisPrompt(input),
    output: Output.object({ schema: SynthesisOutputSchema, name: `${period.kind}_synthesis` }),
    temperature: 0.3,
  });
  const content = renderSynthesisMarkdown(input, output);
  const modelUsed = modelIdFor(models, task);
  const folder = await ensureFolderPath(c, ctx.userId, period.folder);
  const metadata = {
    kind: period.kind,
    period: period.key,
    period_start: period.start,
    period_end: period.end,
    // Weekly: same label as the per-group digests, so the weekly review picks up the headline.
    ...(period.kind === "weekly" ? { iso_week: period.label } : { month: period.key }),
    group: period.kind === "weekly" ? t("Weekly synthesis") : t("Monthly synthesis"),
    source_item_count: input.items.length,
    task_count: input.tasks.length,
    ...(period.kind === "monthly" ? { weekly_digest_count: input.weeklyDigests.length } : {}),
    areas: input.areas.map((a) => a.name),
    themes: output.themes.map((t) => oneLine(t.title)).slice(0, 8),
    model_used: modelUsed,
  };
  const fields = {
    title: period.title,
    summary: oneLine(output.headline) || null,
    content_md: content,
    folder_path: folder.folder_path,
    folder_id: folder.id,
    is_manual_placement: true,
    tags: [`digest/${period.kind}`, "digest/synthesis"],
    related_item_ids: input.items.slice(0, 100).map((i) => i.id),
    status: "processed" as const,
  };
  const id = existing?.id ?? deps.uuid();
  if (existing) {
    await updateItem(c, ctx.userId, id, {
      ...fields,
      metadata: mergeJson(existing.metadata as never, metadata),
    });
  } else {
    await insertItem(c, {
      id,
      user_id: ctx.userId,
      type: "digest",
      source_platform: "kortex",
      slug: period.key,
      icon: "newspaper",
      ...fields,
      metadata: mergeJson(null, metadata),
    });
  }
  await indexDigestChunks(deps, ctx, models, id, period.title, content);
  const focusId = await saveFocusProfile(deps, ctx, period, output.focus, modelUsed);
  return {
    ...base,
    status: existing ? "updated" : "created",
    item_id: id,
    focus_profile_id: focusId,
  };
}

/** Creates the focus profile template (goals, themes, ignore list) when missing. Idempotent. */
async function ensureFocusProfile(deps: ServerDeps, ctx: AuthContext, period: SynthesisPeriod) {
  const c = ctx.client;
  if (await findItem(c, ctx.userId, FOCUS_PROFILE_FOLDER, FOCUS_PROFILE_SLUG)) return;
  const folder = await ensureFolderPath(c, ctx.userId, FOCUS_PROFILE_FOLDER);
  const empty = { topics: [], projects: [], interests: [] };
  await insertItem(c, {
    id: deps.uuid(),
    user_id: ctx.userId,
    type: "note",
    source_platform: "kortex",
    slug: FOCUS_PROFILE_SLUG,
    title: t("Focus profile"),
    icon: "target",
    summary: null,
    content_md: renderFocusProfile(period, empty, deps.now().toISOString(), null),
    folder_path: folder.folder_path,
    folder_id: folder.id,
    is_manual_placement: true,
    tags: ["ai/focus-profile"],
    status: "processed",
    metadata: mergeJson(null, { kind: "focus_profile" }),
  });
}

/** Rewrites 40_AI_Memories/Focus-Profile.md from a synthesis (keeps the user's own notes). */
async function saveFocusProfile(
  deps: ServerDeps,
  ctx: AuthContext,
  period: SynthesisPeriod,
  focus: SynthesisOutput["focus"],
  modelUsed: string,
): Promise<string> {
  const c = ctx.client;
  const prev = await findItem(c, ctx.userId, FOCUS_PROFILE_FOLDER, FOCUS_PROFILE_SLUG);
  const now = deps.now().toISOString();
  const content = renderFocusProfile(period, focus, now, ownNotesOf(prev?.content_md));
  const metadata = {
    kind: "focus_profile",
    updated_from: period.key,
    focus_topics: focus.topics.slice(0, 8),
    projects: focus.projects.slice(0, 8),
    interests: focus.interests.slice(0, 8),
    model_used: modelUsed,
  };
  const summary = focus.topics.length ? t("Focus: {focus}", { focus: focus.topics.slice(0, 5).join(", ") }) : null;
  if (prev) {
    await updateItem(c, ctx.userId, prev.id, {
      content_md: content,
      summary,
      metadata: mergeJson(prev.metadata as never, metadata),
    });
    return prev.id;
  }
  const folder = await ensureFolderPath(c, ctx.userId, FOCUS_PROFILE_FOLDER);
  const id = deps.uuid();
  await insertItem(c, {
    id,
    user_id: ctx.userId,
    type: "note",
    source_platform: "kortex",
    slug: FOCUS_PROFILE_SLUG,
    title: t("Focus profile"),
    icon: "target",
    summary,
    content_md: content,
    folder_path: folder.folder_path,
    folder_id: folder.id,
    is_manual_placement: true,
    tags: ["ai/focus-profile"],
    status: "processed",
    metadata: mergeJson(null, metadata),
  });
  return id;
}

/**
 * Focus profile as small, optional copilot context (null when there is none). Never throws:
 * the chat must work without it.
 */
export async function loadFocusContext(
  c: KortexClient,
  userId: string,
  maxChars = 1_200,
): Promise<string | null> {
  try {
    const row = await findItem(c, userId, FOCUS_PROFILE_FOLDER, FOCUS_PROFILE_SLUG);
    const body = row?.content_md?.trim();
    if (!body) return null;
    // Drop the title and the auto-update note; keep the lists (and the user's own notes).
    const lean = body
      .split("\n")
      .filter((l) => !l.startsWith("# ") && !l.startsWith("> "))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return lean ? clip(lean, maxChars) : null;
  } catch {
    return null;
  }
}
