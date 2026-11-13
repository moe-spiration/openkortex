import { t, tn, tx } from "@/i18n";
import type { ReviewData, ReviewDigest, ReviewFocus } from "@/lib/mock/review";
import { activeAreaKeys, areaDef, areaOf } from "../life/areas";
import { areaScore, partition, type LifeData } from "../life/compute";
import {
  addDays,
  deDecimal,
  isoWeek,
  isoWeekKey,
  localDate,
  longDay,
  mondayOf,
  weekLabel,
  weekYearLabels,
} from "../life/dates";
import type { LifeSource, SourceItem } from "../life/source";

/*
 * Weekly review from real data: the ISO week containing "today". Deterministic; the AI part is the
 * weekly digest (POST /api/digest, saved in 90_Digests), whose headlines become the summary when
 * one exists for the week. Saving writes 10_Notes/Weekly/YYYY-Www.md (lib/data/review.ts).
 */

export const WEEKLY_FOLDER = "10_Notes/Weekly";
const dayShort = () => [
  tx("weekday short", "Mon"),
  tx("weekday short", "Tue"),
  tx("weekday short", "Wed"),
  tx("weekday short", "Thu"),
  tx("weekday short", "Fri"),
];
/** A title in quotation marks of the current language. */
const quoted = (title: string) => t("“{title}”", { title });
const HIGHLIGHT_TYPES = [
  "meeting",
  "note",
  "article",
  "pdf",
  "epub",
  "podcast",
  "video",
  "ai_chat",
];

const pillClass = (areaKey: string | null) => {
  const tone = areaKey ? areaDef(areaKey)?.tone : undefined;
  return tone && tone !== "ai" ? `kx-pill--${tone}` : "";
};

/** Digest items → list rows (metadata from server/digest/service.ts saveDigest). */
export function toReviewDigests(digests: SourceItem[]): ReviewDigest[] {
  return digests.slice(0, 12).map((d) => ({
    id: d.id,
    title: d.title,
    group: typeof d.metadata.group === "string" ? d.metadata.group : "",
    week: typeof d.metadata.iso_week === "string" ? d.metadata.iso_week : "",
    periodStart: typeof d.metadata.period_start === "string" ? d.metadata.period_start : null,
    headline: d.summary,
  }));
}

/** Consecutive ISO weeks (ending this or last week) with a saved weekly review note. */
export function reviewSeries(items: SourceItem[], today: string, tz: string): number {
  const weeks = new Set(
    items
      .filter((i) => i.folder === WEEKLY_FOLDER && /^\d{4}-w\d{2}$/i.test(i.slug))
      .map((i) => i.slug.toUpperCase()),
  );
  let monday = mondayOf(today);
  if (!weeks.has(isoWeekKey(monday))) monday = addDays(monday, -7);
  let n = 0;
  while (weeks.has(isoWeekKey(monday))) {
    n++;
    monday = addDays(monday, -7);
  }
  void tz;
  return n;
}

