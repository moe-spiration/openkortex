import type { CoverKey } from "./views";

/*
 * Insights, taken 1:1 from design/reference/Insights.dc.html (renderVals()).
 * All series are deterministic mock data "as of" 22 Oct 2026. Etappe 2: activity / energy / spaces /
 * sources come from knowledge_items + daily notes aggregates, recommendations from ai-core digests.
 */

export const INSIGHTS_AS_OF =
  "As of 22 October 2026. All values from your vault, no external trackers.";
export const INSIGHTS_BASIS =
  "Derived from 148 entries, 32 meetings, 11 books and 19 podcasts. Updated today at 06:00.";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (d: Date) => `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;

/** 90 days of daily new entries up to 22 Oct 2026 (prototype formula, deterministic). */
export const DAILY_ACTIVITY: { d: Date; v: number }[] = Array.from({ length: 90 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 22) - (89 - i) * 864e5);
  const wd = (d.getUTCDay() + 6) % 7;
  const v = (wd >= 5 ? 0 : 1) + Math.round(1.3 * Math.abs(Math.sin(i * 1.7))) + (i > 72 ? 1 : 0);
  return { d, v };
});

export type InsightsRange = 7 | 30 | 90;
export const RANGES: [InsightsRange, string][] = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];

/** Energy check-ins 9–22 Oct and whether Morning Mobility happened that day. */
export const ENERGY = [7, 8, 6, 7, 8, 9, 7, 6, 8, 8, 7, 9, 7, 9];
export const MOBILITY = [1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1];
export const energyDate = (i: number) => dayLabel(new Date(Date.UTC(2026, 9, 9 + i)));

export const SPACE_COUNTS: { label: string; v: number; g: string }[] = [
  { label: "Articles", v: 54, g: "auto" },
  { label: "Notes", v: 42, g: "ai" },
  { label: "Meetings", v: 32, g: "auto" },
  { label: "AI Memories", v: 29, g: "ai" },
  { label: "Videos & Podcasts", v: 19, g: "health" },
  { label: "Recipes", v: 14, g: "food" },
  { label: "Books", v: 11, g: "strategy" },
];

export const SOURCES: { label: string; pct: number; c: string }[] = [
  { label: "Browser extension", pct: 41, c: "var(--tag-auto-dot)" },
  { label: "Web app", pct: 27, c: "var(--tag-ai-dot)" },
  { label: "Mobile share", pct: 22, c: "var(--tag-health-dot)" },
  { label: "Desktop HUD", pct: 10, c: "var(--tag-strategy-dot)" },
];

/** Morning Mobility heat map, 12 weeks × 7 days: colour-mix level 0..100 per day. */
export const HABIT_HEAT: number[] = Array.from({ length: 84 }, (_, i) => {
  const on = (i * 37 + 11) % 100 > 30 || i > 70;
  return on ? 40 + ((i * 53) % 60) : 0;
});

export type RecCategory = "books" | "podcasts" | "meetings" | "personal" | "links" | "gaps";
export type RecAction =
  { kind: "note"; id: string } | { kind: "life"; key: string } | { kind: "graph" };
export type InsightsIcon =
  | "in-spark"
  | "in-book"
  | "in-pod"
  | "in-cal"
  | "in-compass"
  | "in-layers"
  | "in-link"
  | "in-target";

export interface Recommendation {
  k: string;
  cat: RecCategory;
  title: string;
  meta?: string;
  text: string;
  why: string;
  cta: string;
  doneLabel?: string;
  /** Toast after the CTA. */
  msg?: string;
  /** Navigation instead of a done state. */
  fn?: RecAction;
  icon?: InsightsIcon;
  cover?: { kind: "book" | "pod"; title: string; sub: string; c1: string; c2: string };
}

const book = (title: string, sub: string, c1: string, c2: string) => ({
  kind: "book" as const,
  title,
  sub,
  c1,
  c2,
});
const pod = (title: string, c1: string, c2: string) => ({
  kind: "pod" as const,
  title,
  sub: "Podcast",
  c1,
  c2,
});

const avg = (a: number[]) => a.reduce((t, x) => t + x, 0) / a.length;
const one = (v: number) => v.toFixed(1);
export const ENERGY_AVG = one(avg(ENERGY));
const withMob = one(avg(ENERGY.filter((_, i) => MOBILITY[i])));
const withoutMob = one(avg(ENERGY.filter((_, i) => !MOBILITY[i])));

export const RECOMMENDATIONS: Recommendation[] = [
  {
    k: "b1",
    cat: "books",
    title: "Designing Data-Intensive Applications",
    meta: "Martin Kleppmann · Book",
    text: "Replication, consistency and conflict resolution in distributed systems, the groundwork for your vault sync.",
    why: "Your Q4 sync is about conflicts and checksums. The chapters on replication answer exactly that question.",
    cta: "Add to reading list",
    doneLabel: "On the reading list",
    cover: book("Data-Intensive Applications", "M. Kleppmann", "#1E3A5F", "#0EA5E9"),
  },
  {
    k: "b2",
    cat: "books",
    title: "Playing to Win",
    meta: "A. G. Lafley, Roger Martin · Book",
    text: "Strategy as a chain of five choices, from the winning aspiration to the capabilities.",
    why: "Adds a decision frame to your Blue Ocean notes and the strategy course.",
    cta: "Add to reading list",
    doneLabel: "On the reading list",
    cover: book("Playing to Win", "Lafley · Martin", "#4C1D95", "#A855F7"),
  },
  {
    k: "p1",
    cat: "podcasts",
    title: "Latent Space",
    meta: "AI Engineering · weekly",
    text: "Conversations with teams who run agents, retrieval and evals in production.",
    why: "You saved 6 entries on MCP and Claude Code memory, but no podcast on it yet.",
    cta: "Subscribe",
    doneLabel: "Subscribed",
    cover: pod("Latent Space", "#312E81", "#6366F1"),
  },
  {
    k: "p2",
    cat: "podcasts",
    title: "Huberman Lab",
    meta: "Health and performance · episodes on endurance",
    text: "Episodes on endurance, recovery and sleep to go with the training block.",
    why: 'After "Zone 2 Training" and 4 running entries in 3 weeks.',
    cta: "Subscribe",
    doneLabel: "Subscribed",
    cover: pod("Endurance and Recovery", "#064E3B", "#10B981"),
  },
  {
    k: "m1",
    cat: "meetings",
    icon: "in-cal",
    title: "1:1 Priya, today 14:00",
    meta: "Prep briefing · 3 points",
    text: "Feedback on the Q4 sync, her question about the diff view and the open strategy course canvas.",
    why: "From the calendar, the Q4 sync minutes and your career life area.",
    cta: "Open briefing",
    fn: { kind: "note", id: "n2" },
  },
  {
    k: "m2",
    cat: "meetings",
    icon: "in-cal",
    title: "Support platform roadmap, 16:30",
    meta: "Read first · 6 min",
    text: 'The article "MCP Servers for Support Knowledge" from this morning answers two questions on the agenda.',
    why: "Agenda terms match your article from 09:30.",
    cta: "Add to briefing",
    doneLabel: "In the briefing",
    msg: "Article added to the meeting briefing",
  },
  {
    k: "d1",
    cat: "personal",
    icon: "in-compass",
    title: "Deep work in the morning",
    meta: "Personal development · 7-day experiment",
    text: "A 90-minute block before the first meeting, without inbox and chat.",
    why: "On days with a focus block your journal lists 2.3 times as many finished priorities.",
    cta: "Try as a habit",
    doneLabel: "Experiment running",
    msg: "7-day deep work experiment started",
  },
  {
    k: "mob",
    cat: "personal",
    icon: "in-compass",
    title: "Mobility shows a measurable effect",
    meta: "Health & Fitness",
    text: `On days with morning mobility your energy is ${withMob}, without it ${withoutMob}.`,
    why: "Correlation from 14 check-ins and your habit tracking.",
    cta: "Reminder at 7:00",
    doneLabel: "Reminder on",
    msg: "Reminder set for 7:00",
  },
  {
    k: "fin",
    cat: "personal",
    icon: "in-compass",
    title: "Finances: nine days without an entry",
    meta: "Life area · 61 %",
    text: "The viewing checklist is waiting. Twenty minutes with Sam on Saturday would settle it.",
    why: "Lowest balance value of your six life areas.",
    cta: "Open life area",
    fn: { kind: "life", key: "finance" },
  },
  {
    k: "g1",
    cat: "gaps",
    icon: "in-target",
    title: "Vector databases",
    meta: "Knowledge gap · 11 mentions",
    text: "Often touched, never explored: no note of your own, but a topic in 4 meetings and 7 articles.",
    why: "The topic appears in your lead theme and matters for the Q4 release.",
    cta: "Create learning path",
    doneLabel: "Learning path in Tasks",
    msg: "Learning path with 4 steps added to Tasks",
  },
  {
    k: "g2",
    cat: "gaps",
    icon: "in-target",
    title: "Three highlights without a note",
    meta: "AI Engineering, chapter 3",
    text: "Highlights without your own thoughts are hard for the copilot to find.",
    why: "Highlights with a note are cited 3 times as often in answers.",
    cta: "Open note",
    fn: { kind: "note", id: "n3" },
  },
  {
    k: "l1",
    cat: "links",
    icon: "in-link",
    title: "Zone 2 and the side project roadmap",
    meta: "Connection · 2 notes",
    text: "Both describe the same principle: base first, then intensity. Your roadmap puts features before sync stability.",
    why: "Semantic similarity 0.82 with zero links between the notes.",
    cta: "Link them",
    doneLabel: "Linked",
    msg: "Backlink added between both notes",
  },
  {
    k: "l2",
    cat: "links",
    icon: "in-link",
    title: "AI Engineering and the Gardener Pipeline",
    meta: "Connection · 2 notes",
    text: "Chapter 3 puts context in front of every chunk. Your gardener pipeline still embeds clips without context, which costs accuracy.",
    why: "The same terms in different spaces, never opened together.",
    cta: "Show in graph",
    fn: { kind: "graph" },
  },
];

export type RecFilter = "all" | "deep" | RecCategory;
/** V2-08b: "Alle" plus the three most used categories stay visible; the rest lives in "Mehr". */
export const REC_CATS_VISIBLE: RecFilter[] = ["all", "books", "podcasts", "meetings"];
export const REC_CATS: [RecFilter, string, InsightsIcon][] = [
  ["all", "All", "in-spark"],
  ["books", "Books", "in-book"],
  ["podcasts", "Podcasts", "in-pod"],
  ["meetings", "Meeting prep", "in-cal"],
  ["personal", "Personal development", "in-compass"],
  ["deep", "Deeper topics", "in-layers"],
  ["links", "Connections", "in-link"],
  ["gaps", "Knowledge gaps", "in-target"],
];

export const REC_KIND: Record<RecCategory, string> = {
  books: "Book",
  podcasts: "Podcast",
  meetings: "Meeting prep",
  personal: "Personal development",
  links: "Connection",
  gaps: "Knowledge gap",
};

export const REC_ICON_COLOR: Record<RecCategory, string> = {
  books: "var(--tag-auto-fg)",
  podcasts: "var(--tag-health-fg)",
  meetings: "var(--tag-strategy-fg)",
  personal: "var(--accent-checkin)",
  links: "var(--tag-ai-fg)",
  gaps: "var(--status-processing)",
};

/** "Für heute" picks in the bento view. */
export const REC_TOP = ["m1", "g1", "l2"];

/** Lead theme of the week (bento hero / "Tiefere Themen"). */
export interface LeadTheme {
  title: string;
  long: string;
  short: string;
  img: CoverKey;
  /** Tag pills of the "Tiefere Themen" view: [label, count]. */
  tags: [string, number][];
}

export const LEAD_THEME: LeadTheme = {
  tags: [
    ["#ai/mcp", 9],
    ["#it/platform", 12],
    ["#ai/agents", 6],
  ],
  title: "Agent architecture for support platforms",
  long: "Three threads in your vault are coming together: the MCP connection from Claude Code, the platform work from your meetings and contextual retrieval from chapter 3. Together they suggest one thesis: agents in the backend need less model and more well-curated context.",
  short:
    "MCP connection, platform work and contextual retrieval come together: backend agents need less model and more curated context.",
  img: "car",
};

/**
 * Everything the Insights view renders. The mock below is one instance; live data comes from
 * lib/data/insights.ts (server/insights). Dates are "YYYY-MM-DD".
 */
export interface InsightsData {
  asOf: string;
  basis: string;
  /** New entries per day, oldest first, ending today (90 days in the mock, 180 live). */
  activity: { date: string; v: number }[];
  /** Share of entries filed without manual work, per range; null = no entries. */
  autoPct: Record<InsightsRange, number | null>;
  /** Last 14 days: energy 1..10 (null = no check-in) and whether the main habit was done. */
  energy: { date: string; label: string; v: number | null; habit: boolean }[];
  /** Main habit of the energy chart / heat map ("Morning Mobility"); null = none tracked. */
  habitLabel: string | null;
  energyAvg: string | null;
  /** Change of the 7-day energy average against the 7 days before. */
  energyDelta: number | null;
  streak: number;
  streakRecord: number;
  spaces: { label: string; v: number; g: string }[];
  spacesTotal: number;
  sources: { label: string; pct: number; c: string }[];
  /** 84 cells (12 weeks, Mo..So per column), colour-mix level 0..100; null = no habit. */
  habitHeat: number[] | null;
  lead: LeadTheme | null;
  recommendations: Recommendation[];
  /** Keys of the "Für heute" picks (must exist in recommendations). */
  top: string[];
  /** fresh = cached today · stale = being refreshed · none = not generated yet · too_little = not enough data. */
  impulses: "fresh" | "stale" | "none" | "too_little";
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export const MOCK_INSIGHTS: InsightsData = {
  asOf: INSIGHTS_AS_OF,
  basis: INSIGHTS_BASIS,
  activity: DAILY_ACTIVITY.map((x) => ({ date: isoOf(x.d), v: x.v })),
  autoPct: { 7: 63, 30: 63, 90: 63 },
  energy: ENERGY.map((v, i) => ({
    date: isoOf(new Date(Date.UTC(2026, 9, 9 + i))),
    label: energyDate(i),
    v,
    habit: MOBILITY[i] === 1,
  })),
  habitLabel: "Morning Mobility",
  energyAvg: ENERGY_AVG,
  energyDelta: 0.4,
  streak: 14,
  streakRecord: 21,
  spaces: SPACE_COUNTS,
  spacesTotal: 148,
  sources: SOURCES,
  habitHeat: HABIT_HEAT,
  lead: LEAD_THEME,
  recommendations: RECOMMENDATIONS,
  top: REC_TOP,
  impulses: "fresh",
};
