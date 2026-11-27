"use client";

import { intlLocale, t, tx } from "@/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ContextMenu, isContextMenuKey, Kbd, menuFor, useContextMenu, type ActionId } from "@kortex/ui";
import type { ArchiveView, FlashcardsView, HomeView } from "@/lib/data/home";
import type { HomeTarget } from "@/lib/mock/home";
import { deleteFlashcardDeck } from "@/lib/api/actions";
import { noteHrefById } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { Ico } from "@/components/shell/icons";
import { Pictogram } from "@/components/motion/Pictogram";
import { quoted, savedAgo } from "./home-utils";
import { typeIcon } from "./Thumb";

/*
 * "Wiederentdecken" (Tactile Craft v2, dummy `Home` > Wiederentdecken): one entry from the archive (a year
 * ago today, else an older one) or the note that fits today, as a quote (17/300) with its source, and the
 * actions Öffnen (O), Später (S), Karteikarte (F) with keycaps. "Später" shows the next candidate,
 * "Karteikarte" switches the card to the due flashcards (study, right-click menu, delete with undo).
 */

const fmtDay = (d: Date) => d.toLocaleDateString(intlLocale(), { day: "2-digit", month: "2-digit", year: "numeric" });

interface Candidate {
  key: string;
  meta: string | null;
  quote: string;
  source: string;
  icon: string | null;
  since: string | null;
  target: HomeTarget | null;
}

function candidatesOf(view: HomeView, now: Date | null): Candidate[] {
  const out: Candidate[] = [];
  const a: ArchiveView | null = view.archive;
  if (a) {
    const date = a.date ?? (now ? new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()) : null);
    out.push({
      key: `a:${a.title}`,
      meta: a.yearAgo ? (date ? t("A year ago today · {date}", { date: fmtDay(date) }) : t("A year ago today")) : (savedAgo(date, now) ?? t("From your archive")),
      quote: quoted(a.quote || a.title),
      source: a.title,
      icon: null,
      since: a.since,
      target: a.target,
    });
  }
  const f = view.fitsToday;
  if (f) out.push({ key: `f:${f.title}`, meta: f.eyebrow, quote: quoted(f.text || f.title), source: f.title, icon: f.type ?? null, since: null, target: f.target });
  return out;
}

/** Keys of the card: O, S, F (ignored while typing or with a modifier). */
function useCardKeys(on: boolean, handlers: Record<string, () => void>) {
  const [down, setDown] = useState<string | null>(null);
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest("[role=dialog],[role=menu]"))) return;
      const k = e.key.toLowerCase();
      const run = ref.current[k];
      if (!run) return;
      e.preventDefault();
      setDown(k);
      window.setTimeout(() => setDown((d) => (d === k ? null : d)), 160);
      run();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [on]);
  return down;
}

