"use client";

import { intlLocale, msg, t, tx } from "@/i18n";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, isContextMenuKey, menuFor, useContextMenu, type ActionId } from "@kortex/ui";
import { dailyPath, ensureDailyNote, pickEnergy } from "@/components/home/daily";
import { Ico } from "@/components/shell/icons";
import { dailyText } from "./dailyText";
import { JournalTabs } from "./JournalTabs";
import { useJournalDay, type SaveState } from "./useJournalDay";
import { deleteItems, duplicateAsNote } from "@/lib/api/actions";
import { addDays, appendPrompt, entryWhen, heatCells, mondayOf, writingLevel } from "@/lib/daily/journal";
import { noteHrefById } from "@/lib/shell/routes";
import { DAILY_NOTES, MOCK_TODAY, dailyStreakNow, isLiveData, noteById } from "@/lib/workspace-data";
import { MOCK_ENTRY_DATES } from "@/lib/mock/journal";
import { useShell } from "@/lib/shell/store";
import { useLook } from "@/components/theme/look";
import { JournalRuhe } from "./JournalRuhe";

/*
 * Tagebuch, tab Tag (Feinschliff Live, prototype "TAGEBUCH"): one panel with two columns. Left: today's entry (the
 * daily note's Mind Dump, saved automatically), three writing prompts, the check-in (energy 1-10) and the
 * file path with "Als Notiz öffnen". Right: the 12-week writing heat map, this week's days with the streak and the
 * way to the Home check-in. Below: the earlier daily notes. Home and the journal edit the same file
 * `10_Notes/Daily/<date>.md`.
 */

