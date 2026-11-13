"use client";

import { t, tn } from "@/i18n";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Kbd } from "@kortex/ui";
import { setActionItemDone, updateActionItem } from "@/lib/api/actions";
import type { HomeView } from "@/lib/data/home";
import type { HomeTarget } from "@/lib/mock/home";
import { useNotes } from "@/lib/notes/store";
import { snoozePresets } from "@/lib/reminders";
import { useShell } from "@/lib/shell/store";
import { Ico, type IconId } from "@/components/shell/icons";
import { isLiveData, TASKS } from "@/lib/workspace-data";
import { startAgentJob } from "@/server/agent/actions";
import { agentJobHref } from "./AgentNight";
import { Img } from "./Img";
import { buildStack, presortPrompt, loadStackState, saveStackState, stackCopy, type StackCard, type StackKind, type StackOutcome } from "./stack";
import { typeIcon } from "./Thumb";

const KIND_ICON: Record<StackKind, IconId> = {
  task: "orbit-todo",
  remind: "bell",
  inbox: "orbit-inbox",
  filed: "layers",
  redis: "sparkles",
  flash: "cards",
};
/** Tint of a card kind (glyph, kind line, ambient glow). */
const KIND_TINT: Record<StackKind, string> = {
  task: "#A5B4FC",
  remind: "#FBBF24",
  inbox: "#7DD3FC",
  filed: "#2DD4BF",
  redis: "#C4B5FD",
  flash: "#F9A8D4",
};

const addDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Picture side of a card: its cover, a small collage, or the kind glyph. */
function Media({ card }: { card: StackCard }) {
  if (card.imgs.length >= 2)
    return (
      <span className="hm-ds-coll" data-n={Math.min(card.imgs.length, 4)}>
        {card.imgs.slice(0, 4).map((src, i) => (
          <span key={i} className="hm-ds-im">
            <Img src={src} />
          </span>
        ))}
      </span>
    );
  if (card.imgs[0])
    return (
      <span className="hm-ds-thumb">
        <Img src={card.imgs[0]} />
      </span>
    );
  return (
    <span className="hm-ds-glyph" aria-hidden>
      <Ico name={card.type ? typeIcon(card.type) : KIND_ICON[card.kind]} size={44} />
    </span>
  );
}

/**
 * Tagesstapel (Home, first bento section): one card at a time with a main action (Enter) and a way to put it
 * aside (←); Z takes the last step back. The queue above shows every card of the day, done ones dimmed. Actions
 * are the real ones (task done, reminder cleared or moved, entry opened); what was decided is kept for the day.
 */
