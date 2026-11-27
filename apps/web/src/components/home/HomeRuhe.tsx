"use client";

import { intlLocale, t, tn } from "@/i18n";
import { EmptyPic } from "@/components/motion/EmptyPic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronRight, Sparkles } from "lucide-react";
import { setActionItemDone } from "@/lib/api/actions";
import type { HomeView } from "@/lib/data/home";
import type { HomeTarget } from "@/lib/mock/home";
import { useNotes } from "@/lib/notes/store";
import { overnightJobs } from "@/lib/agent-jobs";
import { useAgentJobs } from "@/lib/shell/agent-jobs-store";
import { useShell } from "@/lib/shell/store";
import { isLiveData, PROFILE, TASKS } from "@/lib/workspace-data";
import { startAgentJob } from "@/server/agent/actions";
import { BarButton, LocationBar } from "@/components/shell/Bars";
import { Ico } from "@/components/shell/icons";
import { MenuItem, MenuSep } from "@/components/ui/primitives";
import { rich } from "@/components/views/CollectionHead";
import { agentJobHref } from "./AgentNight";
import { DailyStack } from "./DailyStack";
import { pickEnergy, type DailyCheckin as Checkin } from "./daily";
import { dueToday } from "./due";
import { HOME_TOGGLES } from "./home-utils";
import { Img } from "./Img";
import { buildStack, loadStackState, presortPrompt } from "./stack";
import { typeIcon } from "./Thumb";

/*
 * Heute in the Ruhe look (mockup "heute", gap report web-a §2): location bar "Heute" with "Vorsortieren" and "…"
 * (which sections show), a calm greeting (date, 30/600 title, one sentence with bold counts), the daily stack with
 * "Als Nächstes", and a quiet right rail: done overnight, due today, energy 1-5, continue where you left off.
 * The landscape sits behind the top of the panel (ruhe-home.css). State and data come from HomeView.
 */

/** Sections the Ruhe page knows; the "…" menu switches them (same keys and storage as "Anpassen"). */
const RUHE_SECTIONS = ["t", "b", "d", "c", "j"];

const greetFor = (h: number) => (h >= 5 && h < 11 ? t("Good morning") : h >= 11 && h < 17 ? t("Good day") : t("Good evening"));
const hhmm = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * Energy as five steps. The check-in stores 1-10 (journal, older notes); a step n writes n * 2 and a stored value
 * reads as its rounded-up half, so nothing has to be migrated.
 */
export const energyStep = (v: number | null): number | null => (v ? Math.min(5, Math.max(1, Math.ceil(v / 2))) : null);

