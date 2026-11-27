import { isoDay } from "../data/daily";
import { byLocale, t } from "../i18n";
import { clockOf, dueLabel, kindOf, plain, shortDay, typeLabel, type ItemRow, type TaskRow } from "../data/live";
import type { EntryKind } from "../data/mock";
import { entryLink, type DueItem } from "../notify/plan";
import { DEFAULT_ACCENT, type Look } from "../theme/tokens";

/*
 * Pure models of the home screen widgets (tested without React Native). The widget JSX is in render.tsx,
 * loading in data.ts, the per-widget look (transparency, light/dark, source) in prefs below.
 */

export const WIDGET_CAPTURE = "KortexCapture";
export const WIDGET_TODAY = "KortexToday";
export const WIDGET_ENTRIES = "KortexEntries";
export const WIDGET_CHECKIN = "KortexCheckin";
export const WIDGET_NAMES = [WIDGET_CAPTURE, WIDGET_TODAY, WIDGET_ENTRIES, WIDGET_CHECKIN] as const;

/** Click actions handled in the headless task (handler.tsx); everything else is a plain deep link. */
export const CLICK = {
  refresh: "KX_REFRESH",
  taskDone: "KX_TASK_DONE",
  source: "KX_SOURCE",
  energy: "KX_ENERGY",
  /** Reminder done (cleared) or radar change seen. */
  dueDone: "KX_DUE_DONE",
  /** Reminder later: data.when "hour" (+1 h) or "tomorrow" (08:00). */
  snooze: "KX_SNOOZE",
  fav: "KX_FAV",
  read: "KX_READ",
  /** Inbox: take the AI's folder suggestion. */
  file: "KX_FILE",
} as const;

/** Quick overlay over the home screen (QuickCaptureActivity, plugins/with-quick-capture.js): no full app start. */
export type QuickKind = "note" | "voice" | "task";
export const QUICK_KINDS: readonly QuickKind[] = ["note", "voice", "task"];
export const quickLink = (kind: QuickKind) => `kortexquick://capture?kind=${kind}`;
export const quickKindOf = (v: unknown): QuickKind => (QUICK_KINDS.includes(v as QuickKind) ? (v as QuickKind) : "note");

