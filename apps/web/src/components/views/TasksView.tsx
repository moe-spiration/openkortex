"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { TIMEFRAMES, timeframeBucket, timeframeLabel, type NamedTimeframe } from "@kortex/db/tasks";
import { ContextMenu, HashtagPill, SelectionBar, bulkActions, isContextMenuKey, menuFor, targetsOf, useContextMenu, type ActionId } from "@kortex/ui";
import { Page, PageTitle } from "@/components/shell/Page";
import { Ico, type IconId } from "@/components/shell/icons";
import { GRIPLY_APP_URL } from "@/lib/griply";
import { toneOf } from "@/components/graph/graph-utils";
import { createActionItem, deleteActionItem, setActionItemDone, setActionItemStage, setActionItemsExported, updateActionItem, type TaskRow } from "@/lib/api/actions";
import { isoWeek } from "@/lib/data/collections";
import { startAgentJob } from "@/server/agent/actions";
import { getGriplyStatus, sendTaskToGriply } from "@/server/griply/actions";
import { buildExport, downloadText, taskToExport, type ExportFormat } from "@/lib/tasks-export";
import {
  AGENT_ASSIGNEE,
  COLUMN_LABEL,
  NEW_DUE_LABEL,
  STAGES,
  STAGE_LABEL,
  stageCounts,
  stageMeta,
  stageOf,
  stagePatch,
  type Stage,
  boardCounts,
  boardMeta,
  bucketOf,
  columnOf,
  digestText,
  doneRate,
  dropPatch,
  newDueDate,
  type ColumnKey,
  type DueBucket,
  type NewDue,
  RUHE_COLUMNS,
  RUHE_COLUMN_LABEL,
  ruheColumnOf,
  ruheDrop,
  type RuheColumn,
} from "@/lib/tasks-board";
import { useLook } from "@/components/theme/look";
import { ClipboardCopy, Download, NotebookPen } from "lucide-react";
import { RuheSeg } from "./RuhePop";
import { MenuItem, MenuLabel, MenuSep } from "@/components/ui/primitives";
import { TasksRuhe, type TasksRuheView } from "./TasksRuhe";
import { isLiveData, MOCK_TODAY, noteById, OBJECT_ITEMS, TASKS } from "@/lib/workspace-data";
import {
  PRIORITY_LABEL,
  SOURCE_KIND_LABEL,
  type ActionItem,
  type TaskPriority,
  type TaskSourceKind,
} from "@/lib/mock/views";
import { useShell } from "@/lib/shell/store";
import { monthAbbr } from "./entries";
import { weekdayShort } from "@/lib/date/words";
import { useListSelection } from "./useListSelection";
import { WeekCalendar } from "./WeekCalendar";
import { LazyItems } from "./useIncremental";
import { feature, t, tn, tx } from "@/i18n";

/*
 * Tasks hub (/tasks). Default is the status board: Vorschläge / Übernommen / Beim Agenten / In Griply / Erledigt, where
 * Kortex suggests and the user decides (take over, hand to Griply or to the agent, dismiss). The stage comes from columns
 * the task already has (lib/tasks-board.ts). "Fälligkeit" and "Liste" keep the earlier hub: week / month calendar of the tasks by due date (checkbox ticks them), new-task
 * row with Heute / Morgen / Diese Woche, status filter, Kanban Heute / Diese Woche / Erledigt with drag and drop (moves
 * change the due date or the done state for real) or the same groups as a list, and the Weekly Digest panel with
 * numbers from the tasks. Styles: packages/ui/src/styles/fs-tasks.css.
 */

const COLUMNS: { key: ColumnKey; dot: string }[] = [
  { key: "today", dot: "var(--accent)" },
  { key: "week", dot: "var(--tag-auto-dot)" },
  { key: "done", dot: "var(--ok)" },
];
/** Glyph and tint of a status column (approved preview). */
const STAGE_GLYPH: Record<Stage, { icon: IconId; tint: string }> = {
  suggested: { icon: "o-concept", tint: "#A5B4FC" },
  accepted: { icon: "todo", tint: "#FBBF24" },
  agent: { icon: "sparkles", tint: "#C4B5FD" },
  external: { icon: "o-goal", tint: "#34D399" },
  done: { icon: "check", tint: "#9898A2" },
};
const GROUP_TINTS = ["#A5B4FC", "#34D399", "#FBBF24", "#F472B6", "#60A5FA", "#C4B5FD"];
const STAGE_DOT: Record<Stage, string> = {
  suggested: "var(--accent)",
  accepted: "var(--tag-auto-dot)",
  agent: "var(--accent-ai-solid, var(--accent))",
  external: "var(--ok)",
  done: "var(--t4)",
};
const NEW_DUES: NewDue[] = ["today", "tomorrow", "week"];

const mmss = (s: number) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

/** Card / row due text as the prototype shows it: time or "today", weekday, "overdue", "done". */
function dueLabel(task: ActionItem, done: boolean, today: string): string {
  if (done) return t("done");
  if (!task.due) return t("no date");
  const b = bucketOf(task.due, today);
  if (b === "today") return task.dueTime ?? t("today");
  if (b === "overdue") return t("overdue");
  const d = new Date(task.due + "T12:00:00Z");
  return b === "week" ? weekdayShort(d.getUTCDay()) : t("{month} {day}", { day: d.getUTCDate(), month: monthAbbr(d.getUTCMonth()) });
}

/** Server row of a new or edited task → Tasks hub shape (keeps what the row does not carry). */
function fromRow(r: TaskRow, prev?: ActionItem): ActionItem {
  const due = r.due_date ? r.due_date.slice(0, 10) : "";
  const time = r.due_date && !/T00:00:00/.test(r.due_date) ? r.due_date.slice(11, 16) : undefined;
  return {
    id: r.id,
    title: r.title,
    tag: prev?.tag ?? "",
    due,
    ...(time ? { dueTime: time } : {}),
    priority: (["low", "medium", "high", "urgent"] as const).find((p) => p === r.priority) ?? "medium",
    done: r.status === "done",
    ai: prev?.ai ?? false,
    ...(r.status === "in_progress" ? { accepted: true } : {}),
    assignee: r.assignee ?? prev?.assignee ?? "Me",
    sourceId: r.source_item_id ?? "",
    sourceKind: prev?.sourceKind ?? "note",
    ...(prev?.sourceSec !== undefined ? { sourceSec: prev.sourceSec } : {}),
    ...(r.project_item_id ? { projectId: r.project_item_id } : {}),
    ...(r.timeframe ? { timeframe: r.timeframe } : {}),
    ...(r.context ? { context: r.context } : {}),
    ...(r.exported_at ? { exportedAt: r.exported_at } : {}),
    ...(r.external_ref ? { externalRef: r.external_ref } : {}),
  };
}

type RichPatch = { projectItemId?: string | null; timeframe?: string | null; context?: string | null };

/** Optimistic application of a rich-field patch (null clears a field). */
function applyPatch(task: ActionItem, p: RichPatch): ActionItem {
  const n = { ...task };
  if (p.projectItemId !== undefined) {
    if (p.projectItemId) n.projectId = p.projectItemId;
    else delete n.projectId;
  }
  if (p.timeframe !== undefined) {
    if (p.timeframe) n.timeframe = p.timeframe;
    else delete n.timeframe;
  }
  if (p.context !== undefined) {
    const c = p.context?.replace(/\s+/g, " ").trim();
    if (c) n.context = c;
    else delete n.context;
  }
  return n;
}

