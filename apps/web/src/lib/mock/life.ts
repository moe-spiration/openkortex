import type { CoverKey } from "./views";

/*
 * Life Areas, taken 1:1 from design/reference/Life.dc.html (areas() / signals).
 * Etappe 2: areas become `goal`/`concept` objects in 70_Objects plus aggregates from daily notes;
 * keep the shapes. Note ids in `links` refer to lib/mock/notes.ts.
 */

export type LifeTone = "health" | "strategy" | "finance" | "ai" | "food";

export interface LifeGoal {
  t: string;
  due: string;
  pct: number;
  next: string;
}

export interface LifeRoutine {
  t: string;
  /** Done per weekday Mo..So (1 = done). Thursday (index 3) is "today" in the mock week. */
  d: (0 | 1)[];
}

export interface LifeAreaDetail {
  key: string;
  name: string;
  img: CoverKey;
  tone: LifeTone;
  score: number;
  focus: string;
  vision: string;
  why: string;
  goals: LifeGoal[];
  routines: LifeRoutine[];
  metrics: { v: string; l: string }[];
  reflect: string;
  links: string[];
  /** Live data: the area has no goals, tasks, entries or routines yet (score is 0). */
  empty?: boolean;
  /** Live data: chosen in onboarding (custom_taxonomy). Inactive areas are left out of the overview. */
  active?: boolean;
  /** Live data: score per range of the overview (7/30/90 days), each with the window before it. */
  ranges?: Record<LifeRange, LifeRangeScore>;
  /** Live data: up to three open goals/projects or newest entries of the area. */
  picks?: LifePick[];
}

/** Score windows of the Life overview's range switch (days). The area's `score` is the 30-day one. */
export const LIFE_RANGES = [7, 30, 90] as const;
export type LifeRange = (typeof LIFE_RANGES)[number];
export const LIFE_DEFAULT_RANGE: LifeRange = 30;

/** Score of one window and of the window before it (trend); null = no data in that window. */
export interface LifeRangeScore {
  score: number | null;
  prev: number | null;
}

/** An object or entry of an area, opened from the overview card. */
export interface LifePick {
  id: string;
  title: string;
  type: string;
}

/** "Seen this week" signal; opens its area. `rank` orders live signals (server only). */
export interface LifeSignal {
  area: string;
  text: string;
  key: string;
  rank?: number;
}