export function Rediscover({ now, view, go, style }: { now: Date | null; view: HomeView | null; go: (t: HomeTarget) => void; style?: CSSProperties }) {
  const { showToast } = useShell();
  const list = useMemo(() => (view ? candidatesOf(view, now) : []), [view, now]);
  const [idx, setIdx] = useState(0);
  const [cards, setCards] = useState(false);
  const [sinceOpen, setSinceOpen] = useState(false);
  const cur = list.length ? list[idx % list.length]! : null;
  const fc = view?.flashcards ?? null;

  const open = useCallback(() => cur?.target && go(cur.target), [cur, go]);
  const later = useCallback(() => {
    if (!cur) return;
    setSinceOpen(false);
    setIdx((i) => i + 1);
    showToast(list.length > 1 ? t("Will come back later") : t("Will come back tomorrow"));
  }, [cur, list.length, showToast]);
  const toggleCards = useCallback(() => fc && setCards((c) => !c), [fc]);
  const down = useCardKeys(!!view, { o: open, s: later, f: toggleCards });

  return (
    <section className="hm-bx hm-bx--5" aria-label={t("Rediscover")} aria-busy={!view} style={style}>
      <div className="hm-bx-h">
        <h2 className="e-h2">{cards ? t("Flashcards") : t("Rediscover")}</h2>
        <span className="e-meta e-clamp1">{cards ? fc?.deck : cur?.meta}</span>
      </div>
      {!view ? (
        <span className="hm-skel" style={{ height: 150 }} aria-hidden />
      ) : cards && fc ? (
        <FlashcardsCard key={fc.deck} fc={fc} go={go} />
      ) : cur ? (
        <>
          <p className="hm-quote">{cur.quote}</p>
          {cur.target ? (
            <button type="button" className="hm-src" onClick={open}>
              <span className="tc-glyph tc-glyph--sm" aria-hidden>
                <Ico name={cur.icon ? typeIcon(cur.icon) : "i-article"} size="sm" />
              </span>
              <span className="e-clamp1">{cur.source}</span>
            </button>
          ) : (
            <span className="hm-src">
              <span className="e-clamp1">{cur.source}</span>
            </span>
          )}
          {cur.since && (
            <div>
              <button type="button" className="e-link" aria-expanded={sinceOpen} onClick={() => setSinceOpen((o) => !o)}>
                {sinceOpen ? t("Less") : t("What became of it")}
              </button>
              {sinceOpen && <p className="e-meta kx-in" style={{ margin: "4px 0 0" }}>{cur.since}</p>}
            </div>
          )}
        </>
      ) : (
        <>
          <Pictogram kind="idea" size="sm" className="kx-art-ruhe" />
          <p className="e-meta" style={{ margin: 0 }}>
            {t("Your archive is still young. Older entries show up here again as soon as they fit today.")}
          </p>
        </>
      )}
      {view && (
        <div className="hm-actions">
          {cards ? (
            <button type="button" className="e-btn e-btn--ghost" onClick={toggleCards}>
              {t("Back")} <Kbd size="sm" pressed={down === "f"}>F</Kbd>
            </button>
          ) : (
            <>
              <button type="button" className="e-btn e-btn--ghost" onClick={open} disabled={!cur?.target}>
                {tx("verb", "Open")} <Kbd size="sm" pressed={down === "o"}>O</Kbd>
              </button>
              <button type="button" className="e-btn" onClick={later} disabled={!cur}>
                {t("Later")} <Kbd size="sm" pressed={down === "s"}>S</Kbd>
              </button>
              <button
                type="button"
                className="e-btn"
                onClick={toggleCards}
                disabled={!fc}
                title={fc ? t("Due flashcards: {deck}", { deck: fc.deck }) : t("No flashcards due. Have some created in a note's copilot.")}
              >
                {t("Flashcard")} <Kbd size="sm" pressed={down === "f"}>F</Kbd>
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Right-click on a deck (feedback #3): learn (restart the session), edit (open the note), copy link, delete with undo. */
function FlashcardsCard({ fc, go }: { fc: FlashcardsView; go: (t: HomeTarget) => void }) {
  const { showToast } = useShell();
  const [idx, setIdx] = useState(0);
  const [back, setBack] = useState(false);
  const [known, setKnown] = useState(0);
  const [removed, setRemoved] = useState(false);
  const cm = useContextMenu<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteId = fc.target?.kind === "note" ? fc.target.id : null;
  // Leaving the page keeps a delete that is waiting for its undo window: run it now.
  useEffect(
    () => () => {
      if (timer.current && noteId && isLiveData()) {
        clearTimeout(timer.current);
        void deleteFlashcardDeck(noteId);
      }
    },
    [noteId],
  );
  const run = async (action: ActionId) => {
    if (action === "study") {
      setIdx(0);
      setKnown(0);
      setBack(false);
    } else if (action === "edit") {
      if (fc.target) go(fc.target);
    } else if (action === "copy-link" && noteId) {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${noteHrefById(noteId)}`);
        showToast(t("Link copied"));
      } catch {
        showToast(t("Could not copy the link"));
      }
    } else if (action === "delete") {
      setRemoved(true);
      const timeout = setTimeout(() => {
        timer.current = null;
        if (noteId && isLiveData()) {
          void deleteFlashcardDeck(noteId).then((r) => {
            if (!r.ok) {
              setRemoved(false);
              showToast(t("Deck not deleted: {error}", { error: r.error }));
            }
          });
        }
      }, 6400);
      timer.current = timeout;
      showToast(t("Deck deleted"), {
        label: t("Undo"),
        run: () => {
          clearTimeout(timeout);
          timer.current = null;
          setRemoved(false);
        },
      });
    }
  };
  const total = fc.cards.length;
  const left = total - known;
  const [q, a] = fc.cards[idx % total]!;
  if (removed) return <p className="e-meta" style={{ margin: 0 }}>{t("Deck deleted. “Undo” in the notice brings it back within the first seconds.")}</p>;
  return (
    <div
      style={{ display: "grid", gap: 10 }}
      onContextMenu={cm.bind("deck").onContextMenu}
      onKeyDown={(e) => isContextMenuKey(e) && cm.bind("deck").onKeyDown(e)}
    >
      <ContextMenu at={cm.menu?.at ?? null} label="Deck" sections={menuFor({ kind: "flashcard-deck" })} onAction={(id) => void run(id)} onClose={cm.close} />
      <span className="e-meta e-num">
        Karte {left > 0 ? known + 1 : total} von {total}
      </span>
      {left > 0 ? (
        <>
          <button
            type="button"
            className="kxb"
            onClick={() => setBack((b) => !b)}
            style={{ display: "grid", gap: 8, minHeight: 112, padding: "12px 0", textAlign: "left", alignContent: "start", background: "transparent", boxShadow: "inset 0 1px 0 var(--hair), inset 0 -1px 0 var(--hair)" }}
          >
            <span className="e-micro">{back ? t("Answer") : t("Question")}</span>
            <span style={{ fontSize: "calc(15px * var(--kx-fs, 1))", lineHeight: 1.5, fontWeight: 500 }}>{back ? a : q}</span>
            <span className="e-meta">{back ? t("How well did you know it?") : t("Tap to flip")}</span>
          </button>
          {back && (
            <div className="kxh-row" style={{ gap: 8 }}>
              <button
                type="button"
                className="e-btn e-btn--ghost kxh-grow"
                style={{ justifyContent: "center" }}
                onClick={() => {
                  setBack(false);
                  setIdx((i) => i + 1);
                }}
              >
                {t("Again")}
              </button>
              <button
                type="button"
                className="kx-btn kx-btn--primary kx-btn--sm kxh-grow"
                onClick={() => {
                  setBack(false);
                  setIdx((i) => i + 1);
                  setKnown((k) => k + 1);
                }}
              >
                {t("Knew it")}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="kx-in" style={{ display: "grid", gap: 6, padding: "12px 0", boxShadow: "inset 0 1px 0 var(--hair)" }}>
          <span style={{ fontSize: "calc(15px * var(--kx-fs, 1))", fontWeight: 500 }}>{t("All cards done for today")}</span>
          <span className="e-meta">{fc.doneHint}</span>
        </div>
      )}
    </div>
  );
}
