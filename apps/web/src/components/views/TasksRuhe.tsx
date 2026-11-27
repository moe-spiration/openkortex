"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  Calendar,
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  Columns3,
  Flame,
  Link2,
  List,
  ListFilter,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SquareCheckBig,
  Sun,
  Target,
  X,
} from "lucide-react";
import type { Stage, RuheColumn } from "@/lib/tasks-board";
import type { ActionItem } from "@/lib/mock/views";
import { feature, t, tx } from "@/i18n";
import { RuhePop } from "./RuhePop";
import { KbdHints, LocationBar, ViewBar } from "@/components/shell/Bars";
import { LazyItems } from "./useIncremental";
import { EmptyPic } from "@/components/motion/EmptyPic";

/*
 * Aufgaben in the Ruhe look (2026-11-27, mockup screen "aufgaben"): location bar "Aufgaben", a view bar with
 * Board / Liste / Woche on the left and Filter / Anzeige on the right, and the board with four columns Offen / Heute /
 * In Arbeit / Erledigt (lib/tasks-board.ts ruheColumnOf). Compact cards: title on one line, a meta line with due day,
 * source and the stage mark ("Vorschlag", "Griply", "Agent"); the moves of a stage appear on hover. TasksView keeps the
 * state, the server calls and the filters; this file is markup. Styles: packages/ui/src/styles/ruhe-tasks.css.
 */

export type TasksRuheView = "board" | "list" | "week";

export interface TasksRuheColumn {
  key: string;
  label: string;
  items: ActionItem[];
  /** Ruhe column (drop target); missing for the read-only groupings by source or project. */
  col?: RuheColumn;
}

export interface TasksRuheProps {
  view: TasksRuheView;
  onView: (v: TasksRuheView) => void;
  columns: TasksRuheColumn[];
  /** Columns are a read-only grouping (Anzeige > Gruppieren nach Quelle / Projekt). */
  grouped: boolean;
  meta: string;
  isDone: (id: string) => boolean;
  stage: (task: ActionItem) => Stage;
  source: (task: ActionItem) => string | null;
  due: (task: ActionItem) => string | null;
  overdue: (task: ActionItem) => boolean;
  selected: ReadonlySet<string>;
  rowProps: (id: string) => Record<string, unknown>;
  onToggle: (id: string) => void;
  onOpen: (task: ActionItem) => void;
  onMove: (id: string, col: RuheColumn) => void;
  onStage: (id: string, to: Stage) => void;
  onAgent: (task: ActionItem) => void;
  onGriply: (task: ActionItem) => void;
  onDismiss: (id: string) => void;
  onCreate: (title: string, col: RuheColumn) => void;
  filters: ReactNode;
  filterCount: number;
  display: ReactNode;
  menu: ReactNode;
  week: ReactNode;
  detail: (task: ActionItem) => ReactNode;
  detailId: string | null;
  onDetail: (id: string | null) => void;
  selectionBar: ReactNode;
  notice?: ReactNode;
}

