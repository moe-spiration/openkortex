"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Home, NotebookPen, Plus, Sparkles, SquarePen, X } from "lucide-react";
import { dailyPath, ensureDailyNote, pickEnergy, storedCheckin, type DailyFocus } from "@/components/home/daily";
import { energyNotes } from "@/components/home/overview";
import { TypeIcon } from "@/components/note/icons";
import { BarIconButton, LocationBar } from "@/components/shell/Bars";
import { MenuItem } from "@/components/ui/primitives";
import { addDays, averageLabel, entryWhen, isoWeekNumber, mondayOf } from "@/lib/daily/journal";
import { energyLevel, energyOfLevel, joinEntry, splitEntry } from "@/lib/daily/journal-ruhe";
import { coverSrc, NOTE_COVER } from "@/lib/mock/views";
import { JOURNAL_WEEK_HREF } from "@/lib/shell/nav";
import { useShell } from "@/lib/shell/store";
import { DAILY_NOTES, MOCK_TODAY, NOTES, OBJECT_ITEMS, isLiveData, noteById, type ItemType } from "@/lib/workspace-data";
import { MOCK_ENTRY_DATES } from "@/lib/mock/journal";
import { intlLocale, msg, t, tx } from "@/i18n";
import { dailyText } from "./dailyText";
import { useJournalDay, type SaveState } from "./useJournalDay";
import { EmptyPic } from "@/components/motion/EmptyPic";

/*
 * Tagebuch, tab Tag, in the Ruhe look (2026-11-27, mockup screen "tagebuch"): location bar "Tagebuch › <day>" with
 * previous / next day and "Wochenrückblick", the weekday as title, a week strip Mo to So with an energy bar per day,
 * energy 1 to 5, the labelled questions "Was war heute wichtig?" and "Wofür bin ich dankbar?" and "Morgen" as a
 * checklist (the top 3 of the next day's daily note). On the right: what the entry mentions, the entry of a year ago
 * and a sentence about the week. Everything is still `10_Notes/Daily/<date>.md` (lib/daily/journal-ruhe.ts says how
 * the fields map onto it). Styles: packages/ui/src/styles/ruhe-journal.css.
 */

const WD = [msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun")];

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(), { ...o, timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));

const saveText = (state: SaveState, error: string | null, live: boolean): string => {
  if (state === "dirty" || state === "saving") return tx("journal", "Saving…");
  if (state === "saved") return live ? t("Saved") : t("Saved (local)");
  if (state === "error") return error ? `${t("Saving failed")}: ${error}` : t("Saving failed");
  return "";
};

/** Energy 1..10 of a day from the daily notes' check-ins (Home's evaluation) or the local copy; null when unknown. */
function energyOn(date: string, live: boolean, known: ReadonlyMap<string, number | null>): number | null {
  const e = known.get(date);
  if (typeof e === "number") return e;
  return storedCheckin(date, live)?.energy ?? null;
}

export function JournalRuhe() {
  const today = MOCK_TODAY;
  const [date, setDate] = useState(today);
  return <JournalDayRuhe key={date} date={date} today={today} onDate={(d) => setDate(d > today ? today : d)} />;
}

