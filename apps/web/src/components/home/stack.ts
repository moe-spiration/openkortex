import { intlLocale, t, tn } from "@/i18n";
import type { HomeView } from "@/lib/data/home";
import type { HomeTarget } from "@/lib/mock/home";
import { dueToday, type DueTaskLike } from "./due";

/*
 * Tagesstapel: what needs a decision today, as one deck of cards on Home. Built on the client from
 * data the shell already has (tasks, reminders, inbox, new entries, rediscover, flashcards); each
 * card has one main action and one way to put it aside. Pure, so the tests cover the selection.
 */

export type StackKind = "task" | "remind" | "inbox" | "filed" | "redis" | "flash";

export interface StackCard {
  /** Stable per card and day: "task:<id>", "remind:<id>", … */
  id: string;
  kind: StackKind;
  title: string;
  sub: string;
  chips: string[];
  /** Cover image(s); empty = the type glyph. */
  imgs: string[];
  /** Item type for the glyph when there is no image. */
  type: string | null;
  /** What the title opens. */
  target: HomeTarget | null;
  /** task: action_items.id, remind / inbox: knowledge_items.id. */
  refId?: string;
  /** flash: the answer behind the question (title). */
  answer?: string;
}

export interface StackItemLike {
  id: string;
  title: string;
  type: string;
  path: string;
  /** ISO day the entry was created or changed. */
  date: string;
  tldr?: string;
  cover?: string | null;
  remindAt?: string | null;
  status?: string;
  reader?: boolean;
}

export interface StackInput<T extends DueTaskLike = DueTaskLike> {
  items: readonly StackItemLike[];
  tasks: readonly T[];
  view: HomeView | null;
  /** YYYY-MM-DD, the workspace's today. */
  day: string;
  /** Source title of a task ("Aus …"). */
  titleOf?: (itemId: string) => string | undefined;
}

export const STACK_MAX = 8;
const MAX_TASKS = 3;
const MAX_REMINDERS = 2;
const MAX_INBOX = 2;

const HIDDEN = new Set(["archived", "error", "processing"]);
const inInbox = (i: StackItemLike) => i.path.startsWith("00_Inbox/");
const topFolder = (path: string) => path.split("/")[0] ?? "";
const targetOf = (i: StackItemLike): HomeTarget => (i.reader ? { kind: "reader", id: i.id } : { kind: "note", id: i.id });
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: "numeric", month: "short", timeZone: "UTC" });
const dayBefore = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** The cards of the day, most pressing first, at most STACK_MAX. */
export function buildStack<T extends DueTaskLike>({ items, tasks, view, day, titleOf }: StackInput<T>): StackCard[] {
  const out: StackCard[] = [];
  const shown = items.filter((i) => !HIDDEN.has(i.status ?? ""));
  const due = dueToday(shown, tasks, day);

  for (const task of due.tasks.slice(0, MAX_TASKS)) {
    const source = task.sourceId ? titleOf?.(task.sourceId) : undefined;
    out.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      sub: task.due < day ? t("Overdue since {date}", { date: shortDay(task.due) }) : t("Due today"),
      chips: source ? [source] : [],
      imgs: [],
      type: null,
      target: task.sourceId ? { kind: "note", id: task.sourceId } : null,
      refId: task.id,
    });
  }

  for (const i of due.reminders.slice(0, MAX_REMINDERS)) {
    out.push({
      id: `remind:${i.id}`,
      kind: "remind",
      title: i.title,
      sub: t("You wanted to come back to this today."),
      chips: [topFolder(i.path)].filter(Boolean),
      imgs: i.cover ? [i.cover] : [],
      type: i.type,
      target: targetOf(i),
      refId: i.id,
    });
  }

  const inbox = shown.filter(inInbox).sort((a, b) => b.date.localeCompare(a.date));
  for (const i of inbox.slice(0, MAX_INBOX)) {
    out.push({
      id: `inbox:${i.id}`,
      kind: "inbox",
      title: i.title,
      sub: i.tldr?.trim() || t("Still in the inbox. Open it and decide where it belongs."),
      chips: inbox.length > MAX_INBOX ? [tn(inbox.length, "{n} entry in the inbox", "{n} entries in the inbox")] : [],
      imgs: i.cover ? [i.cover] : [],
      type: i.type,
      target: targetOf(i),
      refId: i.id,
    });
  }

  // What Kortex filed on its own since yesterday: one card to confirm it.
  const since = dayBefore(day);
  const filed = shown.filter((i) => !inInbox(i) && i.date >= since && !i.path.includes("/Daily/") && !i.remindAt);
  if (filed.length >= 2) {
    const folders = new Map<string, number>();
    for (const i of filed) folders.set(topFolder(i.path), (folders.get(topFolder(i.path)) ?? 0) + 1);
    const top = [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    out.push({
      id: `filed:${day}`,
      kind: "filed",
      title: tn(filed.length, "{n} new entry filed", "{n} new entries filed"),
      sub: filed
        .slice(0, 3)
        .map((i) => i.title)
        .join(" · "),
      chips: top.map(([folder, n]) => `${folder} · ${n}`),
      imgs: filed.flatMap((i) => (i.cover ? [i.cover] : [])).slice(0, 4),
      type: filed[0]!.type,
      target: targetOf(filed[0]!),
    });
  }

  const fits = view?.fitsToday;
  if (fits) {
    out.push({
      id: `redis:f:${fits.title}`,
      kind: "redis",
      title: fits.title,
      sub: fits.text || fits.eyebrow,
      chips: [fits.eyebrow].filter(Boolean),
      imgs: fits.img ? [fits.img] : [],
      type: fits.type ?? null,
      target: fits.target,
    });
  }
  const archive = view?.archive;
  if (archive) {
    out.push({
      id: `redis:a:${archive.title}`,
      kind: "redis",
      title: archive.title,
      sub: archive.quote,
      chips: [archive.yearAgo ? t("A year ago today") : t("From your archive")],
      imgs: [],
      type: null,
      target: archive.target,
    });
  }

  const card = view?.flashcards?.cards[0];
  if (view?.flashcards && card) {
    out.push({
      id: `flash:${view.flashcards.deck}:${card[0]}`,
      kind: "flash",
      title: card[0],
      sub: "",
      answer: card[1],
      chips: [view.flashcards.deck],
      imgs: [],
      type: null,
      target: view.flashcards.target,
    });
  }

  return out.slice(0, STACK_MAX);
}

