import { t, tn } from "../i18n";
import type { CoverSource } from "../theme/cover";

/*
 * Tagesstapel on the phone (same selection as apps/web/src/components/home/stack.ts): what needs a decision
 * today as one deck of cards. Each card has one main action (swipe right) and one way to put it aside
 * (swipe left). Pure, so the tests cover the selection.
 */

export type StackKind = "task" | "remind" | "inbox" | "filed" | "redis" | "flash";

export interface StackCard {
  /** Stable per card and day: "task:<id>", "remind:<id>", … */
  id: string;
  kind: StackKind;
  title: string;
  sub: string;
  chips: string[];
  img: CoverSource | null;
  /** Entry the card opens (knowledge_items.id). */
  open: string | null;
  /** task: action_items.id; remind / inbox: knowledge_items.id. */
  refId?: string;
  /** flash: the answer behind the question (title). */
  answer?: string;
}

export interface StackEntry {
  id: string;
  title: string;
  tldr: string;
  folder?: string;
  img: CoverSource;
  remindAt?: string | null;
  error?: string | null;
  /** Days ago the entry was created (0 = today). */
  day: number;
}
export interface StackTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  source_item_id: string | null;
}
export interface StackHome {
  archive: { id: string; title: string; quote: string; yearAgo: boolean } | null;
  flashcards: { itemId: string; deck: string; cards: [string, string][] } | null;
  fitsToday: { id: string; title: string; text: string; img: string | null; seed: string } | null;
}

export const STACK_MAX = 8;
const MAX_TASKS = 3;
const MAX_REMINDERS = 2;
const MAX_INBOX = 2;

const inInbox = (e: StackEntry) => !!e.folder && (e.folder === "00_Inbox" || e.folder.startsWith("00_Inbox/"));
const topFolder = (folder?: string) => (folder ?? "").split("/")[0]!.replace(/^\d+_/, "").replace(/_/g, " ");
const isDaily = (e: StackEntry) => !!e.folder && e.folder.includes("/Daily");

/** The end of `day` (local) as ms, for "reminder has come". */
const endOf = (now: Date) => {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};
const shortDay = (iso: string, locale: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });

/** The cards of the day, most pressing first, at most STACK_MAX. `today` is YYYY-MM-DD (phone time). */
export function buildStack(input: { entries: readonly StackEntry[]; tasks: readonly StackTask[]; home: StackHome | null; today: string; now: Date; locale: string; titleOf?: (id: string) => string | undefined; imgOf?: (id: string) => CoverSource | null | undefined }): StackCard[] {
  const { entries, tasks, home, today, now, locale, titleOf, imgOf } = input;
  const out: StackCard[] = [];
  const shown = entries.filter((e) => !e.error);

  const due = tasks.filter((x) => x.status !== "done" && x.status !== "cancelled" && !!x.due_date && x.due_date.slice(0, 10) <= today).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  for (const task of due.slice(0, MAX_TASKS)) {
    const dueDay = task.due_date!.slice(0, 10);
    const source = task.source_item_id ? titleOf?.(task.source_item_id) : undefined;
    out.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      sub: dueDay < today ? t("Overdue since {date}", { date: shortDay(dueDay, locale) }) : t("Due today"),
      chips: source ? [source] : [],
      // The entry the task came from lends its cover, so a task card can carry the image like the others.
      img: (task.source_item_id ? imgOf?.(task.source_item_id) : null) ?? null,
      open: task.source_item_id,
      refId: task.id,
    });
  }

  const end = endOf(now);
  const reminders = shown.filter((e) => !!e.remindAt && Date.parse(e.remindAt) <= end).sort((a, b) => Date.parse(a.remindAt!) - Date.parse(b.remindAt!));
  for (const e of reminders.slice(0, MAX_REMINDERS)) {
    out.push({ id: `remind:${e.id}`, kind: "remind", title: e.title, sub: t("You wanted to come back to this today."), chips: [topFolder(e.folder)].filter(Boolean), img: e.img, open: e.id, refId: e.id });
  }

  const inbox = shown.filter(inInbox);
  for (const e of inbox.slice(0, MAX_INBOX)) {
    out.push({
      id: `inbox:${e.id}`,
      kind: "inbox",
      title: e.title,
      sub: e.tldr.trim() || t("Still in the inbox. Open it and decide where it belongs."),
      chips: inbox.length > MAX_INBOX ? [tn(inbox.length, "{n} entry in the inbox", "{n} entries in the inbox")] : [],
      img: e.img,
      open: e.id,
      refId: e.id,
    });
  }

  // What Kortex filed on its own since yesterday: one card to confirm it.
  const filed = shown.filter((e) => !inInbox(e) && e.day <= 1 && !isDaily(e) && !e.remindAt);
  if (filed.length >= 2) {
    const folders = new Map<string, number>();
    for (const e of filed) folders.set(topFolder(e.folder), (folders.get(topFolder(e.folder)) ?? 0) + 1);
    const top = [...folders.entries()].filter(([f]) => f).sort((a, b) => b[1] - a[1]).slice(0, 3);
    out.push({
      id: `filed:${today}`,
      kind: "filed",
      title: tn(filed.length, "{n} new entry filed", "{n} new entries filed"),
      sub: filed
        .slice(0, 3)
        .map((e) => e.title)
        .join(" · "),
      chips: top.map(([f, n]) => `${f} · ${n}`),
      img: filed[0]!.img,
      open: filed[0]!.id,
    });
  }

  if (home?.fitsToday) {
    const f = home.fitsToday;
    out.push({ id: `redis:f:${f.id}`, kind: "redis", title: f.title, sub: f.text, chips: [t("Fits {seed}", { seed: f.seed })], img: f.img ? { uri: f.img } : null, open: f.id });
  }
  if (home?.archive) {
    const a = home.archive;
    out.push({ id: `redis:a:${a.id}`, kind: "redis", title: a.title, sub: a.quote, chips: [a.yearAgo ? t("1 year ago today") : t("From the archive")], img: null, open: a.id });
  }
  const card = home?.flashcards?.cards[0];
  if (home?.flashcards && card) {
    out.push({ id: `flash:${home.flashcards.deck}:${card[0]}`, kind: "flash", title: card[0], sub: "", answer: card[1], chips: [home.flashcards.deck], img: null, open: home.flashcards.itemId });
  }
  return out.slice(0, STACK_MAX);
}

/** How a card left the stack: its main action or put aside. */
export type StackOutcome = "done" | "aside";

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

/** Labels of a card: kind line, main action, put-aside action and the toast of each (same words as the web). */
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

/** The job "Vorsortieren lassen" hands to the agent (same text as the web stack.ts presortPrompt). */
export function presortPrompt(cards: readonly Pick<StackCard, "kind" | "title" | "sub">[]): string {
  const lines = cards.map((c) => `- ${stackCopy(c.kind).kind}: ${c.title}${c.sub ? ` (${c.sub})` : ""}`);
  return [
    t("Look through today's stack. Say which cards you can take off my hands and propose those changes, which ones need me, and in which order I should go through the rest."),
    ...lines,
  ].join("\n");
}

/** YYYY-MM-DD of the day after `day`. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