const PROMPTS = [msg("What am I grateful for?"), msg("What was hard today?"), msg("What do I take away?")];
const WD = [msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun")];
const WD_LONG = [msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday"), msg("Sunday")];
const PAST_STEP = 10;

/** "Donnerstag, 22. Oktober 2026" for an ISO day. */
const longDay = (iso: string) =>
  new Intl.DateTimeFormat(intlLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));

const statusText = (state: SaveState): string => {
  switch (state) {
    case "loading":
      return t("Loading…");
    case "dirty":
      return t("Unsaved change");
    case "saving":
      return tx("journal", "Saving…");
    case "saved":
      return t("Saved automatically");
    case "error":
      return t("Saving failed");
    default:
      return "";
  }
};

/** Tagebuch, tab Tag: the Ruhe page (JournalRuhe.tsx) or the earlier panel in the Vivid look. */
export function JournalView() {
  return useLook() === "ruhe" ? <JournalRuhe /> : <JournalClassic />;
}

function JournalClassic() {
  const { openNote, setSplit, showToast } = useShell();
  const live = isLiveData();
  const today = MOCK_TODAY;
  const day = useJournalDay(today);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [pastLimit, setPastLimit] = useState(PAST_STEP);
  const [opening, setOpening] = useState(false);

  // Context menu on the earlier entries: open, split, link, export as a note, delete with undo.
  const cm = useContextMenu<string>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = pending.current;
    return () => {
      // Leaving the page keeps a delete that already waited for its undo window pending: run it now.
      const ids = [...timers.keys()];
      for (const t of new Set(timers.values())) clearTimeout(t);
      timers.clear();
      if (ids.length && live) void deleteItems(ids);
    };
  }, [live]);
  const runEntry = async (action: ActionId, id: string) => {
    switch (action) {
      case "open":
        openNote(id);
        return;
      case "open-split":
        openNote(id);
        setSplit(true);
        return;
      case "copy-link":
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${noteHrefById(id)}`);
          showToast(t("Link copied"));
        } catch {
          showToast(t("Could not copy the link"));
        }
        return;
      case "export-note": {
        if (!live) {
          showToast(t("Demo: the entry would be created as a note in 10_Notes"));
          return;
        }
        const r = await duplicateAsNote(id);
        if (r.ok) showToast(t("Exported as note"), { label: tx("verb", "Open"), run: () => openNote(r.data.id) });
        else showToast(t("Not exported: {error}", { error: r.error }));
        return;
      }
      case "delete": {
        setHidden((h) => new Set(h).add(id));
        const timer = setTimeout(() => {
          pending.current.delete(id);
          if (live) {
            void deleteItems([id]).then((r) => {
              if (!r.ok) {
                setHidden((h) => new Set([...h].filter((x) => x !== id)));
                showToast(t("Not deleted: {error}", { error: r.error }));
              }
            });
          }
        }, 6400);
        pending.current.set(id, timer);
        showToast(t("Entry deleted"), {
          label: t("Undo"),
          run: () => {
            clearTimeout(timer);
            pending.current.delete(id);
            setHidden((h) => new Set([...h].filter((x) => x !== id)));
          },
        });
        return;
      }
      default:
        return;
    }
  };

  const wroteToday = day.text.trim().length > 0;
  // Days with a daily note (mock: plus the prototype's earlier entries of this week).
  const noteByDate = new Map(DAILY_NOTES.map((d) => [d.date, d.id]));
  const extraDates = useMemo(() => new Set(live ? [] : MOCK_ENTRY_DATES), [live]);
  const heat = heatCells(today, (date) => {
    if (date === today) return writingLevel(!!noteByDate.get(date) || wroteToday, day.text);
    const id = noteByDate.get(date);
    return writingLevel(!!id || extraDates.has(date), id ? dailyText(id) : "");
  });
  const monday = mondayOf(today);
  const week = WD.map((wd, i) => {
    const date = addDays(monday, i);
    const on = date === today ? wroteToday || noteByDate.has(date) : noteByDate.has(date) || extraDates.has(date);
    return { wd, date, on, now: date === today };
  });
  const weekDone = week.filter((d) => d.on).map((d) => t(WD_LONG[WD.indexOf(d.wd)] ?? d.wd));
  const streak = dailyStreakNow();

  // Earlier days only: today is the editable entry above.
  const past = DAILY_NOTES.filter((d) => d.date < today && !hidden.has(d.id)).flatMap((d) => {
    const n = noteById(d.id);
    if (!n) return [];
    const energy = (d as { energy?: number | null }).energy;
    const text = dailyText(d.id);
    const sub = n.tldr?.trim() || [energy ? t("Energy {n}/10.", { n: energy }) : "", text].filter(Boolean).join(" ") || t("Check-in only, no text");
    return [{ id: d.id, title: n.title, sub, when: entryWhen(d.date, n.time, today) }];
  });

  const addPrompt = (p: string) => {
    day.changeText(appendPrompt(day.text, p));
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    });
  };

  const openToday = async () => {
    setOpening(true);
    try {
      await day.saveNow();
      if (day.noteId) return openNote(day.noteId);
      if (!live) return showToast(t("Demo: the daily note is created with the first saved entry"));
      const d = await ensureDailyNote(today, DAILY_NOTES);
      if (d.id) openNote(d.id);
    } catch {
      showToast(t("Could not open the daily note"));
    } finally {
      setOpening(false);
    }
  };

  const energy = day.checkin.energy;
  return (
    <div className="jr">
      <JournalTabs tab="day" />

      <section className="jr-main" aria-label={t("Today's entry")}>
        <div className="jr-col">
          <label htmlFor="journal-today" className="jr-date">
            {t("Today · {date}", { date: longDay(today) })}
          </label>
          <textarea
            ref={ta}
            id="journal-today"
            className="jr-ta"
            value={day.text}
            onChange={(e) => day.changeText(e.target.value)}
            disabled={day.state === "loading"}
            placeholder={t("What's on your mind today? One line per thought.")}
          />
          <div className="jr-prompts" role="group" aria-label={t("Writing prompts")}>
            {PROMPTS.map((p) => (
              <button key={p} type="button" className="jr-fbtn" onClick={() => addPrompt(t(p))} disabled={day.state === "loading"}>
                <Ico name="plus" />
                {t(p)}
              </button>
            ))}
          </div>
          <div className="jr-check" role="group" aria-label="Check-in">
            <div className="jr-check-row">
              <span className="jr-lbl" id="jr-energy">
                {t("Energy")}
              </span>
              <div className="jr-edots" role="radiogroup" aria-labelledby="jr-energy">
                {Array.from({ length: 10 }, (_, i) => {
                  const v = i + 1;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={energy === v}
                      aria-label={t("Energy {n}", { n: v })}
                      title={t("Energy {n}", { n: v })}
                      className={energy != null && v <= energy ? "is-on" : ""}
                      onClick={() => day.change((c) => pickEnergy(c, v), ["energy"])}
                    />
                  );
                })}
              </div>
              <span className="jr-meta jr-num">{energy != null ? `${energy}/10` : "–/10"}</span>
            </div>
          </div>
          <div className="jr-foot">
            <span className="jr-path">{dailyPath(today)}</span>
            <span className="jr-meta" aria-live="polite" style={day.state === "error" ? { color: "var(--status-urgent-text)" } : undefined}>
              {statusText(day.state)}
              {day.state === "error" && day.error ? `: ${day.error}` : ""}
              {day.state === "saved" && !day.live ? ` (${t("local")})` : ""}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="jr-btn" onClick={() => void openToday()} disabled={opening}>
              <Ico name="square-pen" />
              {t("Open as note")}
            </button>
          </div>
        </div>

        <div className="jr-col jr-side">
          <div className="jr-block">
            <div className="jr-h">{t("Last 12 weeks")}</div>
            <div className="jr-heat" role="img" aria-label={t("Writing activity of the last 12 weeks")}>
              {heat.map((c) => (
                <i key={c.date} className={[c.isFuture ? "fut" : c.level ? `l${c.level}` : "", c.isToday ? "today" : ""].filter(Boolean).join(" ")} title={c.isFuture ? undefined : c.date} />
              ))}
            </div>
          </div>
          <div className="jr-block">
            <div className="jr-h">{t("This week")}</div>
            <div className="jr-week-row">
              <div className="jr-wdots" role="img" aria-label={weekDone.length ? t("Entry on: {days}", { days: weekDone.join(", ") }) : t("No entry yet this week")}>
                {week.map((d) => (
                  <span key={d.date}>
                    <i className={[d.on ? "on" : "", d.now ? "now" : ""].filter(Boolean).join(" ")} />
                    {t(d.wd)}
                  </span>
                ))}
              </div>
              <span className="jr-streak">
                <Ico name="flame" />
                <span>
                  <span className="jr-num jr-streak-n" data-testid="streak-value">
                    {streak}
                  </span>{" "}
                  <span className="jr-meta">{streak === 1 ? t("day streak") : t("days streak")}</span>
                </span>
              </span>
            </div>
          </div>
          <Link href="/home" className="jr-lnk" title={t("Energy and top 3 in the check-in on Home: the same daily note")}>
            <Ico name="home" />
            {t("Check-in on Home too")}
          </Link>
        </div>
      </section>

      <div className="jr-pastwrap">
        <div className="jr-lbl" style={{ padding: "0 12px" }}>
          {t("Earlier entries")}
        </div>
        {!past.length && (
          <p className="jr-meta" style={{ margin: 0, padding: "0 12px" }}>
            {t("No earlier daily notes yet. Every day you capture here or in the check-in on Home appears in this list afterwards.")}
          </p>
        )}
        <div className="jr-past">
          {past.slice(0, pastLimit).map((p) => (
            <button
              key={p.id}
              type="button"
              className="jr-pi"
              onClick={() => openNote(p.id)}
              onContextMenu={cm.bind(p.id).onContextMenu}
              onKeyDown={(e) => isContextMenuKey(e) && cm.bind(p.id).onKeyDown(e)}
            >
              <span className="jr-dot" aria-hidden />
              <span style={{ minWidth: 0 }}>
                <span className="jr-pi-t">{p.title}</span>
                <span className="jr-pi-s">{p.sub}</span>
              </span>
              <span className="jr-meta" style={{ whiteSpace: "nowrap" }}>
                {p.when}
              </span>
            </button>
          ))}
        </div>
        {past.length > pastLimit && (
          <button type="button" className="jr-lnk" style={{ alignSelf: "flex-start", marginLeft: 6 }} onClick={() => setPastLimit((n) => n + PAST_STEP)}>
            {t("Show older entries ({n})", { n: past.length - pastLimit })}
          </button>
        )}
      </div>
      <ContextMenu at={cm.menu?.at ?? null} label={t("Journal entry")} sections={menuFor({ kind: "journal-entry" })} onAction={(id) => cm.menu && void runEntry(id, cm.menu.target)} onClose={cm.close} />
    </div>
  );
}
