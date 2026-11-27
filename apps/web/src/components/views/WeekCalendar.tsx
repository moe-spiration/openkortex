"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, SquareCheck } from "lucide-react";
import { HScroll } from "@kortex/ui";
import { monthName, weekdayShort } from "@/lib/date/words";
import { addDays, buildMonth, buildWeek, weekStart, type WeekEntryIn, type WeekPlanIn } from "@/lib/data/collections";
import { t, tn } from "@/i18n";
import { useLook } from "@/components/theme/look";

/*
 * Calendar card of the collections (Feinschliff Live, prototype `.cal`): head with range title, back / next, "Heute",
 * "KW 43 · 27 Einträge", Woche / Monat and the fold button. Week: seven columns with hairlines, today tinted, entries
 * as rows with a bullet in the type colour (selectable: the open entry carries the accent ring), tasks with a small
 * checkbox that really toggles (when `onToggleTask` is given), "+N weitere" expands the day in place. Month: exactly
 * as high as the week, one row per week with a dot per entry (round = item, square = task; done tasks filled), every
 * dot clickable (item opens, task toggles), "+N" jumps to that week. Collapsed automatically while the drawer is open.
 * The Tasks page reuses it with task entries only (`entries={[]}`, `unit="tasks"`).
 */

const KEY = "kortex.collections.week.v1";
const PER_DAY = 3;
const DOTS = 6;
/** Monday first: indices for `weekdayShort` (0 = Sunday). */
const DOW = [1, 2, 3, 4, 5, 6, 0];

export interface WeekCalendarProps {
  entries: readonly WeekEntryIn[];
  plans: readonly WeekPlanIn[];
  today: string;
  /** Drawer open: show only the head. */
  forceClosed?: boolean;
  onOpen: (id: string) => void;
  /** Click on a day number: jump to that day in the list below. */
  onPickDay?: (date: string) => void;
  /** Entry open in the drawer right now (its bullet carries the accent ring). */
  activeId?: string | null;
  /** Toggles a task; given, tasks show a working checkbox and done tasks stay visible (ticked). */
  onToggleTask?: (id: string, done: boolean) => void;
  /** What the counter counts: "entries" (default, items plus tasks) or "tasks". */
  unit?: "entries" | "tasks";
}

type Row = { kind: "entry"; e: WeekEntryIn } | { kind: "plan"; p: WeekPlanIn };

const countLabel = (n: number, unit: "entries" | "tasks") =>
  unit === "tasks" ? tn(n, "{n} task", "{n} tasks") : tn(n, "{n} entry", "{n} entries");

