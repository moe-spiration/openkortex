"use client";

import { t, tn } from "@/i18n";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchCheckin, type DailyCheckin } from "@/components/home/daily";
import { energyNotes } from "@/components/home/overview";
import { WeeklyReview } from "@/components/review/WeeklyReview";
import { useReviewData } from "@/components/review/useReviewData";
import { Ico } from "@/components/shell/icons";
import { averageLabel, entryWhen, isoWeekNumber, mondayOf, topHashtags, weekRangeLabel } from "@/lib/daily/journal";
import { weekDays } from "@/lib/daily/week";
import { MOCK_ENTRY_DATES } from "@/lib/mock/journal";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { JOURNAL_DAY_HREF } from "@/lib/shell/nav";
import { parseCommand } from "@/lib/shell/orbit";
import { spaceHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { DAILY_NOTES, MOCK_TODAY, NOTES, TASKS, isLiveData, noteById } from "@/lib/workspace-data";
import { JournalTabs } from "./JournalTabs";
import { WeekSignals } from "./WeekSignals";
import { dailyText } from "./dailyText";

/*
 * Tagebuch, tab Woche (Feinschliff Live): "KW nn · range · x von 7 Tagen geschrieben", seven day cards (weekday, date,
 * energy bar, the day's text, meta) and the "Wochenrückblick". The Rückblick text is the review's summary: the
 * headlines of this week's Weekly Digests (AI, 90_Digests) when there are any, else a sentence from the week's
 * numbers; next to it the computed facts (energy average, open tasks, top hashtags). Then the week's signals
 * (WeekSignals: topics on the rise, open loops, new connections, recommendations, learn and review) and the guided
 * weekly review.
 */

export function JournalWeek() {
  const { openNote, showToast } = useShell();
  const chat = useCopilotChat();
  const live = isLiveData();
  const today = MOCK_TODAY;
  const review = useReviewData();
  const [todayCheckin, setTodayCheckin] = useState<DailyCheckin | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchCheckin(today, ac.signal)
      .then(setTodayCheckin)
      .catch(() => {});
    return () => ac.abort();
  }, [today]);

  const energyByDate = new Map(energyNotes(today).map((n) => [n.date, n.energy]));
  const todayText = todayCheckin?.mindDump.join(" ") ?? "";
  const days = weekDays(today, DAILY_NOTES, live ? [] : MOCK_ENTRY_DATES).map((d) => {
    const note = d.noteId ? noteById(d.noteId) : undefined;
    const written = d.noteId ? dailyText(d.noteId) : "";
    const energy = d.isToday ? (todayCheckin?.energy ?? null) : (energyByDate.get(d.date) ?? null);
    const text = d.isToday
      ? todayText || written || t("Nothing written yet. A click opens the day.")
      : written || note?.tldr || (d.done ? t("Entry without text") : "");
    const meta = d.isToday ? t("Today") : d.isFuture ? t("still to come") : note ? entryWhen(d.date, note.time, today) : d.done ? t("Entry") : t("no entry");
    const done = d.isToday ? d.done || !!todayText : d.done;
    return { ...d, note, energy, text, meta, done };
  });
  const written = days.filter((d) => d.done).length;
  const monday = mondayOf(today);
  const sunday = days[6]!.date;

  // Computed facts of the week.
  const avgEnergy = averageLabel(days.map((d) => d.energy));
  const tags = topHashtags(NOTES.filter((n) => n.date >= monday && n.date <= sunday));
  const openTasks = TASKS.filter((t) => !t.done).length;
  const weekNotes = NOTES.filter((n) => n.date >= monday && n.date <= sunday);
  const stats: [number, string][] = [
    [weekNotes.length, t("new entries")],
    [weekNotes.filter((n) => n.type === "meeting").length, t("meetings")],
    [written, t("journal days")],
    [openTasks, t("tasks open")],
  ];
  const draft = () => {
    if (!chat.live) {
      showToast(t("The agent needs an account (not available in mock mode)"));
      return;
    }
    chat.send(parseCommand("/week")?.command.cmd ?? "/week", { skill: "week" });
  };
  const facts = [
    avgEnergy ? t("Average energy {n} of 10", { n: avgEnergy }) : t("No energy recorded yet"),
    t("written on {n} of 7 days", { n: written }),
  ].join(", ") + ".";

  const R = review.status === "ready" ? review.data.review : null;
  const fromDigest = review.status === "ready" && review.data.digests.some((d) => d.week.startsWith(`${review.data.review.week}/`) && d.headline);
  const summary = R?.summary ?? facts;

  return (
    <div className="jr">
      <JournalTabs tab="week" />
      <div className="jr-meta">
        {t("CW {week} · {range} · written on {n} of 7 days", { week: isoWeekNumber(today), range: weekRangeLabel(monday), n: written })}
      </div>

      <section aria-label={t("Your week in days")}>
        <ol className="jr-wk">
          {days.map((d) => {
            const cls = "jr-wd" + (d.isToday ? " is-today" : "") + (!d.done && !d.isToday ? " is-empty" : "");
            const body = (
              <>
                <span className="jr-wd-h">
                  <span className="jr-lbl">{d.short}</span>
                  <span className="jr-num" style={{ fontWeight: 500 }}>
                    {d.day}
                  </span>
                </span>
                <span className="jr-bar" role="img" aria-label={d.energy != null ? t("Energy {n} of 10", { n: d.energy }) : t("No energy recorded")}>
                  <i style={{ width: `${(d.energy ?? 0) * 10}%` }} />
                </span>
                <p>{d.text}</p>
                <span className="jr-meta" style={{ marginTop: "auto" }}>
                  {d.meta}
                </span>
              </>
            );
            return (
              <li key={d.date} style={{ minWidth: 0, display: "grid" }}>
                {d.isToday ? (
                  <Link href={JOURNAL_DAY_HREF} className={cls} aria-label={t("{weekday} {day}: write in the journal today", { weekday: d.short, day: d.day })}>
                    {body}
                  </Link>
                ) : d.noteId ? (
                  <button type="button" className={cls} aria-label={t("{weekday} {day}: open daily note", { weekday: d.short, day: d.day })} onClick={() => openNote(d.noteId!)}>
                    {body}
                  </button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="jr-ai" aria-label={t("Weekly review")}>
        <div className="jr-ai-h">
          <Ico name={fromDigest ? "sparkles" : "calendar"} />
          {t("Weekly review")}
          <span className="jr-meta" style={{ marginLeft: "auto", fontWeight: 400 }}>
            {review.status === "loading" ? t("Loading…") : fromDigest ? t("from your weekly digests") : t("calculated from your entries")}
          </span>
        </div>
        <dl className="jr-ai-stats">
          {stats.map(([n, label]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
        <p className="jr-ai-t">{summary}</p>
        {R && summary !== facts && <p className="jr-ai-f">{facts}</p>}
        <div className="jr-ai-chips">
          {tags.map((t) => (
            <Link key={t} href={spaceHref("all", t)} className="jr-chip">
              {t.startsWith("#") ? t : `#${t}`}
            </Link>
          ))}
          <Link href="/tasks" className="jr-chip">
            {tn(openTasks, "{n} task open", "{n} tasks open")}
          </Link>
          <button type="button" className="jr-chip jr-chip--acc" onClick={draft}>
            <Ico name="sparkles" />
            {t("Let the agent write it")}
          </button>
          <a href="#wochen-review" className="jr-chip">
            <Ico name="arrow-right" />
            {t("Start weekly review")}
          </a>
        </div>
      </section>

      <WeekSignals today={today} monday={monday} />

      <WeeklyReview review={review} />
    </div>
  );
}