/** Index of "today" in the routine week (prototype marks Thursday with an outline). */
export const ROUTINE_TODAY = 3;
export const WEEKDAY_SHORT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export const LIFE_DETAILS: LifeAreaDetail[] = [
  {
    key: "health",
    name: "Health & Fitness",
    img: "runner",
    tone: "health",
    score: 82,
    focus: "Half marathon block",
    vision: "Fitter at 45 than at 35: resilient, mobile and well rested.",
    why: "Energy is the base for everything else, so training, mobility and food are fixed appointments, not leftover time.",
    goals: [
      {
        t: "Half marathon under 1:50 h",
        due: "March",
        pct: 58,
        next: "Next step: hill sprints twice a week",
      },
      {
        t: "Mobility four times a week",
        due: "ongoing",
        pct: 75,
        next: "3 of 4 sessions this week",
      },
      { t: "Low-carb on five days", due: "ongoing", pct: 80, next: "Plan meal prep for Sunday" },
    ],
    routines: [
      { t: "Morning Mobility", d: [1, 1, 1, 1, 0, 0, 0] },
      { t: "Zone 2 run", d: [0, 1, 0, 0, 0, 0, 0] },
    ],
    metrics: [
      { v: "8.1", l: "Energy, 7-day average" },
      { v: "14", l: "Day streak" },
      { v: "4", l: "Workouts / week" },
    ],
    reflect:
      "On days with morning mobility your energy is 1.6 points higher on average. The Zone 2 run has happened only once this week.",
    links: ["n6", "n7", "n12", "n5", "n20"],
  },
  {
    key: "career",
    name: "Career & Leadership",
    img: "skyline",
    tone: "strategy",
    score: 70,
    focus: "Strategy course",
    vision: "Lead technology so that change becomes measurable and teams grow.",
    why: "Impact comes from clear decisions, visible progress and people who take ownership.",
    goals: [
      {
        t: "Finish the strategy course module",
        due: "Dec",
        pct: 65,
        next: "Finish the Blue Ocean canvas",
      },
      {
        t: "Make the retro actions stick in the delivery team",
        due: "Nov",
        pct: 40,
        next: "Send the results to the team",
      },
      {
        t: "One article per month",
        due: "ongoing",
        pct: 50,
        next: "Draft on MCP for support knowledge",
      },
    ],
    routines: [
      { t: "Weekly review on Friday", d: [0, 0, 0, 0, 1, 0, 0] },
      { t: "30 minutes of reading", d: [1, 0, 1, 1, 0, 0, 0] },
    ],
    metrics: [
      { v: "6", l: "Meetings this week" },
      { v: "3", l: "Decisions recorded" },
      { v: "2", l: "Articles in draft" },
    ],
    reflect:
      "Three entries are about platform strategy and MCP. They could become the article for November.",
    links: ["n11", "n15", "n18", "n9", "n22"],
  },
  {
    key: "finance",
    name: "Finances & Investments",
    img: "stones",
    tone: "finance",
    score: 61,
    focus: "First home",
    vision: "Spread savings widely and buy a first home without stretching too far.",
    why: "Financial calm gives room for bigger decisions.",
    goals: [
      {
        t: "Shortlist and assess three apartments",
        due: "Q1",
        pct: 35,
        next: "Go through the checklist with Sam",
      },
      { t: "Finish the first home learning path", due: "Dec", pct: 62, next: "Module: mortgages" },
      {
        t: "Monthly money check",
        due: "ongoing",
        pct: 70,
        next: "Next one on 1 November",
      },
    ],
    routines: [{ t: "Money check", d: [0, 0, 0, 0, 0, 1, 0] }],
    metrics: [
      { v: "3", l: "Apartments viewed" },
      { v: "5/8", l: "Learning path modules" },
      { v: "9", l: "Days since last entry" },
    ],
    reflect:
      "No new entry for nine days. The viewing checklist is still waiting to be gone through with Sam.",
    links: ["n10", "n17", "n23"],
  },
  {
    key: "ventures",
    name: "Ventures",
    img: "loft",
    tone: "ai",
    score: 76,
    focus: "Side project MVP",
    vision: "Build products that give me and others time back every day.",
    why: "The side project is the first one I use myself every day. Your own need is the best product test.",
    goals: [
      {
        t: "Gardener pipeline as a prototype",
        due: "Nov",
        pct: 55,
        next: "Write a context per chunk",
      },
      {
        t: "Vault sync with a conflict concept",
        due: "Nov",
        pct: 70,
        next: "The .conflict.md failure case in the spec",
      },
      { t: "First 20 beta users", due: "Jan", pct: 15, next: "Set up a waiting list" },
    ],
    routines: [{ t: "Deep work block", d: [1, 1, 0, 1, 0, 0, 0] }],
    metrics: [
      { v: "12", l: "Entries this week" },
      { v: "2", l: "Specs open" },
      { v: "4", l: "MCP tools" },
    ],
    reflect:
      "The architecture sync and the MCP session belong together. One shared spec would answer two open questions at once.",
    links: ["n13", "n2", "n4", "n8", "n24"],
  },
  {
    key: "relations",
    name: "Relationships & Family",
    img: "dinner",
    tone: "food",
    score: 68,
    focus: "Evenings together",
    vision: "Be present: fixed screen-free time for the people who matter.",
    why: "The most important conversations do not happen in the calendar, but they need room in it.",
    goals: [
      {
        t: "One evening together per week",
        due: "ongoing",
        pct: 75,
        next: "Keep Friday evening free",
      },
      { t: "One day trip per month", due: "Nov", pct: 50, next: "Collect ideas" },
    ],
    routines: [{ t: "Screen-free evening", d: [0, 1, 0, 0, 1, 0, 0] }],
    metrics: [
      { v: "2", l: "Evenings this week" },
      { v: "1", l: "Trip planned" },
      { v: "3", l: "Shared projects" },
    ],
    reflect:
      "The apartment search is a shared project with Sam. A fixed slot for it takes pressure off both areas.",
    links: ["n10", "n1", "n25"],
  },
  {
    key: "growth",
    name: "Personal Growth",
    img: "journal",
    tone: "strategy",
    score: 79,
    focus: "Journal streak",
    vision: "Think, write and decide a little more clearly every day.",
    why: "The journal is where thoughts turn into decisions.",
    goals: [
      { t: "Daily journal", due: "ongoing", pct: 90, next: "Keep the streak: 14 days" },
      { t: "24 book notes a year", due: "Dec", pct: 71, next: "AI Engineering, chapter 3" },
    ],
    routines: [
      { t: "Journal", d: [1, 1, 1, 1, 0, 0, 0] },
      { t: "Reading", d: [1, 0, 1, 1, 0, 0, 0] },
    ],
    metrics: [
      { v: "14", l: "Journal days" },
      { v: "17", l: "Book notes 2026" },
      { v: "42", l: "Highlights in October" },
    ],
    reflect:
      "Your best ideas come in the morning between 7 and 9. The mind dump in the check-in catches them reliably.",
    links: ["n1", "n3", "n11", "n21"],
  },
];

/** "Seen this week" signals on the overview; each opens its area. */
export const LIFE_SIGNALS: LifeSignal[] = [
  {
    area: "Finances & Investments",
    text: "No entry for nine days. The viewing checklist is waiting for Sam.",
    key: "finance",
  },
  {
    area: "Health & Fitness",
    text: "Energy is 1.6 points higher on average on days with morning mobility.",
    key: "health",
  },
  {
    area: "Ventures",
    text: "The sync spec and the MCP session fit into one document.",
    key: "ventures",
  },
];
