"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Flashcard } from "@kortex/ai-core";
import type { DeckResponse, DecksResponse, DueResponse } from "@/server/flashcards/service";
import { Page, PageTitle } from "@/components/shell/Page";
import { BarButton, KbdHints, LocationBar } from "@/components/shell/Bars";
import { useLook } from "@/components/theme/look";
import { mockDeck, mockDecks, mockDue, mockReview } from "@/lib/mock/flashcards";
import { isLiveData } from "@/lib/workspace-data";
import { msg, t, tn } from "@/i18n";
import { Pictogram } from "@/components/motion/Pictogram";

/*
 * Karteikarten (/flashcards, S15): all decks (notes with cards) with due counts, and a quiz over one deck
 * or everything that is due. Cards come from GET /api/flashcards; every answer is an SM-2 review
 * (POST /api/flashcards/review) that reschedules the card.
 */

type Grade = "again" | "hard" | "good" | "easy";
const GRADES: { grade: Grade; label: string }[] = [
  { grade: "again", label: msg("Again") },
  { grade: "hard", label: msg("Hard") },
  { grade: "good", label: msg("Good") },
  { grade: "easy", label: msg("Easy") },
];

interface QuizCard {
  item_id: string;
  title: string;
  card: Flashcard;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isLiveData()) return mockApi(path, init) as T;
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: { message?: string } }) | null;
  if (!res.ok || !body || body.ok === false) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body;
}

/** Mock mode (no signed-in user, no /api/flashcards): the decks of lib/mock/flashcards.ts. */
function mockApi(path: string, init?: RequestInit): unknown {
  const url = new URL(path, "http://mock");
  if (url.pathname.endsWith("/review")) {
    const b = JSON.parse(String(init?.body ?? "{}")) as { item_id: string; card_id: string; grade: Grade };
    mockReview(b.item_id, b.card_id, b.grade);
    return { ok: true };
  }
  const item = url.searchParams.get("item_id");
  if (item) return mockDeck(item);
  return url.searchParams.get("decks") ? mockDecks() : mockDue();
}

const plural = (n: number) => tn(n, "{n} card", "{n} cards");

function dueText(iso: string | null): string {
  if (!iso) return "";
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);
  if (days <= 0) return t("due");
  return days === 1 ? t("due tomorrow") : t("due in {n} days", { n: days });
}

