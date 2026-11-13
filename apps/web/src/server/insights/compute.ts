import { intlLocale, msg, t, tn, tx } from "@/i18n";
import { currentStreak, streakRecord } from "@kortex/db/daily";
import type { InsightsData, InsightsRange, LeadTheme } from "@/lib/mock/insights";
import type { CoverKey } from "@/lib/mock/views";
import { addDays, deDecimal, localDate, mondayOf, shortDay } from "../life/dates";
import type { DailyEntry, LifeSource, SourceItem } from "../life/source";

/*
 * Insights figures from real data (deterministic). Recommendations come from the cached AI
 * impulses (./impulses.ts) and are merged in by the caller.
 */

/** Light per-item facts over the whole vault (counts per space and source). */
export interface VaultFact {
  type: string;
  platform: string;
}

const SPACE_GROUPS: { label: string; g: string; types: string[] }[] = [
  { label: msg("Articles"), g: "auto", types: ["article", "bookmark", "social", "email"] },
  { label: msg("Notes"), g: "ai", types: ["note", "voice", "image"] },
  { label: "Meetings", g: "auto", types: ["meeting"] },
  { label: "AI Memories", g: "ai", types: ["ai_chat"] },
  { label: "Videos & Podcasts", g: "health", types: ["video", "podcast"] },
  { label: msg("Recipes"), g: "food", types: ["recipe"] },
  { label: msg("Books"), g: "strategy", types: ["pdf", "epub"] },
];

const PLATFORM_LABEL: Record<string, string> = {
  web: "Web & Extension",
  extension: msg("Browser extension"),
  manual: msg("Written by hand"),
  upload: "Upload",
  mobile: "Mobile Share",
  teams_wasapi: "Desktop HUD",
  desktop: "Desktop HUD",
  youtube: "YouTube",
  chatgpt: msg("AI chats"),
  claude: msg("AI chats"),
  spotify: "Podcasts",
  mcp: msg("Agents (MCP)"),
};
const SOURCE_COLORS = [
  "var(--tag-auto-dot)",
  "var(--tag-ai-dot)",
  "var(--tag-health-dot)",
  "var(--tag-strategy-dot)",
];
const LEAD_IMAGES: CoverKey[] = ["car", "loft", "skyline", "journal", "stones", "runner"];

const avg = (a: number[]) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);

/** Most frequently done habit of the last 14 days (the energy chart's dot colour). */
function mainHabit(dailies: DailyEntry[]): { key: string; label: string } | null {
  const count = new Map<string, { label: string; n: number }>();
  for (const d of dailies.slice(-14))
    for (const h of d.habits) {
      const c = count.get(h.key) ?? { label: h.label, n: 0 };
      c.n += h.done ? 1 : 0;
      count.set(h.key, c);
    }
  const best = [...count].sort((a, b) => b[1].n - a[1].n)[0];
  return best ? { key: best[0], label: best[1].label } : null;
}

/**
 * Current daily-note streak (today or up to yesterday) and the longest run in the window.
 * W6/A-08: the shared `@kortex/db/daily` rule, so Insights shows the same number as Home/Journal.
 */
export function streaks(dailies: DailyEntry[], today: string): { streak: number; record: number } {
  const days = dailies.map((d) => d.date);
  const streak = currentStreak(days, today);
  return { streak, record: Math.max(streakRecord(days), streak) };
}

function leadTheme(items: SourceItem[], today: string, tz: string): LeadTheme | null {
  const from = addDays(today, -29);
  const recent = items.filter((i) => localDate(i.created, tz) >= from);
  const tags = new Map<string, number>();
  for (const i of recent)
    for (const t of i.tags)
      if (!/^(daily|life\/|area\/|digest)/i.test(t)) tags.set(t, (tags.get(t) ?? 0) + 1);
  const ranked = [...tags].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || top[1] < 3) return null;
  const root = top[0].split("/")[0]!;
  const related = ranked.filter(([t]) => t.split("/")[0] === root || t === top[0]).slice(0, 3);
  const n = recent.filter((i) => i.tags.some((t) => t.split("/")[0] === root)).length;
  const title = `#${top[0]}`;
  const examples = recent
    .filter((i) => i.tags.includes(top[0]))
    .slice(0, 3)
    .map((i) => t("“{title}”", { title: i.title }));
  return {
    title,
    short: t("{n} entries of the last 30 days revolve around #{topic}. That is your strongest topic.", { n, topic: root }),
    long: examples.length
      ? t(
          "{n} entries of the last 30 days revolve around #{topic}, more than around any other topic. Among them {examples}. A synthesis note would bring the threads together.",
          { n, topic: root, examples: examples.join(", ") },
        )
      : t(
          "{n} entries of the last 30 days revolve around #{topic}, more than around any other topic. A synthesis note would bring the threads together.",
          { n, topic: root },
        ),
    img: LEAD_IMAGES[root.length % LEAD_IMAGES.length]!,
    tags: related.map(([t, c]) => [`#${t}`, c]),
  };
}