/** How a card left the stack: its main action or put aside. */
export type StackOutcome = "done" | "aside";

const STACK_KEY = "kortex.stack.v1";

/** The outcomes of one day from storage; another day's state is dropped. */
export function parseStackState(raw: string | null, day: string): Record<string, StackOutcome> {
  try {
    const v = raw ? (JSON.parse(raw) as { day?: unknown; done?: unknown }) : null;
    if (!v || v.day !== day || !v.done || typeof v.done !== "object") return {};
    const out: Record<string, StackOutcome> = {};
    for (const [k, o] of Object.entries(v.done as Record<string, unknown>)) if (o === "done" || o === "aside") out[k] = o;
    return out;
  } catch {
    return {};
  }
}

export function loadStackState(day: string): Record<string, StackOutcome> {
  try {
    return parseStackState(window.localStorage.getItem(STACK_KEY), day);
  } catch {
    return {};
  }
}

export function saveStackState(day: string, done: Record<string, StackOutcome>) {
  try {
    window.localStorage.setItem(STACK_KEY, JSON.stringify({ day, done }));
  } catch {
    /* storage blocked: the stack still works for this visit */
  }
}

/** Labels of a card: kind line, main action, put-aside action and the toast of each. */
export function stackCopy(kind: StackKind): { kind: string; pri: string; sec: string; done: string; aside: string } {
  switch (kind) {
    case "task":
      return { kind: t("Task"), pri: t("Done"), sec: t("Tomorrow"), done: t("Task done"), aside: t("Moved to tomorrow") };
    case "remind":
      return { kind: t("Reminder"), pri: t("Done"), sec: t("Tomorrow"), done: t("Reminder cleared"), aside: t("Moved to tomorrow") };
    case "inbox":
      return { kind: t("Inbox"), pri: t("Open"), sec: t("Later"), done: t("Opened"), aside: t("Kept for later") };
    case "filed":
      return { kind: t("Filed for You"), pri: t("Looks right"), sec: t("Have a look"), done: t("Filing confirmed"), aside: t("Opened") };
    case "redis":
      return { kind: t("Rediscover"), pri: t("Read now"), sec: t("Not today"), done: t("Opened"), aside: t("Not shown again today") };
    case "flash":
      return { kind: t("Flashcard"), pri: t("Knew it"), sec: t("Again"), done: t("Knew it"), aside: t("Comes back tomorrow") };
  }
}

/**
 * The request of "Vorsortieren lassen": the open cards of the day, one per line, and what the agent should say
 * about them (what it can take over, what needs the user, in which order).
 */
export function presortPrompt(cards: readonly Pick<StackCard, "kind" | "title" | "sub">[]): string {
  const lines = cards.map((c) => `- ${stackCopy(c.kind).kind}: ${c.title}${c.sub ? ` (${c.sub})` : ""}`);
  return [
    t("Look through today's stack. Say which cards you can take off my hands and propose those changes, which ones need me, and in which order I should go through the rest."),
    ...lines,
  ].join("\n");
}