/** Snooze target: +1 h, or tomorrow 08:00 (the app's "Tomorrow"). */
export function snoozeAt(when: "hour" | "tomorrow", now: Date): string {
  if (when === "hour") return new Date(now.getTime() + 3_600_000).toISOString();
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

/** Deep link into a tab of the app (app/open.tsx). */
export const tabLink = (tab: "agent" | "tasks" | "journal" | "entries" | "inbox") => `kortex://open?tab=${tab}`;

// --- Heute: due reminders (and unseen radar changes) first, then open tasks due today or earlier ---------

export interface TodayRow {
  key: string;
  title: string;
  /** Second line: time of the reminder, or the due label of the task. */
  meta: string;
  kind: "reminder" | "radar" | "task";
  /** Deep link a tap opens. */
  link: string;
  /** Task id: the check circle completes it right in the widget. */
  taskId?: string;
  /** Reminder or radar id: the check circle clears it (seen), a reminder can be put off. */
  dueId?: string;
  /** Overdue task (meta in the warning colour). */
  overdue: boolean;
  /** Just ticked in the widget, drawn as done until the next refresh. */
  done: boolean;
}

export interface TodayModel {
  rows: TodayRow[];
  /** Due things that did not fit. */
  more: number;
  total: number;
}

const OPEN_APP = "kortex://open";
const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * Local calendar day (YYYY-MM-DD) of a task's due_date. The column is timestamptz, so the API answers
 * "2026-11-04T09:00:00+00:00", which sorts after "2026-11-04" and never matched a plain string compare.
 * Date-only values and midnight-UTC stamps (a day without a time) keep their own date.
 */
export function dueDay(due: string): string {
  if (due.length <= 10 || /T00:00(:00(\.0+)?)?(Z|\+00(:?00)?)?$/.test(due)) return due.slice(0, 10);
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? due.slice(0, 10) : isoDay(d);
}

/** Open task that is due today, overdue or planned for "today". */
export const dueToday = (t: TaskRow, today: string): boolean =>
  (t.status === "open" || t.status === "in_progress") && ((!!t.due_date && dueDay(t.due_date) <= today) || t.timeframe === "today");

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** End of the local day, the cut-off of "Heute". */
export const endOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

/** Server list (already due, plus radar changes) and the reminders still coming today; one row per id, the server wins. */
export function mergeDue(server: readonly DueItem[], today: readonly DueItem[]): DueItem[] {
  const seen = new Set(server.map((d) => d.id));
  return [...server, ...today.filter((d) => !seen.has(d.id))];
}

/**
 * `doneIds`: tasks ticked, reminders done or radar changes seen in the widget (drawn as done until the next
 * refresh). `snoozed`: id -> new remind_at of reminders put off in the widget; one past today leaves the list.
 */
export function buildToday(due: readonly DueItem[], tasks: readonly TaskRow[], now: Date, max: number, doneIds: readonly string[] = [], snoozed: Readonly<Record<string, string>> = {}): TodayModel {
  const today = isoDay(now);
  const ticked = new Set(doneIds);
  const cut = endOfDay(now).getTime();
  const all: TodayRow[] = [
    ...due
      .map((d) => (snoozed[d.id] ? { ...d, remind_at: snoozed[d.id]! } : d))
      .filter((d) => !snoozed[d.id] || Date.parse(d.remind_at) <= cut)
      .sort((a, b) => Date.parse(a.remind_at) - Date.parse(b.remind_at))
      .map<TodayRow>((d) => ({
        key: d.id,
        title: d.title.trim() || t("Untitled"),
        meta: d.kind === "radar" ? t("Page changed") : t("Reminder · {time}", { time: clock(d.remind_at) }),
        kind: d.kind,
        link: entryLink(d.id),
        dueId: d.id,
        overdue: false,
        done: ticked.has(d.id),
      })),
    ...tasks
      .filter((task) => dueToday(task, today) || (ticked.has(task.id) && task.status === "done"))
      .sort((a, b) => (a.due_date ? dueDay(a.due_date) : "9999").localeCompare(b.due_date ? dueDay(b.due_date) : "9999") || PRIORITY[a.priority] - PRIORITY[b.priority])
      .map<TodayRow>((task) => ({
        key: task.id,
        title: task.title,
        meta: dueLabel(task.due_date, now) ?? t("Today"),
        kind: "task",
        link: task.source_item_id ? entryLink(task.source_item_id) : OPEN_APP,
        taskId: task.id,
        overdue: !!task.due_date && dueDay(task.due_date) < today,
        done: ticked.has(task.id) || task.status === "done",
      })),
  ];
  const shown = Math.max(0, max);
  return { rows: all.slice(0, shown), more: Math.max(0, all.length - shown), total: all.length };
}

/** Rows the scrollable "Heute" list holds at most (a home screen list is no place for a backlog). */
export const TODAY_MAX = 40;

/** "Di., 24. Nov." / "Tue, Nov 24": the date line under a widget title. */
export function widgetDate(now: Date): string {
  const wd = now.toLocaleDateString(byLocale({ en: "en-US", de: "de-DE" }), { weekday: "short" });
  const mon = now.toLocaleDateString(byLocale({ en: "en-US", de: "de-DE" }), { month: "short" });
  return byLocale({ en: `${wd}, ${mon} ${now.getDate()}`, de: `${wd}, ${now.getDate()}. ${mon}` });
}

// --- Einträge: recent, favourite or inbox entries as cards --------------------------------------------

export type EntrySource = "recent" | "favorites" | "inbox";
export const ENTRY_SOURCES: readonly EntrySource[] = ["recent", "favorites", "inbox"];

export type WidgetItem = Pick<ItemRow, "id" | "type" | "title" | "summary" | "content_md" | "status" | "is_favorite" | "created_at"> & {
  /** metadata.read_at ("gelesen"). */
  read_at?: string | null;
  /** Inbox: the folder the AI suggests and waits for a check (same rule as the app's review). */
  target?: string | null;
};

export interface EntryCard {
  key: string;
  title: string;
  /** Summary (or the start of the text), up to two lines in the card. */
  line: string;
  /** "Artikel · Heute, 14:03". */
  meta: string;
  /** knowledge_items.type, for the icon. */
  type: string;
  kind: EntryKind;
  fav: boolean;
  /** Still in the AI pipeline. */
  processing: boolean;
  /** Marked as read. */
  read: boolean;
  /** Inbox: suggested folder (path) a tap on "Passt" files it into, and its last segment as the label. */
  target?: string;
  targetLabel?: string;
  link: string;
}

/** Changes made in the widget, drawn at once until the next refresh brings them from the server. */
export interface EntryPending {
  fav?: Readonly<Record<string, boolean>>;
  read?: Readonly<Record<string, boolean>>;
  /** Filed into the suggested folder: leaves the inbox list. */
  filed?: readonly string[];
}

export function applyEntryPending(cards: readonly EntryCard[], pending: EntryPending): EntryCard[] {
  const filed = new Set(pending.filed ?? []);
  return cards
    .filter((c) => !filed.has(c.key))
    .map((c) => ({ ...c, fav: pending.fav?.[c.key] ?? c.fav, read: pending.read?.[c.key] ?? c.read }));
}

const folderLabel = (path: string) => {
  const leaf = path.split("/").filter(Boolean).pop() ?? path;
  return leaf.replace(/^\d+_/, "").replace(/_/g, " ");
};

/** Rows the "Einträge" list holds at most. */
export const ENTRIES_MAX = 25;

export function buildEntries(rows: readonly WidgetItem[], now: Date, max = ENTRIES_MAX): EntryCard[] {
  return rows.slice(0, max).map((r) => {
    const processing = r.status === "processing";
    return {
      key: r.id,
      title: r.title?.trim() || t("Untitled"),
      line: processing ? t("Kortex is still processing this entry") : plain(r.summary, 160) || plain(r.content_md, 160),
      meta: `${typeLabel(r.type)} · ${shortDay(r.created_at, now)}, ${clockOf(r.created_at)}`,
      type: r.type,
      kind: kindOf(r.type),
      fav: r.is_favorite === true,
      processing,
      read: typeof r.read_at === "string" && r.read_at.length > 0,
      ...(r.target ? { target: r.target, targetLabel: folderLabel(r.target) } : {}),
      link: entryLink(r.id),
    };
  });
}

// --- Energie-Check-in: today's energy (1-10), streak and the last seven days ---------------------------

export interface CheckinModel {
  date: string;
  energy: number | null;
  streak: number;
  /** Oldest first, today last. */
  week: { day: string; label: string; energy: number | null }[];
}

const WEEKDAY_INITIAL = { en: ["S", "M", "T", "W", "T", "F", "S"], de: ["S", "M", "D", "M", "D", "F", "S"] };

export function buildCheckin(today: string, energies: Readonly<Record<string, number>>, streak: number, energy: number | null): CheckinModel {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(y, m - 1, d - 6 + i);
    const key = isoDay(day);
    return { day: key, label: byLocale(WEEKDAY_INITIAL)[day.getDay()]!, energy: key === today ? energy : (energies[key] ?? null) };
  });
  return { date: today, energy, streak, week };
}