function JournalDayRuhe({ date, today, onDate }: { date: string; today: string; onDate: (d: string) => void }) {
  const { openNote, showToast } = useShell();
  const router = useRouter();
  const live = isLiveData();
  const day = useJournalDay(date);
  const next = useJournalDay(addDays(date, 1));
  const [fields, setFields] = useState<{ important: string; grateful: string } | null>(null);
  const [newItem, setNewItem] = useState("");
  const [opening, setOpening] = useState(false);
  const shown = fields ?? splitEntry(day.text);
  const prefix = t("What am I grateful for?");
  const loading = day.state === "loading";

  const edit = (patch: Partial<{ important: string; grateful: string }>) => {
    const f = { ...shown, ...patch };
    setFields(f);
    day.changeText(joinEntry(f.important, f.grateful, prefix));
  };

  const level = energyLevel(day.checkin.energy);
  const noteByDate = useMemo(() => new Map(DAILY_NOTES.map((d) => [d.date, d.id])), []);
  const extra = useMemo(() => new Set(live ? [] : MOCK_ENTRY_DATES), [live]);
  const known = useMemo(() => new Map(energyNotes(today).map((n) => [n.date, n.energy])), [today]);
  const monday = mondayOf(date);
  const week = WD.map((wd, i) => {
    const d = addDays(monday, i);
    const energy = d === date ? day.checkin.energy : energyOn(d, live, known);
    const wrote = d === date ? !!day.text.trim() || noteByDate.has(d) : noteByDate.has(d) || extra.has(d);
    return { wd, date: d, n: Number(d.slice(8)), level: energyLevel(energy), wrote, future: d > today };
  });
  const weekLevels = week.filter((w) => !w.future).map((w) => w.level);
  const avg = averageLabel(weekLevels);
  const entries = week.filter((w) => w.wrote).length;

  // "Heute erwähnt": objects and entries whose title the text names, and [[wiki links]].
  const mentioned = useMemo(() => {
    const text = day.text.toLowerCase();
    if (!text.trim()) return [];
    const out: { id: string; title: string; type: ItemType }[] = [];
    const seen = new Set<string>();
    const wiki = [...day.text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1]!.trim().toLowerCase());
    for (const o of [...OBJECT_ITEMS, ...NOTES]) {
      if (seen.has(o.id) || o.title.length < 4 || /^daily journal/i.test(o.title)) continue;
      const title = o.title.toLowerCase();
      if (wiki.includes(title) || text.includes(title)) {
        seen.add(o.id);
        out.push({ id: o.id, title: o.title, type: o.type });
      }
      if (out.length >= 6) break;
    }
    return out;
  }, [day.text]);

  // "Vor einem Jahr": the daily note of the same day a year ago (a few days around it), with its text and cover.
  const yearAgo = useMemo(() => {
    const target = addDays(date, -365);
    for (const off of [0, -1, 1, -2, 2, -3, 3]) {
      const d = addDays(target, off);
      const id = noteByDate.get(d);
      if (!id) continue;
      const n = noteById(id);
      const text = dailyText(id) || n?.tldr || "";
      if (!text) continue;
      const cover = NOTE_COVER[id];
      return { id, text, date: d, img: cover ? coverSrc(cover) : null };
    }
    return null;
  }, [date, noteByDate]);

  // Earlier days with an entry (the journal walks there; the note itself opens from "…").
  const past = DAILY_NOTES.filter((d) => d.date < date)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 4)
    .map((d) => ({ date: d.date, title: entryWhen(d.date, noteById(d.id)?.time ?? "", today), sub: dailyText(d.id) || noteById(d.id)?.tldr || "" }));

  const tomorrow: DailyFocus[] = next.checkin.focus;
  const setTomorrow = (focus: DailyFocus[]) => next.change((c) => ({ ...c, focus }), ["focus"]);
  const addTomorrow = () => {
    const text = newItem.trim();
    if (!text) return;
    setTomorrow([...tomorrow, { key: `j-${Date.now().toString(36)}`, text, done: false }]);
    setNewItem("");
  };

  const openNoteOfDay = async () => {
    setOpening(true);
    try {
      await day.saveNow();
      if (day.noteId) return openNote(day.noteId);
      if (!live) return showToast(t("Demo: the daily note is created with the first saved entry"));
      const d = await ensureDailyNote(date, DAILY_NOTES);
      if (d.id) openNote(d.id);
    } catch {
      showToast(t("Could not open the daily note"));
    } finally {
      setOpening(false);
    }
  };

  const isToday = date === today;
  const weekday = fmt(date, { weekday: "long" });
  return (
    <div className="rz-jr">
      <LocationBar
        icon={<NotebookPen aria-hidden size={14} strokeWidth={1.75} />}
        crumbs={[isToday ? { label: t("Journal") } : { label: t("Journal"), onClick: () => onDate(today) }, { label: fmt(date, { weekday: "long", day: "numeric", month: "long" }) }]}
        actions={
          <>
            <BarIconButton icon={<ChevronLeft aria-hidden size={15} strokeWidth={1.75} />} label={t("Previous day")} title={t("Previous day")} onClick={() => onDate(addDays(date, -1))} />
            <BarIconButton icon={<ChevronRight aria-hidden size={15} strokeWidth={1.75} />} label={t("Next day")} title={t("Next day")} disabled={isToday} onClick={() => onDate(addDays(date, 1))} />
            <Link href={JOURNAL_WEEK_HREF} className="rz-bbtn rz-bbtn--ghost">
              <Sparkles aria-hidden size={14} strokeWidth={1.75} />
              {t("Weekly review")}
            </Link>
          </>
        }
        more={
          <>
            <MenuItem onSelect={() => void openNoteOfDay()}>
              <SquarePen aria-hidden size={14} strokeWidth={1.75} />
              {opening ? t("Loading…") : t("Open as note")}
            </MenuItem>
            {!isToday && (
              <MenuItem onSelect={() => onDate(today)}>
                <NotebookPen aria-hidden size={14} strokeWidth={1.75} />
                {t("To today")}
              </MenuItem>
            )}
            <MenuItem onSelect={() => router.push("/home")}>
              <Home aria-hidden size={14} strokeWidth={1.75} />
              {t("Check-in on Home too")}
            </MenuItem>
          </>
        }
      />

      <div className="rz-jr-body">
        <section className="rz-jr-main" aria-label={t("Today's entry")}>
          <div className="rz-jr-page">
            <h1 className="rz-jr-day">{weekday}</h1>
            <div className="rz-jr-sub">
              {t("{date} · week {week}", { date: fmt(date, { day: "numeric", month: "long", year: "numeric" }), week: isoWeekNumber(date) })}
              <span className="rz-jr-save" aria-live="polite">
                {saveText(day.state, day.error, live)}
              </span>
            </div>

            <div className="rz-jr-wk" role="group" aria-label={t("This week")}>
              {week.map((w) => (
                <button
                  key={w.date}
                  type="button"
                  className="rz-jr-wd"
                  aria-current={w.date === date ? "date" : undefined}
                  aria-label={fmt(w.date, { weekday: "long", day: "numeric", month: "long" }) + (w.level ? ` · ${t("Energy {n}", { n: w.level })}` : "")}
                  disabled={w.future}
                  onClick={() => onDate(w.date)}
                >
                  <span>{t(w.wd)}</span>
                  <b>{w.n}</b>
                  <i data-level={w.level ?? (w.wrote ? "w" : "")} />
                </button>
              ))}
            </div>

            <div className="rz-jr-q" id="rz-jr-energy">
              {t("Energy")}
            </div>
            <div className="rz-jr-mood" role="radiogroup" aria-labelledby="rz-jr-energy">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={level === n}
                  aria-label={t("Energy {n}", { n })}
                  disabled={loading}
                  onClick={() => day.change((c) => pickEnergy(c, energyOfLevel(n)), ["energy"])}
                >
                  {n}
                </button>
              ))}
            </div>

            <label className="rz-jr-q" htmlFor="rz-jr-important">
              {t("What was important today?")}
            </label>
            <textarea
              id="rz-jr-important"
              className="rz-jr-t"
              rows={3}
              value={shown.important}
              disabled={loading}
              placeholder={t("What's on your mind today? One line per thought.")}
              onChange={(e) => edit({ important: e.target.value })}
            />
            <label className="rz-jr-q" htmlFor="rz-jr-grateful">
              {t("What am I grateful for?")}
            </label>
            <textarea
              id="rz-jr-grateful"
              className="rz-jr-t"
              rows={1}
              value={shown.grateful}
              disabled={loading}
              placeholder={t("One thing is enough.")}
              onChange={(e) => edit({ grateful: e.target.value })}
            />

            <div className="rz-jr-q" id="rz-jr-tomorrow">
              {t("Tomorrow")}
            </div>
            <ul className="rz-jr-todo" aria-labelledby="rz-jr-tomorrow">
              {tomorrow.map((f) => (
                <li key={f.key}>
                  <input
                    type="checkbox"
                    className="rz-jr-chk"
                    checked={f.done}
                    aria-label={f.text}
                    onChange={() => setTomorrow(tomorrow.map((x) => (x.key === f.key ? { ...x, done: !x.done } : x)))}
                  />
                  <span className={f.done ? "is-done" : undefined}>{f.text}</span>
                  <button type="button" className="rz-icon rz-jr-rm" aria-label={t("Remove “{title}”", { title: f.text })} onClick={() => setTomorrow(tomorrow.filter((x) => x.key !== f.key))}>
                    <X size={13} strokeWidth={1.75} />
                  </button>
                </li>
              ))}
              <li className="rz-jr-add">
                <Plus aria-hidden size={14} strokeWidth={1.75} />
                <input
                  value={newItem}
                  aria-label={t("For tomorrow")}
                  placeholder={t("For tomorrow …")}
                  disabled={next.state === "loading"}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTomorrow();
                    }
                  }}
                />
              </li>
            </ul>
          </div>
        </section>

        <aside className="rz-jr-aside">
          <section>
            <h2 className="rz-jr-lab">{isToday ? t("Mentioned today") : t("Mentioned that day")}</h2>
            {mentioned.length ? (
              mentioned.map((m) => (
                <button key={m.id} type="button" className="rz-jr-link" onClick={() => openNote(m.id)}>
                  <TypeIcon type={m.type} size={14} />
                  <span>{m.title}</span>
                </button>
              ))
            ) : (
              <p className="rz-jr-none">{t("Names of people, meetings and projects in your entry appear here.")}</p>
            )}
          </section>
          <section>
            <h2 className="rz-jr-lab">{t("A year ago")}</h2>
            {yearAgo ? (
              <button type="button" className="rz-jr-year" onClick={() => onDate(yearAgo.date)}>
                {yearAgo.img && <span className="rz-jr-year-img" style={{ backgroundImage: `url(${yearAgo.img})` }} aria-hidden />}
                <span className="rz-jr-year-t">{t("“{title}”", { title: yearAgo.text })}</span>
              </button>
            ) : (
              <EmptyPic kind="idea" size="sm">{t("No entry from a year ago yet.")}</EmptyPic>
            )}
          </section>
          <section>
            <h2 className="rz-jr-lab">{t("This week")}</h2>
            <p className="rz-jr-week">
              {[avg ? t("Energy on average {n}.", { n: avg }) : t("No energy noted yet."), t("{n} of 7 days written.", { n: entries })].join(" ")}
            </p>
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="rz-jr-lab">{t("Earlier entries")}</h2>
              {past.map((p) => (
                <button key={p.date} type="button" className="rz-jr-past" onClick={() => onDate(p.date)}>
                  <span className="rz-jr-past-t">{p.title}</span>
                  {p.sub && <span className="rz-jr-past-s">{p.sub}</span>}
                </button>
              ))}
            </section>
          )}
          <div className="rz-jr-path">{dailyPath(date)}</div>
        </aside>
      </div>
    </div>
  );
}