/** First sentence of a text, with a closing period. */
export function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  const m = /^.*?[.!?](?=\s+[A-ZÄÖÜ„"]|$)/.exec(t);
  return (m ? m[0] : t).replace(/[.!?]?$/, (p) => p || ".");
}

export function computeReview(src: LifeSource, life: LifeData): ReviewData {
  const { today, timeZone: tz } = src;
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const nextMonday = addDays(monday, 7);
  const { week } = isoWeek(today);
  const key = isoWeekKey(today);
  const kw = (d: string) => weekLabel(isoWeek(d).week);
  const inWeek = (iso: string) => {
    const d = localDate(iso, tz);
    return d >= monday && d <= sunday;
  };

  const items = src.items.filter((i) => inWeek(i.created) && i.folder !== WEEKLY_FOLDER);
  const meetings = items.filter((i) => i.type === "meeting");
  const doneTasks = src.tasks.filter((t) => t.done && t.completed && inWeek(t.completed));
  const dailies = src.dailies.filter((d) => d.date >= monday && d.date <= sunday);
  const energies = dailies.flatMap((d) => (d.energy === null ? [] : [d.energy]));
  const energyAvg = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null;

  const tags = new Map<string, number>();
  for (const i of items)
    for (const t of i.tags)
      if (!/^(daily|life\/|area\/)/i.test(t)) tags.set(t, (tags.get(t) ?? 0) + 1);
  const topTag = [...tags].sort((a, b) => b[1] - a[1])[0];

  const open = src.tasks
    .filter((t) => !t.done && t.due && t.due <= sunday)
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .slice(0, 4);

  // Summary: this week's digest headlines, else a sentence from the numbers.
  const digests = toReviewDigests(src.digests);
  // Digests label their week like "KW 43/2026" or "Week 43/2026" (server/digest/service.ts).
  const { year } = isoWeek(today);
  const weekDigests = digests.filter((d) => weekYearLabels(week, year).includes(d.week));
  let summary: string;
  if (weekDigests.some((d) => d.headline)) {
    // One sentence per digest (the headline's first), at most three.
    summary = weekDigests
      .flatMap((d) => (d.headline ? [firstSentence(d.headline)] : []))
      .slice(0, 3)
      .join(" ");
  } else if (items.length || doneTasks.length || dailies.length) {
    const parts = [
      t("{entries}, {meetings} and {tasks}.", {
        entries: tn(items.length, "{n} new entry", "{n} new entries"),
        meetings: tn(meetings.length, "{n} meeting", "{n} meetings"),
        tasks: tn(doneTasks.length, "{n} completed task", "{n} completed tasks"),
      }),
    ];
    if (topTag && topTag[1] >= 2) parts.push(t("The main topic was #{tag}.", { tag: topTag[0] }));
    if (energyAvg !== null) parts.push(t("Your energy averaged {avg}.", { avg: deDecimal(energyAvg) }));
    if (open.length)
      parts.push(
        t("Left undone: {list}.", {
          list: open[1] ? t("{a} and {b}", { a: quoted(open[0]!.title), b: quoted(open[1].title) }) : quoted(open[0]!.title),
        }),
      );
    summary = parts.join(" ");
  } else {
    summary = t("Nothing has landed in the vault this week yet. The review fills up with your entries, tasks and check-ins.");
  }

  const highlights = [...items]
    .filter((i) => HIGHLIGHT_TYPES.includes(i.type))
    .sort(
      (a, b) =>
        Number(b.type === "meeting") - Number(a.type === "meeting") ||
        b.updated.localeCompare(a.updated),
    )
    .slice(0, 4)
    .map((i) => ({ t: i.title, id: i.id }));

  // Balance: active areas, score now vs. a week ago.
  const parts = partition(src);
  const balance: [string, number, number][] = activeAreaKeys(src.areaLabels).map((k) => {
    const p = parts.get(k)!;
    return [p.def.name, areaScore(p, src, today) ?? 0, areaScore(p, src, addDays(today, -7)) ?? 0];
  });
  const moves = balance.map(([n, c, p]) => ({ n, d: c - p })).filter((m) => m.d !== 0);
  const down = moves.filter((m) => m.d < 0).sort((a, b) => a.d - b.d);
  const up = moves.filter((m) => m.d > 0).sort((a, b) => b.d - a.d);
  const balanceNote = ((): string => {
    if (!moves.length)
      return balance.every(([, c]) => c === 0)
        ? t("No data for a comparison yet. As soon as there are entries, goals or check-ins, you will see here which area gained or lost.")
        : t("All areas stand where they were last week. One deliberate appointment per area keeps the balance.");
    const lost = !down.length
      ? ""
      : down.length === 1
        ? t("{area} lost ground", { area: down[0]!.n })
        : t("{a} and {b} lost ground", { a: down[0]!.n, b: down[1]!.n });
    const grew = !up.length
      ? ""
      : up.length > 1
        ? t("{area} grew the most", { area: up[0]!.n })
        : t("{area} grew", { area: up[0]!.n });
    const note = lost && grew ? t("{down}, while {up}", { down: lost, up: grew }) : lost || grew;
    return down.length
      ? t("{note}. One appointment per weak area in the new week would restore the balance.", { note })
      : `${note}.`;
  })();

  const weakest = [...life.areas]
    .filter((a) => a.active && !a.empty)
    .sort((a, b) => a.score - b.score)[0];
  const lowDay = dailies.filter((d) => d.energy !== null).sort((a, b) => a.energy! - b.energy!)[0];
  const questions: [string, string][] = [
    [
      t("What gave you energy this week?"),
      highlights[0] ? t("Suggestion: “{title}”.", { title: highlights[0].t }) : t("Suggestion: a moment when something felt easy."),
    ],
    [
      t("Where did you lose time or focus?"),
      open.length
        ? tn(
            open.length,
            "Suggestion: one task was left undone, such as “{title}”.",
            "Suggestion: {n} tasks were left undone, such as “{title}”.",
            { title: open[0]!.title },
          )
        : lowDay
          ? t("Suggestion: {day} with energy {energy}/10.", { day: longDay(lowDay.date).split(",")[0] ?? "", energy: lowDay.energy ?? 0 })
          : t("Suggestion: context switching between meetings and Inbox."),
    ],
    [
      t("What will you deliberately do differently next week?"),
      weakest
        ? t("Suggestion: a fixed appointment for {area}.", { area: weakest.name })
        : t("Suggestion: a deep work block before the first appointment."),
    ],
  ];

  // Focus proposals: weakest open goals, then open tasks due soon / high priority.
  const goalAreas = new Map(src.goals.map((g) => [g.id, areaOf(g)]));
  const focus: ReviewFocus[] = [];
  for (const a of [...life.areas].filter((x) => x.active).sort((x, y) => x.score - y.score))
    for (const g of a.goals.filter((x) => x.pct < 100).slice(0, 1))
      focus.push({ t: g.t, area: areaDef(a.key)!.short, on: false });
  const itemArea = new Map([...src.items, ...src.goals].map((i) => [i.id, areaOf(i)]));
  for (const task of src.tasks
    .filter((x) => !x.done)
    .sort(
      (a, b) =>
        Number(b.priority === "high" || b.priority === "urgent") -
          Number(a.priority === "high" || a.priority === "urgent") ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999"),
    )) {
    if (focus.length >= 5) break;
    if (focus.some((f) => f.t === task.title)) continue;
    const k = task.sourceItemId
      ? (itemArea.get(task.sourceItemId) ?? goalAreas.get(task.sourceItemId) ?? null)
      : null;
    focus.push({ t: task.title, area: k ? areaDef(k)!.short : t("Task"), on: false, taskId: task.id });
  }
  focus.splice(5);
  focus.forEach((f, i) => (f.on = i < 3));

  const nextWeek = dayShort().map((d, i) => {
    const date = addDays(nextMonday, i);
    const due = src.tasks.filter((t) => !t.done && t.due === date).slice(0, 3);
    return {
      d,
      items: due.map((t) => ({
        t: t.title,
        cls: pillClass(t.sourceItemId ? (itemArea.get(t.sourceItemId) ?? null) : null),
      })),
    };
  });

  const file = `${WEEKLY_FOLDER}/${key}.md`;
  const series = reviewSeries(src.items, today, tz);
  return {
    review: {
      eyebrow: t("Ritual · {day} · about 12 minutes", { day: longDay(today) }),
      title: t("Weekly review week {week}", { week }),
      intro: t("Look back, assess honestly, set the next week deliberately. Kortex has prepared everything, you decide."),
      file,
      week: weekLabel(week),
      prevWeek: kw(addDays(monday, -7)),
      nextWeek: kw(nextMonday),
      summary,
      balanceNote,
      doneText:
        series > 0
          ? t("Review streak: {n} weeks in a row. Your focus items are now in Tasks.", { n: series + 1 })
          : t("First review saved. Your focus items are now in Tasks."),
      isoWeek: key,
    },
    stats: [
      { v: String(items.length), l: items.length === 1 ? t("new entry") : t("new entries") },
      {
        v: String(meetings.length),
        l: !meetings.length
          ? t("Meetings")
          : meetings.length === 1
            ? t("Meeting, {n} with minutes", { n: meetings.filter((m) => m.summary).length })
            : t("Meetings, {n} with minutes", { n: meetings.filter((m) => m.summary).length }),
      },
      { v: energyAvg === null ? "–" : deDecimal(energyAvg), l: t("Average energy") },
      // Habits are not tracked in Kortex (Griply): the fourth number is the tasks done this week.
      { v: String(doneTasks.length), l: t("Tasks done") },
    ],
    highlights,
    open: open.map((t) => ({ k: t.id, t: t.title, id: t.id })),
    balance,
    questions,
    focus,
    week: nextWeek,
    digests,
    saved: false,
  };
}