export function computeInsights(
  src: LifeSource,
  vault: VaultFact[],
  now: Date,
): Omit<InsightsData, "recommendations" | "top" | "impulses" | "basis"> & {
  counts: Record<string, number>;
} {
  const { today, timeZone: tz } = src;
  const created = src.items.map((i) => ({
    day: localDate(i.created, tz),
    auto: !i.manual && i.status === "processed",
  }));
  const activity = Array.from({ length: 180 }, (_, k) => {
    const date = addDays(today, k - 179);
    return { date, v: created.filter((c) => c.day === date).length };
  });
  const autoPct = {} as Record<InsightsRange, number | null>;
  for (const r of [7, 30, 90] as InsightsRange[]) {
    const from = addDays(today, -(r - 1));
    const inRange = created.filter((c) => c.day >= from);
    autoPct[r] = inRange.length
      ? Math.round((inRange.filter((c) => c.auto).length / inRange.length) * 100)
      : null;
  }

  const habit = mainHabit(src.dailies);
  const byDate = new Map(src.dailies.map((d) => [d.date, d]));
  const energy = Array.from({ length: 14 }, (_, k) => {
    const date = addDays(today, k - 13);
    const d = byDate.get(date);
    return {
      date,
      label: shortDay(date),
      v: d?.energy ?? null,
      habit: Boolean(habit && d?.habits.some((h) => h.key === habit.key && h.done)),
    };
  });
  const lastWeek = avg(energy.slice(7).flatMap((e) => (e.v === null ? [] : [e.v])));
  const weekBefore = avg(energy.slice(0, 7).flatMap((e) => (e.v === null ? [] : [e.v])));
  const { streak, record } = streaks(src.dailies, today);

  const counts: Record<string, number> = {};
  for (const f of vault) counts[f.type] = (counts[f.type] ?? 0) + 1;
  const spaces = SPACE_GROUPS.map((g) => ({
    label: t(g.label),
    g: g.g,
    v: g.types.reduce((t, ty) => t + (counts[ty] ?? 0), 0),
  })).filter((s) => s.v > 0);
  const spacesTotal = spaces.reduce((t, s) => t + s.v, 0);

  const platforms = new Map<string, number>();
  for (const f of vault) {
    if (f.platform === "kortex" || f.type === "daily_note" || f.type === "digest") continue;
    const label =
      PLATFORM_LABEL[f.platform] !== undefined
        ? t(PLATFORM_LABEL[f.platform]!)
        : f.platform.charAt(0).toUpperCase() + f.platform.slice(1);
    platforms.set(label, (platforms.get(label) ?? 0) + 1);
  }
  const pTotal = [...platforms.values()].reduce((a, b) => a + b, 0);
  let ranked = [...platforms].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 4)
    ranked = [...ranked.slice(0, 3), [t("Other"), ranked.slice(3).reduce((t, [, n]) => t + n, 0)]];
  const sources = pTotal
    ? ranked.map(([label, n], i) => ({
        label,
        pct: Math.round((n / pTotal) * 100),
        c: SOURCE_COLORS[i % SOURCE_COLORS.length]!,
      }))
    : [];

  let habitHeat: number[] | null = null;
  if (habit) {
    // 12 weeks × 7 days ending this week, column-major like the heat map (Mo..So per column).
    const start = addDays(mondayOf(today), -77);
    habitHeat = Array.from({ length: 84 }, (_, k) => {
      const d = byDate.get(addDays(start, k));
      const done = d?.habits.some((h) => h.key === habit.key && h.done);
      return done ? 70 + ((d!.energy ?? 5) - 5) * 6 : 0;
    });
  }

  const asOfDate = new Intl.DateTimeFormat(intlLocale(), {
    timeZone: tz,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return {
    asOf: t("As of {date}. All figures from your vault, without external trackers.", { date: asOfDate }),
    activity,
    autoPct,
    energy,
    habitLabel: habit?.label ?? null,
    energyAvg: lastWeek === null ? null : deDecimal(lastWeek),
    energyDelta:
      lastWeek !== null && weekBefore !== null
        ? Math.round((lastWeek - weekBefore) * 10) / 10
        : null,
    streak,
    streakRecord: record,
    spaces,
    spacesTotal,
    sources,
    habitHeat,
    lead: leadTheme(src.items, today, tz),
    counts,
  };
}

/** "Abgeleitet aus 148 Einträgen, 32 Meetings, 11 Büchern und 19 Podcasts." */
export function basisLine(
  counts: Record<string, number>,
  impulsesAt: string | null,
  tz: string,
): string {
  const n = (t: string[]) => t.reduce((s, x) => s + (counts[x] ?? 0), 0);
  const total = Object.entries(counts)
    .filter(([t]) => t !== "daily_note" && t !== "digest")
    .reduce((s, [, v]) => s + v, 0);
  const parts = [total === 1 ? tx("derived from", "{n} entry", { n: total }) : tx("derived from", "{n} entries", { n: total })];
  const meetings = n(["meeting"]);
  const books = n(["pdf", "epub"]);
  const pods = n(["podcast"]);
  if (meetings) parts.push(tn(meetings, "{n} meeting", "{n} meetings"));
  if (books) parts.push(books === 1 ? tx("derived from", "{n} book", { n: books }) : tx("derived from", "{n} books", { n: books }));
  if (pods) parts.push(tn(pods, "{n} podcast", "{n} podcasts"));
  const list = parts.length > 1 ? t("{a} and {b}", { a: parts.slice(0, -1).join(", "), b: parts.at(-1) ?? "" }) : (parts[0] ?? "");
  const derived = t("Derived from {list}.", { list });
  if (!impulsesAt) return derived;
  const at = new Intl.DateTimeFormat(intlLocale(), { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(impulsesAt));
  return `${derived} ${t("Impulses from {date}.", { date: at })}`;
}
