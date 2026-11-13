"use client";

import { intlLocale, t, tn } from "@/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { useInsightsData } from "@/components/insights/useInsightsData";
import { Ico, type IconId } from "@/components/shell/icons";
import { comingBack, newConnections, openLoops, risingTags } from "@/lib/daily/week-signals";
import type { Recommendation } from "@/lib/mock/insights";
import { useNotes } from "@/lib/notes/store";
import { useCopilotChat } from "@/lib/shell/copilot-chat";
import { parseCommand } from "@/lib/shell/orbit";
import { lifeHref, spaceHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { NOTES, TASKS } from "@/lib/workspace-data";

const shortDay = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function Panel({ icon, title, more, empty, children }: { icon: IconId; title: string; more?: ReactNode; empty: string | null; children: ReactNode }) {
  return (
    <section className="jr-sig" aria-label={title}>
      <div className="jr-sig-h">
        <Ico name={icon} />
        <h2>{title}</h2>
        {more}
      </div>
      {empty ? <p className="jr-meta">{empty}</p> : children}
    </section>
  );
}

/**
 * The week's signals under the seven days (journal, tab Woche): topics on the rise, open loops, new connections,
 * the top recommendations, and what comes back to learn or review. It gathers what Insights, Flashcards and
 * Reminders show on their own pages; those stay one click away. "Agent entwirft" hands the weekly review to the
 * agent (skill week), which proposes the note and tasks for confirmation.
 */
export function WeekSignals({ today, monday }: { today: string; monday: string }) {
  const router = useRouter();
  const { openNote, showToast } = useShell();
  const { items } = useNotes();
  const chat = useCopilotChat();
  const insights = useInsightsData();
  const sunday = useMemo(() => {
    const d = new Date(`${monday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  }, [monday]);

  const rising = useMemo(() => risingTags(NOTES, monday), [monday]);
  const loops = useMemo(() => openLoops(TASKS, today, sunday), [today, sunday]);
  const links = useMemo(() => newConnections(NOTES, monday), [monday]);
  const back = useMemo(() => comingBack(Object.values(items), monday), [items, monday]);
  const recs: Recommendation[] =
    insights.status === "ready"
      ? insights.data.top
          .map((k) => insights.data.recommendations.find((r) => r.k === k))
          .filter((r): r is Recommendation => !!r)
          .slice(0, 3)
      : [];

  const actRec = (r: Recommendation) => {
    if (r.fn?.kind === "note") openNote(r.fn.id);
    else if (r.fn?.kind === "life") router.push(lifeHref(r.fn.key));
    else if (r.fn?.kind === "graph") router.push("/graph");
    else router.push("/insights");
  };
  const draft = () => {
    if (!chat.live) {
      showToast(t("The agent needs an account (not available in mock mode)"));
      return;
    }
    chat.send(parseCommand("/week")?.command.cmd ?? "/week", { skill: "week" });
  };

  return (
    <div className="jr-sigs">
      <Panel icon="flame" title={t("Topics on the rise")} empty={rising.length ? null : t("No topic stood out this week.")}>
        <ul className="jr-sig-l">
          {rising.map((r) => (
            <li key={r.tag}>
              <Link href={spaceHref("all", r.tag)} className="jr-sig-row">
                <span className="kx-truncate">{r.tag}</span>
                <span className="jr-sig-bar" aria-hidden>
                  <i style={{ width: `${Math.min(100, r.now * 20)}%` }} />
                </span>
                <span className="jr-meta jr-num">{r.before ? t("{now} entries, {before} the week before", { now: r.now, before: r.before }) : tn(r.now, "{n} entry, new", "{n} entries, new")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        icon="orbit-todo"
        title={t("Open loops")}
        more={
          <Link href="/tasks" className="jr-sig-more">
            {t("All tasks")}
          </Link>
        }
        empty={loops.length ? null : t("Nothing open that is due this week.")}
      >
        <ul className="jr-sig-l">
          {loops.map((l) => (
            <li key={l.id}>
              <button type="button" className="jr-sig-row" disabled={!l.sourceId} onClick={() => l.sourceId && openNote(l.sourceId)}>
                <span className="kx-truncate">{l.title}</span>
                <span className={"jr-meta jr-num" + (l.overdue ? " jr-sig-late" : "")}>{l.overdue ? t("overdue since {date}", { date: shortDay(l.due) }) : shortDay(l.due)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        icon="link"
        title={t("New connections")}
        more={
          <Link href="/graph" className="jr-sig-more">
            Graph
          </Link>
        }
        empty={links.length ? null : t("No new links between entries this week.")}
      >
        <ul className="jr-sig-l">
          {links.map((c) => (
            <li key={`${c.fromId}|${c.toId}`} className="jr-sig-pair">
              <button type="button" className="jr-sig-node kx-truncate" onClick={() => openNote(c.fromId)}>
                {c.from}
              </button>
              <Ico name="arrow-right" />
              <button type="button" className="jr-sig-node kx-truncate" onClick={() => openNote(c.toId)}>
                {c.to}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        icon="sparkles"
        title={t("Recommendations")}
        more={
          <Link href="/insights" className="jr-sig-more">
            Insights
          </Link>
        }
        empty={recs.length ? null : insights.status === "loading" ? t("Loading…") : t("No recommendations yet.")}
      >
        <ul className="jr-sig-l">
          {recs.map((r) => (
            <li key={r.k}>
              <button type="button" className="jr-sig-row jr-sig-rec" onClick={() => actRec(r)}>
                <span className="jr-sig-rec-t">{r.title}</span>
                <span className="jr-meta">{r.why}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel icon="cards" title={t("Learn and review")} empty={null}>
        {back.length > 0 && (
          <ul className="jr-sig-l">
            {back.slice(0, 4).map((i) => (
              <li key={i.id}>
                <button type="button" className="jr-sig-row" onClick={() => openNote(i.id)}>
                  <span className="kx-truncate">{i.title}</span>
                  <span className="jr-meta jr-num">{shortDay(i.remindAt!)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="jr-ai-chips">
          <Link href="/flashcards" className="jr-chip">
            <Ico name="cards" />
            {t("Flashcards")}
          </Link>
          <Link href="/reminders" className="jr-chip">
            <Ico name="bell" />
            {tn(back.length, "{n} reminder this week", "{n} reminders this week")}
          </Link>
        </div>
      </Panel>

      <Panel icon="orbit-sparkles" title={t("Reflection")} empty={null}>
        <p className="jr-meta" style={{ margin: 0 }}>
          {t("The agent reads this week's notes, names themes and open loops and proposes the review note and tasks. Nothing is saved before you confirm.")}
        </p>
        <div className="jr-ai-chips">
          <button type="button" className="jr-chip jr-chip--acc" onClick={draft}>
            <Ico name="orbit-sparkles" />
            {t("Let the agent draft it")}
          </button>
          <a href="#wochen-review" className="jr-chip">
            {t("Write it myself")}
          </a>
        </div>
      </Panel>
    </div>
  );
}