// --- Per-widget look --------------------------------------------------------------------------------

export type WidgetTheme = "system" | "light" | "dark";
export interface WidgetLook {
  /** Background opacity 0..1 (0 = glass: only the cards stay visible). */
  opacity: number;
  theme: WidgetTheme;
}
export interface WidgetSettings extends WidgetLook {
  source: EntrySource;
}
export interface WidgetPrefs {
  /** Default of every widget (set in the app's settings). */
  look: WidgetLook;
  /** Per placed widget (set on the widget: hold it, then "Settings"). */
  byId: Record<string, Partial<WidgetSettings>>;
}

export const OPACITIES = [1, 0.85, 0.7, 0.5, 0.3, 0] as const;
export const WIDGET_THEMES: readonly WidgetTheme[] = ["system", "light", "dark"];
export const DEFAULT_LOOK: WidgetLook = { opacity: 0.85, theme: "system" };

const isTheme = (v: unknown): v is WidgetTheme => typeof v === "string" && (WIDGET_THEMES as readonly string[]).includes(v);
const isSource = (v: unknown): v is EntrySource => typeof v === "string" && (ENTRY_SOURCES as readonly string[]).includes(v);
const isOpacity = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;

function cleanLook(raw: unknown): Partial<WidgetSettings> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    ...(isOpacity(o.opacity) ? { opacity: o.opacity } : {}),
    ...(isTheme(o.theme) ? { theme: o.theme } : {}),
    ...(isSource(o.source) ? { source: o.source } : {}),
  };
}