export function DailyStack({ day, view, go }: { day: string | null; view: HomeView | null; go: (t: HomeTarget) => void }) {
  const { items, setReminder } = useNotes();
  const { showToast } = useShell();
  const cards = useMemo(
    () =>
      day
        ? buildStack({
            items: Object.values(items),
            tasks: TASKS,
            view,
            day,
            titleOf: (id) => items[id]?.title,
          })
        : [],
    [items, view, day],
  );
  // The deck of this visit: a card that was acted on stays in the queue (dimmed) although its data is gone.
  const [deck, setDeck] = useState<StackCard[]>([]);
  const deckDay = useRef<string | null>(null);
  useEffect(() => {
    const sameDay = deckDay.current === day;
    deckDay.current = day;
    setDeck((old) => {
      if (!sameDay) return cards;
      const known = new Set(old.map((c) => c.id));
      const fresh = cards.filter((c) => !known.has(c.id));
      const byId = new Map(cards.map((c) => [c.id, c]));
      return [...old.map((c) => byId.get(c.id) ?? c), ...fresh];
    });
  }, [cards, day]);

  const [done, setDone] = useState<Record<string, StackOutcome>>({});
  useEffect(() => {
    if (day) setDone(loadStackState(day));
  }, [day]);
  const [picked, setPicked] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [leaving, setLeaving] = useState<"r" | "l" | null>(null);
  const [sorting, setSorting] = useState(false);
  const router = useRouter();
  const history = useRef<{ id: string; undo: () => void }[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const open = deck.filter((c) => !done[c.id]);
  const cur = open.find((c) => c.id === picked) ?? open[0] ?? null;
  const copy = cur ? stackCopy(cur.kind) : null;

  const settle = useCallback(
    (card: StackCard, outcome: StackOutcome, undo: () => void, toast: string) => {
      if (!day) return;
      setLeaving(outcome === "done" ? "r" : "l");
      window.setTimeout(() => {
        setLeaving(null);
        setFlipped(false);
        setPicked(null);
        setDone((d) => {
          const next = { ...d, [card.id]: outcome };
          saveStackState(day, next);
          return next;
        });
      }, 180);
      history.current.push({ id: card.id, undo });
      setCanUndo(true);
      showToast(toast);
    },
    [day, showToast],
  );

  const act = useCallback(
    (outcome: StackOutcome) => {
      if (!cur || !day || leaving) return;
      const c = stackCopy(cur.kind);
      const live = isLiveData();
      const fail = (error: string) => showToast(t("Not saved: {error}", { error }));
      const noop = () => undefined;
      switch (cur.kind) {
        case "task": {
          const id = cur.refId!;
          if (outcome === "done") {
            if (live) void setActionItemDone(id, true).then((r) => !r.ok && fail(r.error));
            settle(cur, outcome, () => live && void setActionItemDone(id, false), c.done);
          } else {
            const before = TASKS.find((x) => x.id === id)?.due ?? day;
            if (live) void updateActionItem(id, { due: addDay(day) }).then((r) => !r.ok && fail(r.error));
            settle(cur, outcome, () => live && void updateActionItem(id, { due: before }), c.aside);
          }
          return;
        }
        case "remind": {
          const id = cur.refId!;
          const before = items[id]?.remindAt ?? null;
          const tomorrow = snoozePresets(new Date(), day).find((p) => p.key === "tomorrow");
          setReminder(id, outcome === "done" ? null : (tomorrow?.iso ?? null));
          settle(cur, outcome, () => setReminder(id, before), outcome === "done" ? c.done : c.aside);
          return;
        }
        case "flash":
          if (!flipped) {
            setFlipped(true);
            return;
          }
          settle(cur, outcome, noop, outcome === "done" ? c.done : c.aside);
          return;
        case "filed":
          // "Ansehen" opens the first of them; either way the card is dealt with.
          if (outcome === "aside" && cur.target) go(cur.target);
          settle(cur, outcome, noop, outcome === "done" ? c.done : c.aside);
          return;
        default:
          if (outcome === "done" && cur.target) go(cur.target);
          settle(cur, outcome, noop, outcome === "done" ? c.done : c.aside);
      }
    },
    [cur, day, leaving, flipped, items, setReminder, settle, go, showToast],
  );

  const undo = useCallback(() => {
    const last = history.current.pop();
    if (!last || !day) return;
    last.undo();
    setCanUndo(history.current.length > 0);
    setFlipped(false);
    setPicked(last.id);
    setDone((d) => {
      const next = { ...d };
      delete next[last.id];
      saveStackState(day, next);
      return next;
    });
  }, [day]);

  // Enter = main action, ← = put aside, Z = undo; never while typing or inside a dialog or menu.
  const keys = useRef({ act, undo });
  keys.current = { act, undo };
  const active = !!cur || canUndo;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.closest("[role=dialog],[role=menu]"))) return;
      if (e.key === "Enter") keys.current.act("done");
      else if (e.key === "ArrowLeft") keys.current.act("aside");
      else if (e.key.toLowerCase() === "z") keys.current.undo();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);

  /** "Vorsortieren lassen": the agent looks through the open cards in the background and says what it can take over. */
  const presort = async () => {
    if (!isLiveData()) return showToast(t("The agent needs an account (not available in mock mode)"));
    setSorting(true);
    const r = await startAgentJob({ prompt: presortPrompt(open), title: t("Presort the daily stack"), origin: "presort" });
    setSorting(false);
    if (!r.ok) return showToast(t("Not saved: {error}", { error: r.error }));
    showToast(t("The agent looks through your stack. The result waits under Agent."), { label: t("Open"), run: () => router.push(agentJobHref(r.data.id)) });
  };

  if (!day || deck.length === 0) return null;

  return (
    <section className="hm-ds" aria-label={t("Daily stack")}>
      <div className="hm-ds-h">
        <h2 className="e-h2">{t("Daily stack")}</h2>
        <div className="hm-ds-queue" role="list">
          {deck.map((c) => {
            const isDone = !!done[c.id];
            return (
              <button
                key={c.id}
                type="button"
                role="listitem"
                className={"hm-ds-q" + (isDone ? " is-done" : "") + (cur?.id === c.id ? " is-on" : "")}
                style={{ "--gc": KIND_TINT[c.kind] } as CSSProperties}
                title={c.title}
                aria-label={isDone ? t("Done: {title}", { title: c.title }) : c.title}
                disabled={isDone}
                onClick={() => {
                  setPicked(c.id);
                  setFlipped(false);
                }}
              >
                {c.imgs[0] ? <Img src={c.imgs[0]} /> : <Ico name={isDone ? "check" : KIND_ICON[c.kind]} size={14} />}
                {isDone && c.imgs[0] && (
                  <span className="hm-ds-q-ok">
                    <Ico name="check" size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="hm-ds-grow" />
        <span className="hm-ds-prog kx-num" title={tn(open.length, "{n} card left", "{n} cards left")}>
          <span className="hm-ds-ring" style={{ "--p": (deck.length - open.length) / deck.length } as CSSProperties} aria-hidden />
          {t("{done} of {total} seen", { done: deck.length - open.length, total: deck.length })}
        </span>
        {open.length > 1 && (
          <button type="button" className="e-btn" onClick={() => void presort()} disabled={sorting}>
            <Ico name="sparkles" size={14} />
            {t("Presort")}
          </button>
        )}
        {canUndo && (
          <button type="button" className="e-btn" onClick={undo} title={t("Undo (Z)")}>
            <Ico name="arrow-left" size={14} />
            {t("Undo")}
          </button>
        )}
      </div>

      <div className="hm-ds-deck">
        {open.length > 2 && <span className="hm-ds-shell s2" aria-hidden />}
        {open.length > 1 && <span className="hm-ds-shell s1" aria-hidden />}
        {cur && copy ? (
          <article
            key={cur.id}
            className={"hm-ds-card" + (leaving ? ` out-${leaving}` : "")}
            style={{ "--gc": KIND_TINT[cur.kind] } as CSSProperties}
            aria-live="polite"
          >
            <span className="hm-ds-amb" aria-hidden />
            <div className="hm-ds-media">
              <Media card={cur} />
            </div>
            <div className="hm-ds-body">
              <span className="hm-ds-kind">
                <Ico name={KIND_ICON[cur.kind]} size={14} />
                {copy.kind}
              </span>
              {cur.kind === "flash" ? (
                <>
                  <p className="hm-ds-flash-q">{cur.title}</p>
                  {flipped && <p className="hm-ds-flash-a">{cur.answer}</p>}
                </>
              ) : (
                <>
                  <h3 className="hm-ds-title">
                    {cur.target ? (
                      <button type="button" onClick={() => go(cur.target!)}>
                        {cur.title}
                      </button>
                    ) : (
                      cur.title
                    )}
                  </h3>
                  {cur.sub && <p className="hm-ds-sub">{cur.sub}</p>}
                </>
              )}
              {cur.chips.length > 0 && (
                <div className="hm-ds-chips">
                  {cur.chips.map((c) => (
                    <span key={c} className="hm-ds-chip kx-truncate">
                      {c}
                    </span>
                  ))}
                </div>
              )}
              <div className="hm-ds-acts">
                {cur.kind === "flash" && !flipped ? (
                  <button type="button" className="kx-btn kx-btn--primary" onClick={() => setFlipped(true)}>
                    {t("Show answer")}
                    <Kbd size="sm">↵</Kbd>
                  </button>
                ) : (
                  <>
                    <button type="button" className="kx-btn kx-btn--primary" onClick={() => act("done")}>
                      {copy.pri}
                      <Kbd size="sm">↵</Kbd>
                    </button>
                    <button type="button" className="kx-btn kx-btn--secondary" onClick={() => act("aside")}>
                      {copy.sec}
                      <Kbd size="sm">←</Kbd>
                    </button>
                  </>
                )}
              </div>
            </div>
          </article>
        ) : (
          <div className="hm-ds-fin">
            <span className="hm-ds-glyph" aria-hidden>
              <Ico name="check" size={44} />
            </span>
            <strong>{t("Stack done for today")}</strong>
            <span className="e-meta">{tn(deck.length, "{n} card decided.", "{n} cards decided.")}</span>
          </div>
        )}
      </div>
      {cur && (
        <p className="hm-ds-keys" aria-hidden>
          <span>
            <Kbd size="sm">↵</Kbd> {t("done")}
          </span>
          <span>
            <Kbd size="sm">←</Kbd> {t("later")}
          </span>
          <span>
            <Kbd size="sm">Z</Kbd> {t("undo")}
          </span>
        </p>
      )}
    </section>
  );
}