export function FlashcardsView() {
  const [decks, setDecks] = useState<DecksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<{ title: string; cards: QuizCard[] } | null>(null);
  const ruhe = useLook() === "ruhe";

  const load = useCallback(async () => {
    try {
      setDecks(await api<DecksResponse>("/api/flashcards?decks=1"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Loading failed"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const startAll = async () => {
    try {
      const due = await api<DueResponse>("/api/flashcards?limit=200");
      setQuiz({ title: t("All due cards"), cards: due.cards });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Loading failed"));
    }
  };
  const startDeck = async (itemId: string, onlyDue: boolean) => {
    try {
      const d = await api<DeckResponse>(`/api/flashcards?item_id=${encodeURIComponent(itemId)}`);
      const now = Date.now();
      const cards = d.cards
        .filter((c) => !onlyDue || new Date(c.due_at).getTime() <= now)
        .map((card) => ({ item_id: d.item_id, title: d.title, card }));
      setQuiz({ title: d.title, cards });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Loading failed"));
    }
  };

  if (quiz)
    return (
      <Quiz
        title={quiz.title}
        cards={quiz.cards}
        onDone={() => {
          setQuiz(null);
          void load();
        }}
      />
    );

  if (ruhe)
    return (
      <Page maxWidth={760}>
        <LocationBar
          icon="cards"
          crumbs={[{ label: t("Flashcards") }]}
          meta={decks ? t("{decks} decks · {due} due", { decks: decks.decks.length, due: decks.total_due }) : undefined}
          actions={
            decks && decks.total_due > 0 ? (
              <BarButton variant="primary" kbd="↵" onClick={() => void startAll()}>
                {t("Study all due ({n})", { n: decks.total_due })}
              </BarButton>
            ) : null
          }
        />
        {error && (
          <p className="rz-fc-none" role="alert">
            {error}
          </p>
        )}
        {!decks && !error && <p className="rz-fc-none">{t("Loading decks …")}</p>}
        {decks && decks.decks.length === 0 && (
          <div className="rz-fc-empty">
            <Pictogram kind="idea" size="lg" />
            <h2>{t("No flashcards yet")}</h2>
            <p>{t("Open a note and choose “Flashcards” in the Orbit bar, then the deck appears here.")}</p>
          </div>
        )}
        {decks && decks.decks.length > 0 && (
          <>
            <ul className="rz-fc-decks">
              {decks.decks.map((d) => (
                <li key={d.item_id} className="rz-fc-deck">
                  <span className={"rz-fc-dot" + (d.due > 0 ? " is-due" : "")} aria-hidden />
                  <Link href={`/notes/${d.item_id}`} className="rz-fc-deck-t">
                    {d.title}
                  </Link>
                  <span className="rz-fc-deck-m">
                    {plural(d.total)} · {d.due > 0 ? t("{n} due", { n: d.due }) : dueText(d.next_due_at) || t("nothing due")}
                  </span>
                  <span className="rz-fc-deck-a">
                    <BarButton variant="soft" disabled={d.due === 0} onClick={() => void startDeck(d.item_id, true)}>
                      {t("Study due")}
                    </BarButton>
                    <BarButton onClick={() => void startDeck(d.item_id, false)}>{t("Practice all")}</BarButton>
                  </span>
                </li>
              ))}
            </ul>
            <KbdHints items={[{ keys: ["↵"], label: t("study all due") }]} />
          </>
        )}
        {decks && decks.total_due > 0 && <EnterKey onEnter={() => void startAll()} />}
      </Page>
    );

  return (
    <Page maxWidth={860}>
      <PageTitle
        title={t("Flashcards")}
        eyebrow={t("Learn")}
        help={
          decks
            ? t("{decks} decks · {due} due", { decks: decks.decks.length, due: decks.total_due })
            : t("Decks from your notes, repeated on the SM-2 schedule")
        }
        aside={
          decks && decks.total_due > 0 ? (
            <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={() => void startAll()}>
              {t("Study all due ({n})", { n: decks.total_due })}
            </button>
          ) : null
        }
      />
      {error && (
        <p className="e-meta" role="alert">
          {error}
        </p>
      )}
      {!decks && !error && <p className="e-meta">{t("Loading decks …")}</p>}
      {decks && decks.decks.length === 0 && (
        <div className="kx-emptystate">
          <h2>{t("No flashcards yet")}</h2>
          <p>{t("Open a note and choose “Flashcards” in the Orbit bar, then the deck appears here.")}</p>
        </div>
      )}
      {decks && decks.decks.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
          {decks.decks.map((d) => (
            <li
              key={d.item_id}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", boxShadow: "inset 0 -1px 0 var(--hair)" }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link href={`/notes/${d.item_id}`} className="kx-truncate" style={{ fontWeight: 500, display: "block" }}>
                  {d.title}
                </Link>
                <span className="e-meta e-num">
                  {plural(d.total)} · {d.due > 0 ? t("{n} due", { n: d.due }) : dueText(d.next_due_at) || t("nothing due")}
                </span>
              </div>
              <button
                type="button"
                className="kx-btn kx-btn--secondary kx-btn--sm"
                disabled={d.due === 0}
                onClick={() => void startDeck(d.item_id, true)}
              >
                {t("Study due")}
              </button>
              <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => void startDeck(d.item_id, false)}>
                {t("Practice all")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** ↵ on the deck list starts all due cards (only when no field or button has the focus). */
function EnterKey({ onEnter }: { onEnter: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el && el !== document.body && el.closest("input, textarea, select, button, a, [contenteditable]")) return;
      e.preventDefault();
      onEnter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnter]);
  return null;
}

function Quiz({ title, cards, onDone }: { title: string; cards: QuizCard[]; onDone: () => void }) {
  const [queue, setQueue] = useState(cards);
  const [back, setBack] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = queue[0];
  const ruhe = useLook() === "ruhe";

  const answer = useCallback(
    async (grade: Grade) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        await api("/api/flashcards/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item_id: current.item_id, card_id: current.card.id, grade }),
        });
        setError(null);
        setDone((n) => n + 1);
        // "Again" brings the card back at the end of this session.
        setQueue((q) => (grade === "again" ? [...q.slice(1), q[0]!] : q.slice(1)));
        if (grade === "again") setAgain((n) => n + 1);
        setBack(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("Saving failed"));
      } finally {
        setBusy(false);
      }
    },
    [current, busy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setBack((b) => !b);
      } else if (back && "1234".includes(e.key) && e.key.length === 1) void answer(GRADES[Number(e.key) - 1]!.grade);
      else if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, answer, onDone]);

  if (ruhe)
    return (
      <Page maxWidth={640}>
        <LocationBar
          icon="cards"
          crumbs={[{ label: t("Flashcards"), onClick: onDone }, { label: title }]}
          meta={current ? t("{cards} open · {done} answered", { cards: plural(queue.length), done }) : undefined}
          actions={<BarButton onClick={onDone}>{t("Finish")}</BarButton>}
        />
        {error && (
          <p className="rz-fc-none" role="alert">
            {error}
          </p>
        )}
        {!current ? (
          <div className="rz-fc-empty">
            <Pictogram kind="stack" size="lg" />
            <h2>{cards.length === 0 ? t("Nothing due") : t("All done")}</h2>
            <p>
              {cards.length === 0
                ? t("No card is due in this deck right now.")
                : again
                  ? t("{cards} answered, {again}× “Again”.", { cards: plural(done), again })
                  : t("{cards} answered.", { cards: plural(done) })}
            </p>
            <BarButton variant="soft" onClick={onDone}>
              {t("Back to the decks")}
            </BarButton>
          </div>
        ) : (
          <>
            <div className="rz-fc-progress" aria-hidden>
              <i style={{ width: `${Math.round((done / Math.max(1, done + queue.length)) * 100)}%` }} />
            </div>
            <button type="button" className="rz-fc-card" onClick={() => setBack((b) => !b)}>
              <span className="rz-fc-side">{back ? t("Answer") : t("Question")}</span>
              <span className="rz-fc-q">{current.card.question}</span>
              {back && <span className="rz-fc-a">{current.card.answer}</span>}
              {current.title && <span className="rz-fc-src">{current.title}</span>}
            </button>
            {back ? (
              <div className="rz-fc-grades">
                {GRADES.map((g, i) => (
                  <BarButton key={g.grade} variant={g.grade === "good" ? "primary" : "soft"} kbd={String(i + 1)} disabled={busy} onClick={() => void answer(g.grade)}>
                    {t(g.label)}
                  </BarButton>
                ))}
              </div>
            ) : (
              <div className="rz-fc-grades">
                <BarButton variant="soft" kbd="Space" onClick={() => setBack(true)}>
                  {t("Show answer")}
                </BarButton>
              </div>
            )}
            <KbdHints
              items={[
                { keys: ["Space"], label: t("flip") },
                { keys: ["1", "2", "3", "4"], label: t("grade") },
                { keys: ["Esc"], label: t("finish") },
              ]}
            />
          </>
        )}
      </Page>
    );

  return (
    <Page maxWidth={680}>
      <PageTitle
        title={title}
        eyebrow="Quiz"
        help={current ? t("{cards} open · {done} answered", { cards: plural(queue.length), done }) : undefined}
        aside={
          <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={onDone}>
            {t("Finish")}
          </button>
        }
      />
      {error && (
        <p className="e-meta" role="alert">
          {error}
        </p>
      )}
      {!current ? (
        <div className="kx-emptystate">
          <h2>{cards.length === 0 ? t("Nothing due") : t("All done")}</h2>
          <p>
            {cards.length === 0
              ? t("No card is due in this deck right now.")
              : again
                ? t("{cards} answered, {again}× “Again”.", { cards: plural(done), again })
                : t("{cards} answered.", { cards: plural(done) })}
          </p>
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={onDone}>
            {t("Back to the decks")}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="kxb"
            onClick={() => setBack((b) => !b)}
            style={{ display: "grid", gap: 10, minHeight: 220, padding: "20px 0", textAlign: "left", alignContent: "start", background: "transparent", boxShadow: "inset 0 1px 0 var(--hair), inset 0 -1px 0 var(--hair)" }}
          >
            <span className="e-micro">{back ? t("Answer") : t("Question")}</span>
            <span style={{ fontSize: "calc(20px * var(--kx-fs, 1))", lineHeight: 1.5, fontWeight: 500, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {back ? current.card.answer : current.card.question}
            </span>
            <span className="e-meta">
              {back ? t("How well did you know it?") : t("Tap or press space to flip")}
              {current.title ? ` · ${current.title}` : ""}
            </span>
          </button>
          {back && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {GRADES.map((g, i) => (
                <button
                  key={g.grade}
                  type="button"
                  className={`kx-btn ${g.grade === "good" ? "kx-btn--primary" : "kx-btn--secondary"}`}
                  style={{ justifyContent: "center" }}
                  disabled={busy}
                  onClick={() => void answer(g.grade)}
                  title={t("Key {n}", { n: i + 1 })}
                >
                  {t(g.label)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