export function WeekCalendar({ entries, plans, today, forceClosed, onOpen, onPickDay, activeId, onToggleTask, unit = "entries" }: WeekCalendarProps) {
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState<"week" | "month">("week");
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Ruhe look: the month is a taller grid with a day panel on the right; a click on a day selects it.
  const ruhe = useLook() === "ruhe";
  const [sel, setSel] = useState(today);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === "closed") setOpen(false);
    } catch {
      /* storage blocked */
    }
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? "open" : "closed");
    } catch {
      /* storage blocked */
    }
  };
  const shown = open && !forceClosed;
  const withDone = !!onToggleTask;
  const week = useMemo(() => buildWeek(entries, plans, anchor, today, { withDone }), [entries, plans, anchor, today, withDone]);
  const month = useMemo(() => (mode === "month" ? buildMonth(entries, anchor, today, withDone ? plans : plans.filter((p) => !p.done)) : null), [mode, entries, plans, anchor, today, withDone]);
  const step = (dir: -1 | 1) => {
    if (mode === "week") setAnchor((a) => addDays(a, dir * 7));
    else
      setAnchor((a) => {
        const [y, m] = a.split("-").map(Number);
        const d = new Date(Date.UTC(y!, m! - 1 + dir, 1));
        return d.toISOString().slice(0, 10);
      });
  };
  const weekTotal = week.days.reduce((n, d) => n + d.entries.length + d.planned.length, 0);
  const monthTotal = month ? month.cells.filter((c) => c.inMonth).reduce((n, c) => n + c.entries.length + c.planned.length, 0) : 0;
  const isNow = mode === "week" ? weekStart(anchor) === weekStart(today) : anchor.slice(0, 7) === today.slice(0, 7);
  const toWeek = (date: string) => {
    setAnchor(date);
    setMode("week");
  };
  const flip = (date: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(date)) n.delete(date);
      else n.add(date);
      return n;
    });

  const task = (p: WeekPlanIn) => (
    <span key={p.id} className={"kc-we-task" + (p.done ? " is-done" : "")}>
      <button
        type="button"
        role="checkbox"
        className="kc-we-box"
        aria-checked={!!p.done}
        aria-label={t("Done: {title}", { title: p.title })}
        disabled={!onToggleTask}
        onClick={() => onToggleTask?.(p.id, !p.done)}
      >
        {p.done && <Check aria-hidden />}
      </button>
      <button type="button" className="kc-we-t" title={t("Task: {title}", { title: p.title })} disabled={!p.sourceId} onClick={() => p.sourceId && onOpen(p.sourceId)}>
        {p.title}
      </button>
    </span>
  );

  return (
    <section className={"kc-week" + (shown ? "" : " is-closed")} aria-label={t("Week view")} data-week-calendar data-mode={mode}>
      <div className="kc-week-h">
        <h2 className="kc-h2">{mode === "week" ? week.title : month?.title}</h2>
        <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={mode === "week" ? t("Previous week") : t("Previous month")} onClick={() => step(-1)}>
          <ChevronLeft className="kx-ico" aria-hidden />
        </button>
        <button type="button" className="tc-ibtn tc-ibtn--sm" aria-label={mode === "week" ? t("Next week") : t("Next month")} onClick={() => step(1)}>
          <ChevronRight className="kx-ico" aria-hidden />
        </button>
        <button type="button" className={"kc-cal-today" + (isNow ? " is-on" : "")} onClick={() => setAnchor(today)}>
          {t("Today")}
        </button>
        <span className="kc-meta kc-num">{mode === "week" ? t("Week {week} · {count}", { week: week.kw, count: countLabel(weekTotal, unit) }) : t("{count} in the month", { count: countLabel(monthTotal, unit) })}</span>
        <span className="kc-grow" />
        <div className="kc-viewseg kc-seg-sm" role="tablist" aria-label={t("Calendar view")}>
          {(
            [
              ["week", t("Week")],
              ["month", t("Month")],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={mode === v} onClick={() => setMode(v)}>
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tc-ibtn tc-ibtn--sm"
          aria-label={shown ? t("Collapse calendar") : t("Expand calendar")}
          title={shown ? t("Collapse calendar") : t("Expand calendar")}
          aria-expanded={shown}
          disabled={forceClosed}
          onClick={toggle}
        >
          {shown ? <ChevronUp className="kx-ico" aria-hidden /> : <ChevronDown className="kx-ico" aria-hidden />}
        </button>
      </div>

      {shown && mode === "week" && (
        <HScroll>
          <div className="kc-week-g">
            {week.days.map((d) => {
              const rows: Row[] = [...d.entries.map((e) => ({ kind: "entry" as const, e })), ...d.planned.map((p) => ({ kind: "plan" as const, p }))];
              const exp = expanded.has(d.date);
              const more = rows.length - PER_DAY;
              const cls = ["kc-wd", d.today && "is-today", !d.today && d.date < today && "is-past", exp && "is-exp"].filter(Boolean).join(" ");
              return (
                <div key={d.date} className={cls} aria-current={d.today ? "date" : undefined}>
                  <div className="kc-wd-h">
                    <span className="kc-wd-dow">{d.dow}</span>
                    <button type="button" className="kc-wd-n" aria-label={t("{day} · jump to the day", { day: d.day })} onClick={() => onPickDay?.(d.date)}>
                      {d.day}
                    </button>
                    {rows.length > 0 && <span className="kc-count">{rows.length}</span>}
                  </div>
                  <div className="kc-wd-l">
                    {(exp ? rows : rows.slice(0, PER_DAY)).map((r) =>
                      r.kind === "entry" ? (
                        <button
                          key={r.e.id}
                          type="button"
                          className={"kc-we" + (activeId === r.e.id ? " is-on" : "")}
                          aria-current={activeId === r.e.id || undefined}
                          title={`${r.e.time} · ${r.e.title}`}
                          onClick={() => onOpen(r.e.id)}
                        >
                          <i aria-hidden style={r.e.color ? { background: r.e.color } : undefined} />
                          <span className="kc-clamp1">{r.e.title}</span>
                        </button>
                      ) : (
                        task(r.p)
                      ),
                    )}
                    {more > 0 && (
                      <button type="button" className="kc-we-more" aria-expanded={exp} onClick={() => flip(d.date)}>
                        {exp ? t("Less") : t("+{n} more", { n: more })}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </HScroll>
      )}

      {shown && mode === "month" && month && ruhe && (
        <RuheMonth month={month} sel={sel} onSel={setSel} activeId={activeId} onOpen={onOpen} task={task} unit={unit} />
      )}

      {shown && mode === "month" && month && !ruhe && (
        <div className="kc-month" aria-label={month.title}>
          {DOW.map((d) => (
            <span key={d} className="kc-month-dow">
              {weekdayShort(d)}
            </span>
          ))}
          {month.cells.map((c) => {
            const dots: Row[] = [...c.entries.map((e) => ({ kind: "entry" as const, e })), ...c.planned.map((p) => ({ kind: "plan" as const, p }))];
            const total = dots.length;
            return (
              <div key={c.date} className={"kc-mc" + (c.inMonth ? "" : " is-out") + (c.today ? " is-today" : "")} aria-current={c.today ? "date" : undefined}>
                <button type="button" className="kc-mc-n" aria-label={t("{day} · {count} · show week", { day: c.day, count: countLabel(total, unit) })} onClick={() => toWeek(c.date)}>
                  {c.day}
                </button>
                <span className="kc-mdots">
                  {dots.slice(0, DOTS).map((r) =>
                    r.kind === "entry" ? (
                      <button
                        key={r.e.id}
                        type="button"
                        className={"kc-mdot" + (activeId === r.e.id ? " is-on" : "")}
                        style={r.e.color ? { background: r.e.color } : undefined}
                        title={r.e.title}
                        aria-label={r.e.title}
                        onClick={() => onOpen(r.e.id)}
                      />
                    ) : (
                      <button
                        key={r.p.id}
                        type="button"
                        className={"kc-mdot is-task" + (r.p.done ? " is-done" : "")}
                        title={onToggleTask ? t("Task: {title} (click ticks it off)", { title: r.p.title }) : t("Task: {title}", { title: r.p.title })}
                        aria-label={t("Task {title}", { title: r.p.title })}
                        aria-pressed={onToggleTask ? !!r.p.done : undefined}
                        onClick={() => (onToggleTask ? onToggleTask(r.p.id, !r.p.done) : r.p.sourceId && onOpen(r.p.sourceId))}
                      />
                    ),
                  )}
                  {total > DOTS && (
                    <button type="button" className="kc-mmore" onClick={() => toWeek(c.date)}>
                      +{total - DOTS}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type MonthData = NonNullable<ReturnType<typeof buildMonth<WeekEntryIn>>>;

/** "Thu, Nov 19" for the head of the day panel. */
const dayTitle = (date: string) => {
  const d = new Date(date + "T12:00:00Z");
  return t("{weekday}, {month} {day}", { weekday: weekdayShort(d.getUTCDay()), month: monthName(d.getUTCMonth()), day: d.getUTCDate() });
};

/**
 * Month of the Ruhe look (mockup round 3, screen 22): seven columns of day cells (number, coloured dots, task count,
 * first title on the selected day and today) and the day panel with every entry and task of the selected day.
 */
function RuheMonth({
  month,
  sel,
  onSel,
  activeId,
  onOpen,
  task,
  unit,
}: {
  month: MonthData;
  sel: string;
  onSel: (date: string) => void;
  activeId?: string | null;
  onOpen: (id: string) => void;
  task: (p: WeekPlanIn) => React.ReactNode;
  unit: "entries" | "tasks";
}) {
  const day = month.cells.find((c) => c.date === sel) ?? month.cells.find((c) => c.today) ?? month.cells.find((c) => c.inMonth)!;
  const open = day.planned.filter((p) => !p.done).length;
  return (
    <div className="kc-monthsplit">
      <div className="kc-rmonth" aria-label={month.title}>
        {DOW.map((d) => (
          <span key={d} className="kc-rmonth-dow">
            {weekdayShort(d)}
          </span>
        ))}
        {month.cells.map((c) => {
          const isSel = c.date === day.date;
          const tasks = c.planned.length;
          const cls = ["kc-rmd", !c.inMonth && "is-out", c.today && "is-today", isSel && "is-sel"].filter(Boolean).join(" ");
          return (
            <div key={c.date} className={cls} aria-current={c.today ? "date" : undefined} onClick={() => onSel(c.date)}>
              <button
                type="button"
                className="kc-rmd-n"
                aria-pressed={isSel}
                aria-label={t("{day} · {count}", { day: c.day, count: countLabel(c.entries.length + tasks, unit) })}
                onClick={(e) => {
                  e.stopPropagation();
                  onSel(c.date);
                }}
              >
                {c.day}
              </button>
              {(c.entries.length > 0 || tasks > 0) && (
                <span className="kc-rmd-dots" aria-hidden>
                  {c.entries.slice(0, 4).map((e) => (
                    <i key={e.id} style={e.color ? { background: e.color } : undefined} />
                  ))}
                  {tasks > 0 && (
                    <span className="kc-rmd-tk">
                      <SquareCheck />
                      {tasks}
                    </span>
                  )}
                </span>
              )}
              {(isSel || c.today) && c.entries[0] && <span className="kc-rmd-line">{c.entries[0].title}</span>}
            </div>
          );
        })}
      </div>
      <aside className="kc-dayside" aria-label={dayTitle(day.date)}>
        <div className="kc-dayside-h">
          <b>{dayTitle(day.date)}</b>
          <span className="kc-num">
            {[countLabel(day.entries.length, "entries"), open > 0 && tn(open, "{n} task", "{n} tasks")].filter(Boolean).join(" · ")}
          </span>
        </div>
        {day.entries.length === 0 && day.planned.length === 0 && <span className="kc-dayside-empty">{t("Nothing on this day")}</span>}
        {day.entries.map((e) => (
          <button
            key={e.id}
            type="button"
            className={"kc-dayside-row" + (activeId === e.id ? " is-on" : "")}
            aria-current={activeId === e.id || undefined}
            onClick={() => onOpen(e.id)}
          >
            <span className="kc-clamp1">{e.title}</span>
            <i aria-hidden style={e.color ? { background: e.color } : undefined} />
            <span className="kc-num">{e.time}</span>
          </button>
        ))}
        {day.planned.map((p) => (
          <div key={p.id} className="kc-dayside-task">
            {task(p)}
          </div>
        ))}
      </aside>
    </div>
  );
}