function Sec({ label, count, aside, children }: { label: string; count?: number; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rzh-sec" aria-label={label}>
      <h2 className="rzh-lab">
        {label}
        {count !== undefined && <span className="rz-c kx-num">{count}</span>}
        {aside && <span className="rzh-lab-aside">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

export function HomeRuhe({
  day,
  now,
  view,
  go,
  openNote,
  checkin,
  onCheckin,
  hidden,
  onToggleSection,
  briefing,
}: {
  day: string | null;
  now: Date | null;
  view: HomeView | null;
  go: (t: HomeTarget) => void;
  openNote: (id: string) => void;
  checkin: Checkin;
  onCheckin: (fn: (c: Checkin) => Checkin) => void;
  hidden: ReadonlySet<string>;
  onToggleSection: (k: string) => void;
  /** The Morning Briefing card (HomeView), shown under the greeting when unfolded. */
  briefing: ReactNode;
}) {
  const router = useRouter();
  const { showToast } = useShell();
  const { items } = useNotes();
  const { jobs } = useAgentJobs();
  const show = (k: string) => !hidden.has(k);
  const [briefOpen, setBriefOpen] = useState(false);
  const [sorting, setSorting] = useState(false);

  // Counts of the greeting sentence and the presort request: the same deck DailyStack shows.
  const openCards = useMemo(() => {
    if (!day) return [];
    const done = loadStackState(day);
    return buildStack({ items: Object.values(items), tasks: TASKS, view, day, titleOf: (id) => items[id]?.title }).filter((c) => !done[c.id]);
  }, [items, view, day]);
  const night = useMemo(() => (now ? overnightJobs(jobs, now) : []), [jobs, now]);
  const seen = new Set(night.map((j) => j.id));
  const waiting = jobs.filter((j) => j.status === "waiting" && !seen.has(j.id));
  const due = useMemo(() => (day ? dueToday(Object.values(items), TASKS, day) : null), [items, day]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const tick = (id: string) => {
    const next = !ticked[id];
    setTicked((d) => ({ ...d, [id]: next }));
    if (!isLiveData()) return;
    void setActionItemDone(id, next).then((r) => {
      if (r.ok) return;
      setTicked((d) => ({ ...d, [id]: !next }));
      showToast(t("Task not saved: {error}", { error: r.error }));
    });
  };
  const openTasks = due ? due.tasks.filter((x) => !ticked[x.id]).length : 0;

  const presort = async () => {
    if (!isLiveData()) return showToast(t("The agent needs an account (not available in mock mode)"));
    setSorting(true);
    const r = await startAgentJob({ prompt: presortPrompt(openCards), title: t("Presort the daily stack"), origin: "presort" });
    setSorting(false);
    if (!r.ok) return showToast(t("Not saved: {error}", { error: r.error }));
    showToast(t("The agent looks through your stack. The result waits under Agent."), { label: t("Open"), run: () => router.push(agentJobHref(r.data.id)) });
  };

  const sentence: ReactNode[] = [];
  if (night.length) sentence.push(rich(t("The agent finished {n} overnight."), { n: <b>{tn(night.length, "{n} thing", "{n} things")}</b> }));
  if (openCards.length) sentence.push(rich(t("Your daily stack holds {n}."), { n: <b>{tn(openCards.length, "{n} card", "{n} cards")}</b> }));
  if (openTasks) sentence.push(rich(t("Due today: {n}."), { n: <b>{tn(openTasks, "{n} task", "{n} tasks")}</b> }));
  if (!sentence.length && day) sentence.push(t("Nothing waits for you today."));

  const energy = energyStep(checkin.energy);
  const backIn = view?.backIn ?? null;

  return (
    <div className="rzh-page">
      <LocationBar
        className="rzh-loc"
        crumbs={[{ label: t("Today") }]}
        icon="home"
        actions={
          <BarButton icon={<Sparkles aria-hidden />} onClick={() => void presort()} disabled={sorting || openCards.length < 2}>
            {t("Presort")}
          </BarButton>
        }
        more={
          <>
            {HOME_TOGGLES.filter((s) => RUHE_SECTIONS.includes(s.key)).map((s) => (
              <MenuItem key={s.key} closeOnClick={false} onSelect={() => onToggleSection(s.key)}>
                <span className="rzh-menu-check" aria-hidden>
                  {show(s.key) && <Check className="kx-ico" />}
                </span>
                {s.label}
              </MenuItem>
            ))}
            <MenuSep />
            <MenuItem onSelect={() => router.push("/journal")}>{t("Open journal")}</MenuItem>
          </>
        }
        moreLabel={t("Customize")}
      />
      <div className="rzh-grid">
        <div className="rzh-main">
          <header className="rzh-greet">
            <div className="rzh-date">{now ? now.toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long" }) : " "}</div>
            <h1 className="rzh-title">
              {now ? greetFor(now.getHours()) : t("Hello")}, {PROFILE.name}
            </h1>
            <p className="rzh-sum">
              {sentence.map((s, i) => (
                <span key={i}>
                  {i > 0 && " "}
                  {s}
                </span>
              ))}
              {show("b") && briefing && (
                <>
                  {" "}
                  <button type="button" className="rzh-more" aria-expanded={briefOpen} onClick={() => setBriefOpen((o) => !o)}>
                    {t("Morning Briefing")}
                    <ChevronRight aria-hidden style={briefOpen ? { transform: "rotate(90deg)" } : undefined} />
                  </button>
                </>
              )}
            </p>
            {show("b") && briefOpen && <div className="rzh-brief">{briefing}</div>}
          </header>
          {show("t") && <DailyStack day={day} view={view} go={go} ruhe />}
        </div>

        <aside className="rzh-rail" aria-label={t("Overview")}>
          {(night.length > 0 || waiting.length > 0) && (
            <Sec label={t("Done overnight")}>
              {[...night, ...waiting.filter((j) => !night.includes(j))].slice(0, 5).map((j) => (
                <button key={j.id} type="button" className="rz-lrow rzh-row" onClick={() => router.push(agentJobHref(j.id))} title={j.status === "waiting" ? t("Waits for your OK") : t("Done")}>
                  {j.status === "waiting" ? <Sparkles aria-hidden className="rzh-acc" /> : <Check aria-hidden />}
                  <span className="rz-lrow-t rzh-t2">{j.title}</span>
                  <span className="rz-lrow-r kx-num">{j.status === "waiting" ? t("Waits for your OK") : hhmm(j.finishedAt)}</span>
                </button>
              ))}
            </Sec>
          )}

          {show("d") && (
            <Sec
              label={t("Due today")}
              count={due ? due.tasks.length + due.reminders.length : undefined}
              aside={
                <Link href="/tasks" className="rzh-icolink" aria-label={t("All tasks")} title={t("All tasks")}>
                  <ArrowUpRight aria-hidden />
                </Link>
              }
            >
              {due && due.tasks.length === 0 && due.reminders.length === 0 && <EmptyPic kind="stack" size="sm" title={t("Nothing is due today.")} />}
              {due?.tasks.slice(0, 5).map((task) => {
                const on = !!ticked[task.id];
                const late = !!day && task.due < day;
                return (
                  <div key={task.id} className={"rz-lrow rzh-row" + (on ? " is-done" : "")}>
                    <button type="button" role="checkbox" aria-checked={on} aria-label={t("Done: {title}", { title: task.title })} className={"rzh-chk" + (on ? " is-on" : "")} onClick={() => tick(task.id)}>
                      {on && <Check aria-hidden />}
                    </button>
                    <button type="button" className="rz-lrow-t rzh-tbtn" disabled={!task.sourceId} onClick={() => task.sourceId && openNote(task.sourceId)}>
                      {task.title}
                    </button>
                    {late && !on && <span className="rz-lrow-r rzh-crit">{t("overdue")}</span>}
                  </div>
                );
              })}
              {due?.reminders.slice(0, 3).map((i) => (
                <button key={i.id} type="button" className="rz-lrow rzh-row" onClick={() => openNote(i.id)}>
                  <Ico name="bell" size={14} />
                  <span className="rz-lrow-t">{i.title}</span>
                  <span className="rz-lrow-r">{t("Reminder")}</span>
                </button>
              ))}
            </Sec>
          )}

          {show("c") && (
            <Sec
              label={t("Energy today")}
              aside={
                <Link href="/journal/week" className="rzh-quiet">
                  {t("Week")} ›
                </Link>
              }
            >
              <div className="rzh-energy" role="radiogroup" aria-label={t("Energy today")}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={energy === n}
                    className={energy === n ? "is-on" : undefined}
                    disabled={!checkin.date}
                    onClick={() => onCheckin((c) => pickEnergy(c, n * 2))}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Sec>
          )}

          {show("j") && (
            <Sec label={t("Continue where you left off")}>
              {backIn && backIn.length === 0 && <EmptyPic kind="idea" size="sm">{t("Nothing started yet. What you read, listen to or edit shows up here again.")}</EmptyPic>}
              {!backIn && [0, 1, 2].map((i) => <span key={i} className="kx-skel rzh-skel" aria-hidden />)}
              {backIn?.slice(0, 4).map((c, i) => (
                <button key={`${c.title}-${i}`} type="button" className="rz-lrow rzh-row" title={c.meta} onClick={() => go(c.target)}>
                  <span className="rzh-thumb" aria-hidden>
                    {c.img ? <Img src={c.img} /> : <Ico name={typeIcon(c.type)} size={13} />}
                  </span>
                  <span className="rz-lrow-t">{c.title}</span>
                  <span className="rz-lrow-r">
                    {c.pct !== null ? (
                      <span className="rzh-bar" role="progressbar" aria-label={t("Progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.pct)}>
                        <i style={{ width: `${Math.min(100, Math.max(0, c.pct))}%` } as CSSProperties} />
                      </span>
                    ) : (
                      c.meta
                    )}
                  </span>
                </button>
              ))}
            </Sec>
          )}
        </aside>
      </div>
    </div>
  );
}