const COL_GLYPH: Record<RuheColumn, ReactNode> = {
  open: <Circle aria-hidden size={13} strokeWidth={1.75} />,
  today: <Sun aria-hidden size={13} strokeWidth={1.75} className="rz-tk-sun" />,
  doing: (
    <svg aria-hidden width={13} height={13} viewBox="0 0 16 16" className="rz-tk-ring">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.6" />
      <path d="M8 2 A6 6 0 0 1 8 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  done: <CircleCheck aria-hidden size={13} strokeWidth={1.75} />,
};

const VIEWS: { id: TasksRuheView; icon: ReactElement; label: () => string }[] = [
  { id: "board", icon: <Columns3 aria-hidden size={13} strokeWidth={1.75} />, label: () => t("Board") },
  { id: "list", icon: <List aria-hidden size={13} strokeWidth={1.75} />, label: () => t("List") },
  { id: "week", icon: <CalendarDays aria-hidden size={13} strokeWidth={1.75} />, label: () => t("Week") },
];

export function TasksRuhe(p: TasksRuheProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [adding, setAdding] = useState<RuheColumn | null>(null);
  const [draft, setDraft] = useState("");
  const body = useRef<HTMLDivElement>(null);

  // J / K walk the cards (or rows) in reading order, Enter opens the source, X ticks the task off.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || !body.current) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const key = e.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const all = [...body.current.querySelectorAll<HTMLElement>("[data-task-id]")];
      if (!all.length) return;
      e.preventDefault();
      const at = all.findIndex((x) => x === document.activeElement);
      const next = at < 0 ? 0 : Math.max(0, Math.min(all.length - 1, at + (key === "j" ? 1 : -1)));
      all[next]!.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const byId = (id: string) => p.columns.flatMap((c) => c.items).find((x) => x.id === id);
  const cardKeys = (task: ActionItem) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      p.onOpen(task);
    } else if (e.key.toLowerCase() === "x" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      p.onToggle(task.id);
    }
  };

  const submit = (col: RuheColumn) => {
    const title = draft.trim();
    if (title) p.onCreate(title, col);
    setDraft("");
    if (!title) setAdding(null);
  };

  const mark = (task: ActionItem, stage: Stage): ReactNode => {
    if (stage === "suggested")
      return (
        <span className="rz-kc-mark is-acc">
          <Sparkles aria-hidden size={12} strokeWidth={1.75} />
          {t("Suggestion")}
        </span>
      );
    if (stage === "external")
      return (
        <span className="rz-kc-mark" title={task.exportedAt ? t("handed over on {date}", { date: task.exportedAt.slice(0, 10) }) : undefined}>
          <Target aria-hidden size={12} strokeWidth={1.75} />
          {feature("griply") ? "Griply" : t("Handed over")}
        </span>
      );
    if (stage === "agent")
      return (
        <span className="rz-kc-mark">
          <Sparkles aria-hidden size={12} strokeWidth={1.75} />
          {t("Agent")}
        </span>
      );
    return null;
  };

  const ib = (label: string, icon: ReactNode, run: () => void) => (
    <button type="button" className="rz-icon rz-kc-ib" title={label} aria-label={label} onClick={run}>
      {icon}
    </button>
  );

  const acts = (task: ActionItem, stage: Stage): ReactNode => {
    const griply = feature("griply") ? ib(t("Hand to Griply"), <Target size={13} strokeWidth={1.75} />, () => p.onGriply(task)) : null;
    const agent = ib(t("Hand to the agent"), <Sparkles size={13} strokeWidth={1.75} />, () => p.onAgent(task));
    if (stage === "suggested")
      return (
        <>
          <button type="button" className="rz-btn rz-kc-take" onClick={() => p.onStage(task.id, "accepted")}>
            {t("Take over")}
          </button>
          {ib(t("Dismiss"), <X size={13} strokeWidth={1.75} />, () => p.onDismiss(task.id))}
        </>
      );
    if (stage === "accepted")
      return (
        <>
          {ib(t("Done"), <Check size={13} strokeWidth={1.75} />, () => p.onStage(task.id, "done"))}
          {griply}
          {agent}
        </>
      );
    if (stage === "external") return ib(t("Take back"), <ArrowLeft size={13} strokeWidth={1.75} />, () => p.onStage(task.id, "accepted"));
    if (stage === "agent")
      return (
        <>
          <Link href="/agent" className="rz-icon rz-kc-ib" title={t("Result")} aria-label={t("Result")}>
            <Sparkles size={13} strokeWidth={1.75} />
          </Link>
          {ib(t("Done"), <Check size={13} strokeWidth={1.75} />, () => p.onStage(task.id, "done"))}
          {ib(t("Take back"), <ArrowLeft size={13} strokeWidth={1.75} />, () => p.onStage(task.id, "accepted"))}
        </>
      );
    return ib(t("Reopen"), <RotateCcw size={13} strokeWidth={1.75} />, () => p.onStage(task.id, "accepted"));
  };

  const card = (task: ActionItem) => {
    const stage = p.stage(task);
    const done = stage === "done";
    const late = p.overdue(task);
    const due = p.due(task);
    const src = p.source(task);
    return (
      <div
        key={task.id}
        className={"rz-kc" + (done ? " is-done" : "") + (dragId === task.id ? " is-drag" : "") + (p.selected.has(task.id) ? " is-sel" : "")}
        tabIndex={0}
        draggable={!p.grouped}
        data-task-id={task.id}
        data-stage={stage}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", task.id);
          setDragId(task.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropCol(null);
        }}
        onKeyDown={cardKeys(task)}
        {...p.rowProps(task.id)}
      >
        <button type="button" className="rz-kc-t" onClick={() => p.onOpen(task)} title={task.title} tabIndex={-1}>
          {task.title}
        </button>
        {!done && (
          <span className="rz-kc-m">
            {late && <Flame aria-hidden size={12} strokeWidth={1.75} className="rz-kc-late" />}
            {due && (
              <span className={late ? "rz-kc-late" : undefined}>
                <Calendar aria-hidden size={12} strokeWidth={1.75} />
                {due}
              </span>
            )}
            {src && (
              <span className="rz-kc-src">
                <Link2 aria-hidden size={12} strokeWidth={1.75} />
                <span className="rz-kc-ell">{src}</span>
              </span>
            )}
            {mark(task, stage)}
          </span>
        )}
        {!p.grouped && <span className="rz-kc-acts">{acts(task, stage)}</span>}
      </div>
    );
  };

  const drop = (c: TasksRuheColumn) =>
    c.col && !p.grouped
      ? {
          onDragOver: (e: DragEvent) => {
            if (!dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropCol !== c.key) setDropCol(c.key);
          },
          onDragLeave: (e: DragEvent) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropCol((x) => (x === c.key ? null : x));
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain") || dragId;
            setDragId(null);
            setDropCol(null);
            if (id && byId(id)) p.onMove(id, c.col!);
          },
        }
      : {};

  const addRow = (col: RuheColumn) => (
    <form
      className="rz-kc rz-kc-new"
      onSubmit={(e) => {
        e.preventDefault();
        submit(col);
      }}
    >
      <input
        autoFocus
        className="rz-kc-in"
        value={draft}
        aria-label={t("New task")}
        placeholder={col === "today" ? t("New task for today") : t("New task")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!draft.trim()) setAdding(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft("");
            setAdding(null);
          }
        }}
      />
    </form>
  );

  const board = (
    <div className={"rz-tk-board" + (p.columns.length > 4 ? " is-many" : "")}>
      {p.columns.map((c) => (
        <section key={c.key} className={"rz-tk-col" + (dropCol === c.key ? " is-drop" : "")} aria-label={c.label} data-col={c.col} {...drop(c)}>
          <header className="rz-tk-colh">
            {c.col ? COL_GLYPH[c.col] : <Circle aria-hidden size={13} strokeWidth={1.75} />}
            <span className="rz-tk-coln">{c.label}</span>
            <span className="rz-tk-count">{c.items.length}</span>
            {c.col && !p.grouped && (c.col === "open" || c.col === "today") && (
              <button type="button" className="rz-icon rz-tk-add" aria-label={t("New task in {column}", { column: c.label })} title={t("New task")} onClick={() => setAdding(c.col!)}>
                <Plus size={14} strokeWidth={1.75} />
              </button>
            )}
          </header>
          {adding === c.col && addRow(c.col!)}
          <LazyItems items={c.items} render={card} resetKey={c.key} />
          {dropCol === c.key && <div className="rz-kc rz-kc-ghost" aria-hidden />}
        </section>
      ))}
    </div>
  );

  const row = (task: ActionItem) => {
    const stage = p.stage(task);
    const done = stage === "done";
    const due = p.due(task);
    const src = p.source(task);
    return (
      <div key={task.id}>
        <div
          className={"rz-tk-row" + (done ? " is-done" : "") + (p.selected.has(task.id) ? " is-sel" : "")}
          tabIndex={0}
          data-task-id={task.id}
          onKeyDown={cardKeys(task)}
          {...p.rowProps(task.id)}
        >
          <input type="checkbox" className="rz-tk-check" aria-label={task.title} checked={done} onChange={() => p.onToggle(task.id)} />
          <button type="button" className="rz-tk-rt" onClick={() => p.onOpen(task)} title={task.title} tabIndex={-1}>
            {task.title}
          </button>
          {src && <span className="rz-tk-rs">{src}</span>}
          <span className="rz-tk-rr">
            {mark(task, stage)}
            {due && <span className={p.overdue(task) ? "rz-kc-late" : undefined}>{due}</span>}
            <button
              type="button"
              className="rz-icon rz-kc-ib"
              aria-label={t("Edit details: {title}", { title: task.title })}
              aria-expanded={p.detailId === task.id}
              title={t("Project, timeframe and context")}
              onClick={() => p.onDetail(p.detailId === task.id ? null : task.id)}
            >
              <Pencil size={13} strokeWidth={1.75} />
            </button>
          </span>
        </div>
        {p.detailId === task.id && <div className="rz-tk-detail">{p.detail(task)}</div>}
      </div>
    );
  };

  const list = (
    <div className="rz-tk-list">
      {p.columns.map((c) => (
        <section key={c.key} aria-label={c.label}>
          <h2 className="rz-tk-gh">
            {c.col ? COL_GLYPH[c.col] : null}
            {c.label}
            <span className="rz-tk-count">{c.items.length}</span>
          </h2>
          {c.items.length ? <LazyItems items={c.items} render={row} resetKey={c.key} /> : <p className="rz-tk-none">{t("No tasks")}</p>}
        </section>
      ))}
    </div>
  );

  return (
    <div className="rz-tk">
      <LocationBar
        icon={<SquareCheckBig aria-hidden size={14} strokeWidth={1.75} />}
        crumbs={[{ label: tx("nav", "Tasks") }]}
        meta={p.meta}
        actions={
          <Link href="/reminders" className="rz-bbtn rz-bbtn--ghost">
            <Bell aria-hidden size={14} strokeWidth={1.75} />
            {t("Reminders")}
          </Link>
        }
        more={p.menu}
      />
      <ViewBar
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label(), icon: v.icon }))}
        value={p.view}
        onChange={p.onView}
        label={t("Layout")}
        right={
          <>
            <RuhePop label={t("Filter")} icon={<ListFilter aria-hidden size={14} strokeWidth={1.75} />} count={p.filterCount} wide>
              {p.filters}
            </RuhePop>
            <RuhePop label={t("Display")} icon={<SlidersHorizontal aria-hidden size={14} strokeWidth={1.75} />}>
              {p.display}
            </RuhePop>
          </>
        }
      />
      {p.notice}
      {p.selectionBar}
      <div className="rz-tk-body" ref={body}>
        {p.view !== "week" && !p.columns.some((c) => c.items.length) ? (
          p.filterCount ? (
            <EmptyPic kind="search" size="lg" title={t("No tasks for these filters.")} />
          ) : (
            <EmptyPic kind="stack" size="lg" title={t("Nothing to do")}>
              {t("New tasks come from your notes and meetings, or from what you capture below.")}
            </EmptyPic>
          )
        ) : p.view === "board" ? board : p.view === "list" ? list : <div className="rz-tk-week">{p.week}</div>}
        {p.view !== "week" && (
          <KbdHints
            items={[
              { keys: ["J", "K"], label: t("next") },
              { keys: ["↵"], label: t("open") },
              { keys: ["X"], label: t("done") },
              { keys: ["Ctrl"], label: t("click selects several") },
            ]}
          />
        )}
      </div>
    </div>
  );
}