type Filters = {
  status: "all" | "open" | "done";
  priority: "all" | TaskPriority;
  due: "all" | DueBucket;
  source: "all" | TaskSourceKind;
  /** "all", "none" (no project) or a project / goal id. */
  project: string;
  timeframe: "all" | "none" | NamedTimeframe;
  exported: "all" | "open" | "exported";
};
const NO_FILTER: Filters = { status: "all", priority: "all", due: "all", source: "all", project: "all", timeframe: "all", exported: "all" };

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="kxh-row" style={{ gap: 8 }}>
      <span className="kx-meta">{label}</span>
      <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className="kx-tab" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const byDue = (a: ActionItem, b: ActionItem) => {
  const ka = a.due ? a.due + (a.dueTime ?? "") : "~";
  const kb = b.due ? b.due + (b.dueTime ?? "") : "~";
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

export function TasksView() {
  const { openNote, setSplit, showToast } = useShell();
  const router = useRouter();
  const live = isLiveData();
  const today = MOCK_TODAY;
  const [tasks, setTasks] = useState<ActionItem[]>(() => TASKS.map((task) => ({ ...task })));
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(TASKS.map((task) => [task.id, task.done])));
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState<NewDue>("today");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [layout, setLayout] = useState<"status" | "board" | "list">("status");
  /** Status board: by stage (default), or read-only by where a task came from or by its project. */
  const [group, setGroup] = useState<"status" | "source" | "project">("status");
  const [dropStage, setDropStage] = useState<Stage | null>(null);
  const [moreFilters, setMoreFilters] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<ColumnKey | null>(null);
  const ruhe = useLook() === "ruhe";
  const [rview, setRview] = useState<TasksRuheView>("board");
  const projects = OBJECT_ITEMS.filter((o) => o.type === "project" || o.type === "goal");
  const projectTitle = (id?: string) => (id ? projects.find((p) => p.id === id)?.title : undefined);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pendingDelete = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  // Optimistic: the checkbox flips at once; live mode persists it (and the matching checklist line
  // in the source note) and flips back when the server refuses.
  const setTaskDone = (id: string, next: boolean): Promise<boolean> => {
    setDone((d) => ({ ...d, [id]: next }));
    if (!live || id.startsWith("tmp-")) return Promise.resolve(true);
    return setActionItemDone(id, next).then((r) => {
      if (r.ok) return true;
      setDone((d) => ({ ...d, [id]: !next }));
      showToast(t("Task not saved: {error}", { error: r.error }));
      return false;
    });
  };
  const toggle = (id: string) => void setTaskDone(id, !done[id]);

  /** New due date (ISO day): optimistic, the server row replaces it, rolled back when the server refuses. */
  const setDue = (id: string, due: string): Promise<void> => {
    const prev = tasks.find((task) => task.id === id);
    if (!prev) return Promise.resolve();
    setTasks((all) =>
      all.map((task) => {
        if (task.id !== id) return task;
        const n: ActionItem = { ...task, due };
        delete n.dueTime;
        return n;
      }),
    );
    if (!live || id.startsWith("tmp-")) return Promise.resolve();
    return updateActionItem(id, { due }).then((r) => {
      if (r.ok) setTasks((all) => all.map((task) => (task.id === id ? fromRow(r.data, task) : task)));
      else {
        setTasks((all) => all.map((task) => (task.id === id ? prev : task)));
        showToast(t("Due date not saved: {error}", { error: r.error }));
      }
    });
  };

  /** Drop of a card into a column (or the same move from the keyboard): due date and / or done state change. */
  const moveTo = (id: string, col: ColumnKey) => {
    const task = tasks.find((x) => x.id === id);
    if (!task) return;
    const patch = dropPatch({ ...(task.due ? { due: task.due } : {}), done: !!done[id] }, col, today);
    if (patch.done === undefined && patch.due === undefined) return;
    if (patch.done !== undefined) void setTaskDone(id, patch.done);
    if (patch.due) setDue(id, patch.due);
    showToast(`${task.title} → ${COLUMN_LABEL[col]}`);
  };

  const create = () => {
    createWith(draft, newDueDate(draftDue, today));
    setDraft("");
  };

  /** New task with the given due day ("" = no date): optimistic, the server row replaces it. */
  const createWith = (text: string, due: string) => {
    const title = text.trim();
    if (!title) return;
    const tempId = `tmp-${Date.now().toString(36)}`;
    const local: ActionItem = { id: tempId, title, tag: "", due, priority: "medium", done: false, ai: false, assignee: "Me", sourceId: "", sourceKind: "note" };
    setTasks((all) => [local, ...all]);
    if (!live) return;
    void createActionItem({ title, ...(due ? { due } : {}) }).then((r) => {
      if (r.ok) {
        setTasks((all) => all.map((task) => (task.id === tempId ? fromRow(r.data) : task)));
        setDone((d) => ({ ...d, [r.data.id]: false }));
      } else {
        setTasks((all) => all.filter((task) => task.id !== tempId));
        showToast(t("Task not created: {error}", { error: r.error }));
      }
    });
  };

  const saveTitle = () => {
    if (!editing) return;
    const { id, title } = editing;
    setEditing(null);
    const prev = tasks.find((task) => task.id === id);
    if (!prev || !title.trim() || title.trim() === prev.title) return;
    setTasks((all) => all.map((task) => (task.id === id ? { ...task, title: title.trim() } : task)));
    if (!live || id.startsWith("tmp-")) return;
    void updateActionItem(id, { title }).then((r) => {
      if (r.ok) setTasks((all) => all.map((task) => (task.id === id ? fromRow(r.data, task) : task)));
      else {
        setTasks((all) => all.map((task) => (task.id === id ? prev : task)));
        showToast(t("Title not saved: {error}", { error: r.error }));
      }
    });
  };

  /** Project, timeframe or context of one task: optimistic, rolled back when the server refuses. */
  const patchTask = (id: string, patch: RichPatch) => {
    const prev = tasks.find((task) => task.id === id);
    if (!prev) return;
    setTasks((all) => all.map((task) => (task.id === id ? applyPatch(task, patch) : task)));
    if (!live || id.startsWith("tmp-")) return;
    void updateActionItem(id, patch).then((r) => {
      if (r.ok) setTasks((all) => all.map((task) => (task.id === id ? fromRow(r.data, task) : task)));
      else {
        setTasks((all) => all.map((task) => (task.id === id ? prev : task)));
        showToast(t("Task not saved: {error}", { error: r.error }));
      }
    });
  };

  /** Sets or clears the "überführt" mark. Optimistic; the server value replaces the local time. */
  const markExported = (ids: string[], on: boolean) => {
    const before = new Map(tasks.filter((task) => ids.includes(task.id)).map((task) => [task.id, task.exportedAt]));
    const stamp = new Date().toISOString();
    const setStamp = (m: (id: string) => string | undefined) =>
      setTasks((all) =>
        all.map((task) => {
          if (!ids.includes(task.id)) return task;
          const v = m(task.id);
          const next: ActionItem = { ...task };
          if (v) next.exportedAt = v;
          else delete next.exportedAt;
          return next;
        }),
      );
    setStamp(() => (on ? stamp : undefined));
    const serverIds = ids.filter((id) => !id.startsWith("tmp-"));
    if (!live || !serverIds.length) return;
    void setActionItemsExported(serverIds, on).then((r) => {
      if (r.ok) {
        const at = new Map(r.data.map((x) => [x.id, x.exported_at ?? undefined]));
        setStamp((id) => (on ? at.get(id) ?? stamp : undefined));
      } else {
        setStamp((id) => before.get(id));
        showToast(t("Export mark not saved: {error}", { error: r.error }));
      }
    });
  };

  const stageShape = (task: ActionItem) => ({ done: !!done[task.id], ai: task.ai, accepted: !!task.accepted, assignee: task.assignee, ...(task.exportedAt ? { exportedAt: task.exportedAt } : {}) });

  /** Takes a suggestion over or puts it back, hands a task to the agent or takes it back. Optimistic. */
  const setStage = (id: string, patch: { accepted?: boolean; agent?: boolean }) => {
    const prev = tasks.find((task) => task.id === id);
    if (!prev) return;
    setTasks((all) =>
      all.map((task) => {
        if (task.id !== id) return task;
        const n: ActionItem = { ...task };
        if (patch.accepted === true) n.accepted = true;
        else if (patch.accepted === false) delete n.accepted;
        if (patch.agent !== undefined) n.assignee = patch.agent ? AGENT_ASSIGNEE : "Me";
        return n;
      }),
    );
    if (!live || id.startsWith("tmp-")) return;
    void setActionItemStage(id, patch).then((r) => {
      if (r.ok) setTasks((all) => all.map((task) => (task.id === id ? fromRow(r.data, task) : task)));
      else {
        setTasks((all) => all.map((task) => (task.id === id ? prev : task)));
        showToast(t("Task not saved: {error}", { error: r.error }));
      }
    });
  };

  /** Moves a card to another stage of the status board (drop or card button). Returns false when the move is not possible. */
  const moveStage = (id: string, to: Stage, quiet = false): boolean => {
    const task = tasks.find((x) => x.id === id);
    if (!task) return false;
    const patch = stagePatch(stageShape(task), to);
    if (!patch) {
      showToast(t("Only what Kortex suggested can go back to the suggestions"));
      return false;
    }
    if (!Object.keys(patch).length) return false;
    const stage = patch.accepted !== undefined || patch.agent !== undefined ? { ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}), ...(patch.agent !== undefined ? { agent: patch.agent } : {}) } : null;
    if (patch.exported !== undefined) markExported([id], patch.exported);
    // Reopening resets the status on the server, so the stage is written after it.
    void (patch.done !== undefined ? setTaskDone(id, patch.done) : Promise.resolve(true)).then((ok) => {
      if (ok && stage) setStage(id, stage);
    });
    if (!quiet) showToast(`${task.title} → ${STAGE_LABEL[to]}`);
    return true;
  };

  /**
   * "Dem Agenten geben": the card moves to the agent and a job starts in the background. The agent proposes what
   * it would do; the result waits on the agent's page.
   */
  const giveToAgent = async (task: ActionItem) => {
    if (!moveStage(task.id, "agent", true)) return;
    if (!live) {
      showToast(t("The agent needs an account (not available in mock mode)"));
      return;
    }
    const source = task.sourceId ? noteById(task.sourceId)?.title : undefined;
    const prompt = source ? t("Take care of this task: {title} (from “{source}”)", { title: task.title, source }) : t("Take care of this task: {title}", { title: task.title });
    const r = await startAgentJob({ prompt, title: task.title, origin: "task", ...(/^[0-9a-f-]{36}$/i.test(task.id) ? { action_item_id: task.id } : {}) });
    if (!r.ok) return showToast(t("The agent could not start: {error}", { error: r.error }));
    showToast(t("The agent is on it. The result waits under Agent."), { label: t("Open"), run: () => router.push(`/agent?job=${r.data.id}`) });
  };

  // Griply connected with "read and change": the board creates the task there directly.
  const [griplyDirect, setGriplyDirect] = useState(false);
  useEffect(() => {
    if (!live || !feature("griply")) return;
    void getGriplyStatus().then((r) => setGriplyDirect(r.ok && r.data.state === "connected" && r.data.access === "write"));
  }, [live]);

  /**
   * "An Griply geben". With a Griply connection that may change things the task is created there and
   * marked as handed over; otherwise the title goes to the clipboard and the task is only marked.
   */
  const giveToGriply = async (task: ActionItem) => {
    if (griplyDirect && live && !task.id.startsWith("tmp-")) {
      const stamp = new Date().toISOString();
      setTasks((all) => all.map((x) => (x.id === task.id ? { ...x, exportedAt: stamp } : x)));
      const r = await sendTaskToGriply(task.id);
      if (r.ok) {
        setTasks((all) => all.map((x) => (x.id === task.id ? { ...x, exportedAt: r.data.exported_at, externalRef: r.data.external_ref } : x)));
        showToast(t("Created in Griply"));
      } else {
        setTasks((all) => all.map((x) => (x.id === task.id ? task : x)));
        showToast(t("Not handed to Griply: {error}", { error: r.error }));
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(task.title);
    } catch {
      /* no clipboard (permissions): the task is still marked */
    }
    if (!moveStage(task.id, "external", true)) return;
    showToast(t("Copied for Griply and marked as handed over"), { label: t("Undo"), run: () => void moveStage(task.id, "accepted", true) });
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") saveTitle();
    else if (e.key === "Escape") setEditing(null);
  };

  /** Every task that is not waiting for its delete (calendar, head line and digest ignore the filters). */
  const present = useMemo(() => tasks.filter((task) => !hidden.has(task.id)), [tasks, hidden]);
  const shape = (task: ActionItem) => ({ ...(task.due ? { due: task.due } : {}), done: !!done[task.id] });

  const visible = useMemo(
    () =>
      present.filter((task) => {
        const isDone = !!done[task.id];
        if (filters.status === "open" && isDone) return false;
        if (filters.status === "done" && !isDone) return false;
        if (filters.priority !== "all" && task.priority !== filters.priority) return false;
        if (filters.source !== "all" && task.sourceKind !== filters.source) return false;
        if (filters.due !== "all" && bucketOf(task.due || undefined, today) !== filters.due) return false;
        if (filters.project === "none" ? !!task.projectId : filters.project !== "all" && task.projectId !== filters.project) return false;
        if (filters.timeframe !== "all") {
          const b = timeframeBucket(task.timeframe, today);
          if (filters.timeframe === "none" ? b !== null : b !== filters.timeframe) return false;
        }
        if (filters.exported === "exported" && !task.exportedAt) return false;
        if (filters.exported === "open" && task.exportedAt) return false;
        return true;
      }),
    [present, done, filters, today],
  );

  const columns = COLUMNS.map((c) => ({
    ...c,
    label: COLUMN_LABEL[c.key],
    items: visible.filter((task) => columnOf({ ...(task.due ? { due: task.due } : {}), done: !!done[task.id] }, today) === c.key).sort(byDue),
  }));
  const stageColumns = STAGES.map((key) => ({ key, dot: STAGE_DOT[key], label: STAGE_LABEL[key], items: present.filter((task) => stageOf(stageShape(task)) === key).sort(byDue) }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTER);
  // Context menu (#3) and multi-select with bulk bar (#4): board and list share the column order.
  // Read-only groupings of the status board: by source kind (meeting, note, clipping …) or by project.
  const groupColumns = useMemo(() => {
    if (group === "status") return [];
    const keyOf = (task: ActionItem) => (group === "source" ? (task.sourceId ? SOURCE_KIND_LABEL[task.sourceKind] : t("Manual")) : (projectTitle(task.projectId) ?? t("Without project")));
    const names: string[] = [];
    for (const task of present) if (!names.includes(keyOf(task))) names.push(keyOf(task));
    return names.map((name, i) => ({ key: name, label: name, tint: GROUP_TINTS[i % GROUP_TINTS.length]!, items: present.filter((task) => keyOf(task) === name).sort(byDue) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectTitle reads the stable object list
  }, [group, present]);
  const ruheShape = (task: ActionItem) => ({ ...stageShape(task), ...(task.due ? { due: task.due } : {}) });
  const ruheColumns = RUHE_COLUMNS.map((col) => ({ key: col, col, label: RUHE_COLUMN_LABEL[col], items: visible.filter((task) => ruheColumnOf(ruheShape(task), today) === col).sort(byDue) }));
  const order = (
    ruhe
      ? rview === "board" && group !== "status"
        ? groupColumns
        : ruheColumns
      : layout === "status"
        ? group === "status"
          ? stageColumns
          : groupColumns
        : columns
  ).flatMap((c) => c.items.map((task) => task.id));
  const sel = useListSelection(order, { onDelete: (ids) => removeTasks(ids) });
  const cm = useContextMenu<string>();
  const menuIds = cm.menu ? targetsOf(sel.state, cm.menu.target) : [];
  // Priority, due, source, project, timeframe and export sit behind "Weitere Filter"; the badge counts the ones in use.
  const extraActive = [filters.priority, filters.due, filters.source, filters.project, filters.timeframe, filters.exported].filter((v) => v !== "all").length;

  const counts = boardCounts(present.map(shape), today);
  const meta = layout === "status" ? stageMeta(stageCounts(present.map(stageShape))) : boardMeta(counts);
  const sourceTitle = (task: ActionItem) => (task.sourceId ? noteById(task.sourceId)?.title : undefined);
  const digest = digestText(
    present.map((task) => {
      const s = sourceTitle(task);
      return { ...shape(task), ...(s ? { sourceTitle: s } : {}) };
    }),
    today,
  );

  /** Calendar: every dated task (filters only narrow the board), done ones stay visible ticked. */
  const calPlans = useMemo(
    () => present.filter((task) => task.due).map((task) => ({ id: task.id, due: task.due, title: task.title, done: !!done[task.id], ...(task.sourceId ? { sourceId: task.sourceId } : {}) })),
    [present, done],
  );

  /** Deletes tasks after an undo window; the server call only happens when the window has passed. */
  function removeTasks(ids: string[]) {
    const list = ids.filter((id) => present.some((task) => task.id === id));
    if (!list.length) return;
    setHidden((h) => new Set([...h, ...list]));
    const timer = setTimeout(() => {
      for (const id of list) {
        pendingDelete.current.delete(id);
        if (live && !id.startsWith("tmp-")) {
          void deleteActionItem(id).then((r) => {
            if (!r.ok) {
              setHidden((h) => new Set([...h].filter((x) => x !== id)));
              showToast(t("Task not deleted: {error}", { error: r.error }));
            }
          });
        }
      }
    }, 6400);
    for (const id of list) pendingDelete.current.set(id, timer);
    showToast(tn(list.length, "Task deleted", "{n} tasks deleted"), {
      label: t("Undo"),
      run: () => {
        clearTimeout(timer);
        for (const id of list) pendingDelete.current.delete(id);
        setHidden((h) => new Set([...h].filter((x) => !list.includes(x))));
      },
    });
  }

  function runTask(action: ActionId, ids: string[]) {
    const first = tasks.find((task) => task.id === ids[0]);
    if (action === "open" || action === "open-split") {
      if (first) jump(first);
      if (action === "open-split" && first?.sourceId) setSplit(true);
    } else if (action === "done" || action === "reopen") {
      for (const id of ids) if (!!done[id] !== (action === "done")) toggle(id);
    } else if (action === "delete") removeTasks(ids);
  }

  /** Selection (or all visible open tasks) to clipboard / .md / .csv, then marked "überführt" with an undo. */
  const exportTasks = async (format: ExportFormat) => {
    const pool = sel.count > 0 ? visible.filter((task) => sel.selected.has(task.id)) : visible.filter((task) => !done[task.id]);
    if (!pool.length) {
      showToast(t("No tasks to export"));
      return;
    }
    const built = buildExport(
      format,
      pool.map((task) => taskToExport({ ...task, done: !!done[task.id] }, projectTitle(task.projectId))),
      today,
    );
    try {
      if (built.file) downloadText(built.file.name, built.file.mime, built.text);
      else await navigator.clipboard.writeText(built.text);
    } catch {
      showToast(t("Export not possible"));
      return;
    }
    const ids = pool.map((task) => task.id);
    markExported(ids, true);
    const said = built.file
      ? tn(ids.length, "Task downloaded and marked as transferred", "{n} tasks downloaded and marked as transferred")
      : tn(ids.length, "Task copied to the clipboard and marked as transferred", "{n} tasks copied to the clipboard and marked as transferred");
    showToast(said, {
      label: t("Undo"),
      run: () => markExported(ids, false),
    });
  };

  const jump = (task: ActionItem) => {
    if (!task.sourceId) {
      showToast(t("Manual task without a source"));
      return;
    }
    openNote(task.sourceId);
    if (task.sourceSec !== undefined) showToast(t("Jumping to {time} in “{title}”", { time: mmss(task.sourceSec), title: noteById(task.sourceId)?.title ?? t("Source") }));
  };

  /** Source line of a card: coloured dot by the source type, its title (or "Manual"), the timestamp of a recording. */
  const sourceOf = (task: ActionItem) => {
    const src = task.sourceId ? noteById(task.sourceId) : undefined;
    const tone = src ? toneOf(src.type) : null;
    const dot = !task.sourceId ? "var(--t4)" : tone === "checkin" ? "var(--accent-checkin)" : tone ? `var(--tag-${tone}-dot)` : "var(--t3)";
    const label = src?.title ?? (task.sourceId ? SOURCE_KIND_LABEL[task.sourceKind] : t("Manual"));
    return { dot, label: task.sourceSec !== undefined ? `${label} · ${mmss(task.sourceSec)}` : label };
  };

  const rowEvents = (id: string) => ({
    "aria-selected": sel.selected.has(id),
    onClick: (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("input,button,a")) return;
      sel.onRowClick(id, e);
    },
    onContextMenu: (e: MouseEvent) => {
      sel.focusRow(id);
      cm.bind(id).onContextMenu(e);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (isContextMenuKey(e)) sel.focusRow(id);
      cm.bind(id).onKeyDown(e);
    },
  });

  /** Kanban card (prototype .kb-card): checkbox, title (opens the source), source with dot, due label; draggable. */
  const card = (task: ActionItem) => {
    const isDone = !!done[task.id];
    const overdue = !isDone && bucketOf(task.due || undefined, today) === "overdue";
    const src = sourceOf(task);
    return (
      <div
        key={task.id}
        className={"fs-kb-card" + (dragId === task.id ? " is-dragging" : "") + (sel.selected.has(task.id) ? " is-sel" : "")}
        tabIndex={0}
        draggable
        data-task-id={task.id}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", task.id);
          setDragId(task.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropCol(null);
        }}
        title={task.ai ? t("Priority: {priority} · detected by AI", { priority: PRIORITY_LABEL[task.priority] }) : t("Priority: {priority}", { priority: PRIORITY_LABEL[task.priority] })}
        {...rowEvents(task.id)}
      >
        <input type="checkbox" className="kx-check" aria-label={task.title} checked={isDone} onChange={() => toggle(task.id)} />
        <span className="fs-kb-main">
          <button type="button" className={"fs-kb-t" + (isDone ? " is-done" : "")} onClick={() => jump(task)} title={task.title}>
            {task.title}
          </button>
          <span className="fs-kb-src">
            <i aria-hidden style={{ background: src.dot }} />
            <span className="kc-clamp1">{src.label}</span>
          </span>
        </span>
        <span className={"fs-kb-due" + (overdue ? " is-late" : "")}>{dueLabel(task, isDone, today)}</span>
      </div>
    );
  };

  /** Card of the status board: title (opens the source), source, due text and the moves that make sense from its stage. */
  const statusCard = (task: ActionItem) => {
    const stage = stageOf(stageShape(task));
    const isDone = stage === "done";
    const overdue = !isDone && bucketOf(task.due || undefined, today) === "overdue";
    const src = sourceOf(task);
    const icon = (to: () => void, name: "o-goal" | "sparkles" | "x" | "arrow-left", label: string) => (
      <button type="button" className="fs-kb-ib" onClick={to} title={label} aria-label={`${label}: ${task.title}`}>
        <Ico name={name} size="sm" />
      </button>
    );
    const grouped = group !== "status";
    const toGriply = feature("griply") ? icon(() => void giveToGriply(task), "o-goal", t("Hand to Griply")) : null;
    const toAgent = icon(() => void giveToAgent(task), "sparkles", t("Hand to the agent"));
    return (
      <div
        key={task.id}
        className={"fs-kb-card fs-kb-card--st" + (dragId === task.id ? " is-dragging" : "") + (sel.selected.has(task.id) ? " is-sel" : "") + (stage === "external" ? " is-ro" : "")}
        tabIndex={0}
        draggable
        data-task-id={task.id}
        data-stage={stage}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", task.id);
          setDragId(task.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropStage(null);
        }}
        {...rowEvents(task.id)}
      >
        <span className="fs-kb-main">
          <button type="button" className={"fs-kb-t" + (isDone ? " is-done" : "")} onClick={() => jump(task)} title={task.title}>
            {task.title}
          </button>
          <span className="fs-kb-src">
            <i aria-hidden style={{ background: src.dot }} />
            <span className="kc-clamp1">{src.label}</span>
          </span>
        </span>
        <span className={"fs-kb-due" + (overdue ? " is-late" : "")}>{dueLabel(task, isDone, today)}</span>
        <div className="fs-kb-acts" hidden={grouped}>
          {stage === "suggested" && (
            <>
              <button type="button" className="kx-btn kx-btn--sm fs-kb-pri" onClick={() => void moveStage(task.id, "accepted")}>
                {t("Take over")}
              </button>
              <span className="fs-grow" />
              {toGriply}
              {toAgent}
              {icon(() => removeTasks([task.id]), "x", t("Dismiss"))}
            </>
          )}
          {stage === "accepted" && (
            <>
              <button type="button" className="kx-btn kx-btn--sm fs-kb-pri" onClick={() => void moveStage(task.id, "done")}>
                <Ico name="check" size="sm" />
                {t("Done")}
              </button>
              <span className="fs-grow" />
              {toGriply}
              {toAgent}
            </>
          )}
          {stage === "agent" && (
            <>
              <Link href="/agent" className="kx-btn kx-btn--secondary kx-btn--sm">
                <Ico name="sparkles" size="sm" />
                {t("Result")}
              </Link>
              <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void moveStage(task.id, "done")}>
                <Ico name="check" size="sm" />
                {t("Done")}
              </button>
              <span className="fs-grow" />
              {icon(() => void moveStage(task.id, "accepted"), "arrow-left", t("Take back"))}
            </>
          )}
          {stage === "external" && (
            <>
              {feature("griply") ? (
                <a className="fs-kb-link" href={GRIPLY_APP_URL} target="_blank" rel="noreferrer noopener" title={task.exportedAt ? t("handed over on {date}", { date: task.exportedAt.slice(0, 10) }) : undefined}>
                  {t("In Griply")}
                  <Ico name="up-right" size="sm" />
                </a>
              ) : (
                <span className="kx-meta">{task.exportedAt ? t("handed over on {date}", { date: task.exportedAt.slice(0, 10) }) : t("Handed over")}</span>
              )}
              <span className="fs-grow" />
              {icon(() => void moveStage(task.id, "accepted"), "arrow-left", t("Take back"))}
            </>
          )}
          {stage === "done" && (
            <>
              <span className="fs-grow" />
              {icon(() => void moveStage(task.id, "accepted"), "arrow-left", t("Reopen"))}
            </>
          )}
        </div>
      </div>
    );
  };

  const stageDrop = (stage: Stage) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropStage !== stage) setDropStage(stage);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropStage((c) => (c === stage ? null : c));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragId;
      setDragId(null);
      setDropStage(null);
      const task = id ? tasks.find((x) => x.id === id) : undefined;
      if (!id) return;
      // Dropped on "In Griply": the same hand-over as the card's button (without Griply: only marked as handed over).
      if (feature("griply") && stage === "external" && task && !task.exportedAt && !done[id]) void giveToGriply(task);
      else void moveStage(id, stage);
    },
  });

  /** One line per task (list mode, V2-10a): checkbox, title, source link, tag dot, project, timeframe, due text. */
  const taskLine = (task: ActionItem) => {
    const isDone = !!done[task.id];
    const src = noteById(task.sourceId);
    const overdue = !isDone && bucketOf(task.due || undefined, today) === "overdue";
    return (
      <div
        key={task.id}
        className="kxh-row fs-task-line"
        tabIndex={0}
        {...rowEvents(task.id)}
        style={{ background: sel.selected.has(task.id) ? "var(--accent-ai-soft)" : undefined }}
        title={task.ai ? t("Priority: {priority} · detected by AI", { priority: PRIORITY_LABEL[task.priority] }) : t("Priority: {priority}", { priority: PRIORITY_LABEL[task.priority] })}
      >
        <input type="checkbox" className="kx-check" style={{ flex: "none" }} aria-label={task.title} checked={isDone} onChange={() => toggle(task.id)} />
        {editing?.id === task.id ? (
          <span className="kx-control kx-control--sm" style={{ flex: "1 1 0", minWidth: 0 }}>
            <input
              autoFocus
              aria-label={t("Edit task")}
              value={editing.title}
              onChange={(e) => setEditing({ id: task.id, title: e.target.value })}
              onKeyDown={onEditKey}
              onBlur={saveTitle}
            />
          </span>
        ) : (
          <span
            className="kx-body kx-truncate"
            onDoubleClick={() => setEditing({ id: task.id, title: task.title })}
            title={t("{title} · double-click to edit", { title: task.title })}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              color: isDone ? "var(--text-muted)" : "var(--text-primary)",
              textDecoration: isDone ? "line-through" : undefined,
            }}
          >
            {task.title}
          </span>
        )}
        {task.sourceId && (
          <button
            type="button"
            className="kxb kx-meta"
            onClick={() => jump(task)}
            aria-label={
              task.sourceSec !== undefined
                ? t("Open {kind}: {title} at {time}", { kind: SOURCE_KIND_LABEL[task.sourceKind], title: src?.title ?? t("Source"), time: mmss(task.sourceSec) })
                : t("Open {kind}: {title}", { kind: SOURCE_KIND_LABEL[task.sourceKind], title: src?.title ?? t("Source") })
            }
            title={`${SOURCE_KIND_LABEL[task.sourceKind]}: ${src?.title ?? t("Source")}${task.sourceSec !== undefined ? ` · ${mmss(task.sourceSec)}` : ""}`}
            style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}
          >
            <Ico name="link" size="sm" />
            {task.sourceSec !== undefined && <span className="kx-num">{mmss(task.sourceSec)}</span>}
          </button>
        )}
        {task.tag && (
          <span style={{ flex: "none", display: "inline-flex" }}>
            <HashtagPill tag={task.tag} variant="dot" />
          </span>
        )}
        {task.projectId && (
          <span className="kx-meta kx-truncate" style={{ flex: "none", maxWidth: 110 }} title={t("Project: {title}", { title: projectTitle(task.projectId) ?? t("unknown") })}>
            {projectTitle(task.projectId) ?? t("Project")}
          </span>
        )}
        {task.timeframe && (
          <span className="kx-meta" style={{ flex: "none" }} title={tx("task", "Timeframe")}>
            {timeframeLabel(task.timeframe)}
          </span>
        )}
        {task.exportedAt && (
          <span className="kx-badge kx-badge--soft" style={{ flex: "none" }} title={t("Transferred on {date}", { date: task.exportedAt.slice(0, 10) })}>
            {t("transferred")}
          </span>
        )}
        <button
          type="button"
          className="kxb kx-meta"
          aria-label={t("Edit details: {title}", { title: task.title })}
          aria-expanded={detailId === task.id}
          title={t("Project, timeframe and context")}
          onClick={() => setDetailId(detailId === task.id ? null : task.id)}
          style={{ flex: "none", display: "inline-flex", color: "var(--text-muted)" }}
        >
          <Ico name="pencil" size="sm" />
        </button>
        <span className={"fs-kb-due" + (overdue ? " is-late" : "")} style={{ minWidth: 40, textAlign: "right" }}>
          {dueLabel(task, isDone, today)}
        </span>
      </div>
    );
  };

  /** Project, timeframe and context editor below the row that is open. */
  const detail = (task: ActionItem) => (
    <div className="kxh-wrap" style={{ gap: "8px 16px", padding: "8px 4px 12px", alignItems: "center", boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }} role="group" aria-label={`Details: ${task.title}`}>
      <label className="kxh-row" style={{ gap: 6 }}>
        <span className="kx-meta">{t("Project")}</span>
        <span className="kx-control kx-control--sm">
          <select value={task.projectId ?? ""} aria-label={t("Project")} onChange={(e) => patchTask(task.id, { projectItemId: e.target.value || null })}>
            <option value="">{t("No project")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="kxh-row" style={{ gap: 6 }}>
        <span className="kx-meta">{tx("task", "Timeframe")}</span>
        <span className="kx-control kx-control--sm">
          <select
            value={task.timeframe && (TIMEFRAMES as readonly string[]).includes(task.timeframe) ? task.timeframe : ""}
            aria-label={tx("task", "Timeframe")}
            onChange={(e) => patchTask(task.id, { timeframe: e.target.value || null })}
          >
            <option value="">{task.timeframe && !(TIMEFRAMES as readonly string[]).includes(task.timeframe) ? timeframeLabel(task.timeframe) : tx("status", "Open")}</option>
            {TIMEFRAMES.map((k) => (
              <option key={k} value={k}>
                {timeframeLabel(k)}
              </option>
            ))}
          </select>
        </span>
        <span className="kx-control kx-control--sm">
          <input type="date" aria-label={t("Timeframe as date")} value={task.timeframe && /^\d{4}-/.test(task.timeframe) ? task.timeframe : ""} onChange={(e) => patchTask(task.id, { timeframe: e.target.value || null })} />
        </span>
      </label>
      <label className="kxh-row" style={{ gap: 6 }}>
        <span className="kx-meta">{t("Due")}</span>
        <span className="kx-control kx-control--sm">
          <input type="date" aria-label={t("Due on")} value={task.due ?? ""} onChange={(e) => e.target.value && setDue(task.id, e.target.value)} />
        </span>
      </label>
      <label className="kxh-row" style={{ gap: 6, flex: "1 1 260px", minWidth: 0 }}>
        <span className="kx-meta">{t("Context")}</span>
        <span className="kx-control kx-control--sm" style={{ flex: "1 1 0", minWidth: 0 }}>
          <input
            key={task.context ?? ""}
            aria-label={t("Context")}
            placeholder={t("Why / where from")}
            maxLength={500}
            defaultValue={task.context ?? ""}
            onBlur={(e) => {
              if (e.target.value.trim() !== (task.context ?? "")) patchTask(task.id, { context: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </span>
      </label>
    </div>
  );

  const taskRow = (task: ActionItem) => (
    <Fragment key={task.id}>
      {taskLine(task)}
      {detailId === task.id && detail(task)}
    </Fragment>
  );

  const dropHandlers = (col: ColumnKey) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropCol !== col) setDropCol(col);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropCol((c) => (c === col ? null : c));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragId;
      setDragId(null);
      setDropCol(null);
      if (id) moveTo(id, col);
    },
  });

  /** Drop of a card into a Ruhe column (Offen / Heute / In Arbeit / Erledigt): due date first, then the stage. */
  const ruheMove = (id: string, col: RuheColumn) => {
    const task = tasks.find((x) => x.id === id);
    if (!task) return;
    const r = ruheDrop(ruheShape(task), col, today);
    if (!r.stage && !r.due) return;
    void (r.due ? setDue(id, r.due) : Promise.resolve()).then(() => {
      if (r.stage) moveStage(id, r.stage, true);
    });
    showToast(`${task.title} → ${RUHE_COLUMN_LABEL[col]}`);
  };

  const contextMenu = (
    <ContextMenu
      at={cm.menu?.at ?? null}
      label={t("Task")}
      sections={menuFor({ kind: "task", count: menuIds.length, done: !!done[menuIds[0] ?? ""], hasSource: !!tasks.find((task) => task.id === menuIds[0])?.sourceId })}
      onAction={(id: ActionId) => runTask(id, menuIds)}
      onClose={cm.close}
    />
  );

  if (ruhe) {
    const ruheFilters = (
      <>
        <RuheSeg
          label="Status"
          value={filters.status}
          onChange={(v) => set("status", v)}
          options={[
            { value: "all", label: t("All") },
            { value: "open", label: tx("status", "Open") },
            { value: "done", label: t("Done") },
          ]}
        />
        <RuheSeg
          label={t("Priority")}
          value={filters.priority}
          onChange={(v) => set("priority", v)}
          options={[
            { value: "all", label: t("All") },
            { value: "urgent", label: t("Urgent") },
            { value: "high", label: t("High") },
            { value: "medium", label: t("Medium") },
            { value: "low", label: t("Low") },
          ]}
        />
        <RuheSeg
          label={t("Due date")}
          value={filters.due}
          onChange={(v) => set("due", v)}
          options={[
            { value: "all", label: t("All") },
            { value: "overdue", label: t("Overdue") },
            { value: "today", label: t("Today") },
            { value: "week", label: t("This week") },
            { value: "later", label: t("Later") },
          ]}
        />
        <RuheSeg
          label={t("Source")}
          value={filters.source}
          onChange={(v) => set("source", v)}
          options={[
            { value: "all", label: t("All") },
            { value: "meeting", label: t("Meeting") },
            { value: "note", label: t("Note") },
            { value: "voice", label: t("Voice memo") },
            { value: "article", label: t("Article") },
          ]}
        />
        <RuheSeg
          label={tx("task", "Timeframe")}
          value={filters.timeframe}
          onChange={(v) => set("timeframe", v)}
          options={[
            { value: "all", label: t("All") },
            { value: "today", label: t("Today") },
            { value: "this_week", label: t("This week") },
            { value: "later", label: t("Later") },
            { value: "none", label: tx("status", "Open") },
          ]}
        />
        <RuheSeg
          label="Export"
          value={filters.exported}
          onChange={(v) => set("exported", v)}
          options={[
            { value: "all", label: t("All") },
            { value: "open", label: t("Not transferred") },
            { value: "exported", label: t("Transferred") },
          ]}
        />
        <label className="rz-pop-row">
          <span className="rz-pop-l">{t("Project")}</span>
          <select className="rz-pop-select" value={filters.project} aria-label={t("Filter by project")} onChange={(e) => set("project", e.target.value)}>
            <option value="all">{t("All")}</option>
            <option value="none">{t("Without project")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button type="button" className="rz-link rz-pop-reset" onClick={() => setFilters(NO_FILTER)}>
            {t("Reset filters")}
          </button>
        )}
      </>
    );
    const display = (
      <>
        <RuheSeg
          label={t("Group by")}
          value={group}
          onChange={setGroup}
          options={[
            { value: "status", label: "Status" },
            { value: "source", label: t("Source") },
            { value: "project", label: t("Project") },
          ]}
        />
        {griplyDirect && <p className="rz-pop-note">{t("Griply connected")}</p>}
      </>
    );
    const grouped = rview === "board" && group !== "status";
    return (
      <>
        <TasksRuhe
          view={rview}
          onView={setRview}
          columns={grouped ? groupColumns : ruheColumns}
          grouped={grouped}
          meta={stageMeta(stageCounts(present.map(stageShape)))}
          isDone={(id) => !!done[id]}
          stage={(task) => stageOf(stageShape(task))}
          source={(task) => (task.sourceId ? sourceOf(task).label : null)}
          due={(task) => (done[task.id] || !task.due ? null : dueLabel(task, false, today))}
          overdue={(task) => !done[task.id] && bucketOf(task.due || undefined, today) === "overdue"}
          selected={sel.selected}
          rowProps={rowEvents}
          onToggle={toggle}
          onOpen={jump}
          onMove={ruheMove}
          onStage={(id, to) => void moveStage(id, to)}
          onAgent={(task) => void giveToAgent(task)}
          onGriply={(task) => void giveToGriply(task)}
          onDismiss={(id) => removeTasks([id])}
          onCreate={(title, col) => createWith(title, col === "today" ? today : "")}
          filters={ruheFilters}
          filterCount={Object.values(filters).filter((v) => v !== "all").length}
          display={display}
          menu={
            <>
              <MenuLabel>{sel.count > 0 ? t("Export ({n} selected)", { n: sel.count }) : t("Export (open, visible tasks)")}</MenuLabel>
              <MenuItem onSelect={() => void exportTasks("clipboard")}>
                <ClipboardCopy aria-hidden size={14} strokeWidth={1.75} />
                {t("Clipboard")}
              </MenuItem>
              <MenuItem onSelect={() => void exportTasks("markdown")}>
                <Download aria-hidden size={14} strokeWidth={1.75} />
                Markdown
              </MenuItem>
              <MenuItem onSelect={() => void exportTasks("csv")}>
                <Download aria-hidden size={14} strokeWidth={1.75} />
                CSV
              </MenuItem>
              <MenuSep />
              <MenuItem onSelect={() => router.push("/journal/week")}>
                <NotebookPen aria-hidden size={14} strokeWidth={1.75} />
                {t("To the weekly review")}
              </MenuItem>
            </>
          }
          week={
            <WeekCalendar
              entries={[]}
              plans={calPlans}
              today={today}
              unit="tasks"
              onToggleTask={(id, next) => void setTaskDone(id, next)}
              onOpen={(sourceId) => openNote(sourceId)}
            />
          }
          detail={detail}
          detailId={detailId}
          onDetail={setDetailId}
          selectionBar={
            sel.count > 0 ? (
              <SelectionBar count={sel.count} total={order.length} actions={bulkActions("task", sel.count)} onAction={(id) => runTask(id, [...sel.selected])} onSelectAll={sel.all} onClear={sel.clear} />
            ) : null
          }
        />
        {contextMenu}
      </>
    );
  }

  return (
    <Page>
      <div className="fs-tasks">
        <PageTitle
          icon="todo"
          title={tx("nav", "Tasks")}
          help={meta}
          aside={
            <div className="fs-tasks-aside">
              {/* A2: Erinnerungen left the sidebar and live next to the tasks. */}
              <Link href="/reminders" className="kx-btn kx-btn--ghost kx-btn--sm">
                <Ico name="bell" size="sm" />
                {t("Reminders")}
              </Link>
              <div className="kx-tabs" role="tablist" aria-label={t("Layout")}>
                <button type="button" className="kx-tab" role="tab" aria-selected={layout === "status"} onClick={() => setLayout("status")}>
                  <Ico name="layers" size="sm" />
                  Status
                </button>
                <button type="button" className="kx-tab" role="tab" aria-selected={layout === "board"} onClick={() => setLayout("board")}>
                  <Ico name="split" size="sm" />
                  {t("Due date")}
                </button>
                <button type="button" className="kx-tab" role="tab" aria-selected={layout === "list"} onClick={() => setLayout("list")}>
                  <Ico name="list" size="sm" />
                  {t("List")}
                </button>
              </div>
            </div>
          }
        />

        {layout !== "status" && (
          <WeekCalendar
            entries={[]}
            plans={calPlans}
            today={today}
            unit="tasks"
            onToggleTask={(id, next) => void setTaskDone(id, next)}
            onOpen={(sourceId) => openNote(sourceId)}
          />
        )}

        <form
          className="fs-newt"
          aria-label={t("New task")}
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="fs-newt-in">
            <Ico name="plus" size="sm" />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("New task, Enter to create")} aria-label={t("New task")} />
          </label>
          <div className="kx-tabs" role="radiogroup" aria-label={t("Due")}>
            {NEW_DUES.map((d) => (
              <button key={d} type="button" className="kx-tab" role="radio" aria-checked={draftDue === d} onClick={() => setDraftDue(d)}>
                {NEW_DUE_LABEL[d]}
              </button>
            ))}
          </div>
          <button type="submit" className="kx-btn kx-btn--primary" disabled={!draft.trim()}>
            {tx("task", "Create")}
          </button>
        </form>

        {layout === "status" && (
          <div className="fs-kb-bar">
            <p className="kx-meta" style={{ margin: 0 }}>
              {feature("griply")
                ? t("Kortex suggests, you decide. Drag a card or use its buttons: take it over, hand it to Griply or to the agent.")
                : t("Kortex suggests, you decide. Drag a card or use its buttons: take it over or hand it to the agent.")}
            </p>
            <span className="fs-grow" />
            {griplyDirect && (
              <span className="fs-kb-chip">
                <i aria-hidden />
                {t("Griply connected")}
              </span>
            )}
            <div className="kx-tabs" role="tablist" aria-label={t("Group by")}>
              {(["status", "source", "project"] as const).map((g) => (
                <button key={g} type="button" className="kx-tab" role="tab" aria-selected={group === g} onClick={() => setGroup(g)}>
                  {g === "status" ? "Status" : g === "source" ? t("Source") : t("Project")}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="fs-bar-row" role="group" aria-label={t("Filter")} hidden={layout === "status"}>
          <FilterGroup
            label="Status"
            value={filters.status}
            onChange={(v) => set("status", v)}
            options={[
              { value: "all", label: t("All") },
              { value: "open", label: tx("status", "Open") },
              { value: "done", label: t("Done") },
            ]}
          />
          <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" aria-expanded={moreFilters} aria-controls="tasks-more-filters" onClick={() => setMoreFilters((v) => !v)}>
            {t("More filters")}
            {extraActive > 0 && <span className="kx-meta">{extraActive}</span>}
            <Ico name="updown" />
          </button>
          <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" aria-expanded={showExport || sel.count > 0} aria-controls="tasks-export" onClick={() => setShowExport((v) => !v)}>
            <Ico name="upload" size="sm" />
            Export
          </button>
          {filtered && (
            <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => setFilters(NO_FILTER)}>
              {t("Reset filters")}
            </button>
          )}
          <span className="fs-grow" />
          {layout === "board" && <span className="kx-meta">{t("Drag cards between the columns")}</span>}
        </div>

        <div id="tasks-more-filters" className="fs-bar-row" hidden={!moreFilters || layout === "status"}>
          <FilterGroup
            label={t("Priority")}
            value={filters.priority}
            onChange={(v) => set("priority", v)}
            options={[
              { value: "all", label: t("All") },
              { value: "urgent", label: t("Urgent") },
              { value: "high", label: t("High") },
              { value: "medium", label: t("Medium") },
              { value: "low", label: t("Low") },
            ]}
          />
          <FilterGroup
            label={t("Due date")}
            value={filters.due}
            onChange={(v) => set("due", v)}
            options={[
              { value: "all", label: t("All") },
              { value: "overdue", label: t("Overdue") },
              { value: "today", label: t("Today") },
              { value: "week", label: t("This week") },
              { value: "later", label: t("Later") },
            ]}
          />
          <FilterGroup
            label={t("Source")}
            value={filters.source}
            onChange={(v) => set("source", v)}
            options={[
              { value: "all", label: t("All") },
              { value: "meeting", label: t("Meeting") },
              { value: "note", label: t("Note") },
              { value: "voice", label: t("Voice memo") },
              { value: "article", label: t("Article") },
            ]}
          />
          <FilterGroup
            label={tx("task", "Timeframe")}
            value={filters.timeframe}
            onChange={(v) => set("timeframe", v)}
            options={[
              { value: "all", label: t("All") },
              { value: "today", label: t("Today") },
              { value: "this_week", label: t("This week") },
              { value: "later", label: t("Later") },
              { value: "none", label: tx("status", "Open") },
            ]}
          />
          <FilterGroup
            label="Export"
            value={filters.exported}
            onChange={(v) => set("exported", v)}
            options={[
              { value: "all", label: t("All") },
              { value: "open", label: t("Not transferred") },
              { value: "exported", label: t("Transferred") },
            ]}
          />
          <label className="kxh-row" style={{ gap: 8 }}>
            <span className="kx-meta">{t("Project")}</span>
            <span className="kx-control kx-control--sm">
              <select value={filters.project} aria-label={t("Filter by project")} onChange={(e) => set("project", e.target.value)}>
                <option value="all">{t("All")}</option>
                <option value="none">{t("Without project")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>

        <div id="tasks-export" className="fs-bar-row" role="group" aria-label="Export" hidden={layout === "status" || !(showExport || sel.count > 0)}>
          <span className="kx-meta">{sel.count > 0 ? t("Export ({n} selected)", { n: sel.count }) : t("Export (open, visible tasks)")}</span>
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void exportTasks("clipboard")}>
            <Ico name="clipboard" size="sm" />
            {t("Clipboard")}
          </button>
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void exportTasks("markdown")}>
            <Ico name="upload" size="sm" />
            Markdown
          </button>
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void exportTasks("csv")}>
            <Ico name="upload" size="sm" />
            CSV
          </button>
        </div>

        {sel.count > 0 && (
          <SelectionBar
            count={sel.count}
            total={order.length}
            actions={bulkActions("task", sel.count)}
            onAction={(id) => runTask(id, [...sel.selected])}
            onSelectAll={sel.all}
            onClear={sel.clear}
          />
        )}

        {layout === "status" ? (
          group !== "status" ? (
            <div className="fs-kb fs-kb--st">
              {groupColumns.map((c) => (
                <section key={c.key} className="fs-kb-col" aria-label={c.label}>
                  <header className="fs-kb-h">
                    <span className="fs-kb-glyph" style={{ "--gc": c.tint } as CSSProperties} aria-hidden>
                      <Ico name={group === "source" ? "layers" : "o-project"} size="sm" />
                    </span>
                    <span className="kx-truncate">{c.label}</span>
                    <span className="kx-meta kx-num">{c.items.length}</span>
                  </header>
                  <LazyItems items={c.items} render={statusCard} resetKey={c.key} />
                </section>
              ))}
            </div>
          ) : (
          <div className="fs-kb fs-kb--st">
            {stageColumns.map((c) => (
              <section key={c.key} className={"fs-kb-col" + (dropStage === c.key ? " is-drop" : "")} aria-label={c.label} data-col={c.key} {...stageDrop(c.key)}>
                <header className="fs-kb-h">
                  <span className="fs-kb-glyph" style={{ "--gc": STAGE_GLYPH[c.key].tint } as CSSProperties} aria-hidden>
                    <Ico name={STAGE_GLYPH[c.key].icon} size="sm" />
                  </span>
                  <span className="kx-truncate">{c.label}</span>
                  {c.key === "external" && <span className="fs-kb-ro">{t("read only")}</span>}
                  <span className="kx-meta kx-num">{c.items.length}</span>
                </header>
                <LazyItems items={c.items} render={statusCard} resetKey={c.key} />
                {c.items.length === 0 && <div className="fs-kb-empty">{c.key === "suggested" ? t("No suggestions right now") : t("Drag here")}</div>}
              </section>
            ))}
          </div>
          )
        ) : layout === "board" ? (
          <div className="fs-kb">
            {columns.map((c) => (
              <section key={c.key} className={"fs-kb-col" + (dropCol === c.key ? " is-drop" : "")} aria-label={c.label} data-col={c.key} {...dropHandlers(c.key)}>
                <header className="fs-kb-h">
                  <i aria-hidden style={{ background: c.dot }} />
                  {c.label}
                  <span className="kx-meta kx-num">{c.items.length}</span>
                </header>
                <LazyItems items={c.items} render={card} resetKey={c.key} />
                {c.items.length === 0 && <div className="fs-kb-empty">{t("Drag here")}</div>}
              </section>
            ))}
          </div>
        ) : visible.length ? (
          <div className="fs-tlist">
            {columns.map((c) => (
              <section key={c.key} className="fs-tlist-g" aria-label={c.label}>
                <header className="kx-eyebrow">
                  {c.label} · {c.items.length}
                </header>
                {c.items.length ? <LazyItems items={c.items} render={taskRow} resetKey={c.key} /> : <p className="kx-meta fs-tlist-empty">{t("No tasks")}</p>}
              </section>
            ))}
          </div>
        ) : (
          <p className="kx-meta" style={{ margin: 0 }}>
            {t("No tasks for these filters.")}
          </p>
        )}

        {/* Weekly Digest (audit 0.6.1 W-07): numbers and sentence come from the tasks; the full digest is the weekly review. */}
        <section className="fs-digest" aria-label={t("Weekly digest")} hidden={layout === "status"}>
          <span className="fs-digest-ic">
            <Ico name="sparkles" />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className="kx-h-section" style={{ margin: 0 }}>
              {t("Weekly digest · week {week}", { week: isoWeek(today) })}
            </h2>
            <p className="kx-meta" style={{ margin: "4px 0 0", lineHeight: 1.5 }}>
              {digest}
            </p>
            <dl className="fs-digest-stats">
              <div>
                <dt className="kx-meta">{t("done")}</dt>
                <dd>{counts.done}</dd>
              </div>
              <div>
                <dt className="kx-meta">{tx("status", "open")}</dt>
                <dd>{counts.today + counts.week}</dd>
              </div>
              <div>
                <dt className="kx-meta">{t("overdue")}</dt>
                <dd className={counts.overdue ? "is-late" : undefined}>{counts.overdue}</dd>
              </div>
              <div>
                <dt className="kx-meta">{t("Rate")}</dt>
                <dd>{doneRate(counts)}%</dd>
              </div>
            </dl>
          </div>
          <Link href="/journal/week" className="kx-btn kx-btn--primary">
            <Ico name="calendar" size="sm" />
            {t("To the weekly review")}
          </Link>
        </section>
      </div>
      {contextMenu}
    </Page>
  );
}