/** Stored prefs (JSON) → prefs; anything unreadable falls back to the defaults. */
export function parsePrefs(raw: string | null | undefined): WidgetPrefs {
  let o: { look?: unknown; byId?: unknown } = {};
  try {
    o = raw ? (JSON.parse(raw) as typeof o) : {};
  } catch {
    o = {};
  }
  const look = cleanLook(o.look);
  const byId = o.byId && typeof o.byId === "object" ? Object.fromEntries(Object.entries(o.byId as Record<string, unknown>).map(([k, v]) => [k, cleanLook(v)])) : {};
  return { look: { opacity: look.opacity ?? DEFAULT_LOOK.opacity, theme: look.theme ?? DEFAULT_LOOK.theme }, byId };
}

/** The settings one placed widget is drawn with: its own choice, else the default. */
export function settingsFor(prefs: WidgetPrefs, widgetId: number): WidgetSettings {
  const own = prefs.byId[String(widgetId)] ?? {};
  return { opacity: own.opacity ?? prefs.look.opacity, theme: own.theme ?? prefs.look.theme, source: own.source ?? "recent" };
}

/** New default for all widgets: per-widget transparency and theme give way, the entries source stays. */
export function withDefaultLook(prefs: WidgetPrefs, look: WidgetLook): WidgetPrefs {
  return { look, byId: Object.fromEntries(Object.entries(prefs.byId).map(([k, v]) => [k, v.source ? { source: v.source } : {}])) };
}

export function withWidget(prefs: WidgetPrefs, widgetId: number, patch: Partial<WidgetSettings>): WidgetPrefs {
  const key = String(widgetId);
  return { ...prefs, byId: { ...prefs.byId, [key]: { ...prefs.byId[key], ...patch } } };
}

export function withoutWidget(prefs: WidgetPrefs, widgetId: number): WidgetPrefs {
  const byId = { ...prefs.byId };
  delete byId[String(widgetId)];
  return { ...prefs, byId };
}

// --- App style: the widgets and the quick overlay follow the app's accent, look and light/dark choice ---------

export interface AppStyle {
  accent: string;
  /** Device look (Settings, Darstellung): Ruhe or vivid. */
  look: Look;
}

export interface StoredStyle extends AppStyle {
  /** 0 system, 1 light, 2 dark (Settings, Mode). */
  themePref: number;
}

/** kortex.prefs as the app writes it ({ themePref, accent, look, haptics }); defaults for nothing or junk. */
export function parseStyle(raw: string | null): StoredStyle {
  try {
    const p = raw ? (JSON.parse(raw) as { accent?: unknown; look?: unknown; themePref?: unknown }) : {};
    return {
      accent: typeof p.accent === "string" && p.accent ? p.accent : DEFAULT_ACCENT,
      look: p.look === "vivid" ? "vivid" : "ruhe",
      themePref: p.themePref === 1 || p.themePref === 2 ? p.themePref : 0,
    };
  } catch {
    return { accent: DEFAULT_ACCENT, look: "ruhe", themePref: 0 };
  }
}
