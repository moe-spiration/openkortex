"use client";

import { useState } from "react";
import { monthName, weekdayShort } from "@/lib/date/words";
import { t, tn } from "@/i18n";

/* Timeline calendar (design/reference/Calendar.dc.html): month grid and week columns, hairline separators (V2-06). */

export interface CalEntry {
  id: string;
  /** ISO day. */
  date: string;
  title: string;
  /** CSS colour of the entry dot. */
  dot: string;
  time: string;
}

/** Monday first: indices for `weekdayShort` (0 = Sunday). */
const DOW = [1, 2, 3, 4, 5, 6, 0];
const DAY = 864e5;
/**
 * Height of the day area. The month (up to six rows) and the week share it, so the panel never changes height when the
 * view switches (A-23). Feedback round 2 #8: the panel is about 40 % lower (whole panel about 220 px) and sticks to the
 * top of the Space while the timeline scrolls, so month rows hold the date and dots side by side.
 */
const ROW_H = 22;
const BODY_H = 6 * ROW_H;
/** Whole panel height with the Monat / Woche switch (padding, header, weekdays, day area); SpaceView offsets its jump anchors by it. */
export const CALENDAR_PANEL_H = 220;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const dowIdx = (d: Date) => (d.getUTCDay() + 6) % 7;
const dayLabel = (d: Date) => t("{month} {day}", { day: d.getUTCDate(), month: monthName(d.getUTCMonth()) });

function isoWeek(d: Date): number {
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  thu.setUTCDate(thu.getUTCDate() - ((thu.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((thu.getTime() - firstThu.getTime()) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

export function TimelineCalendar({
  entries,
  selected,
  today,
  onPick,
  onOpen,
  initialMode = "week",
  hideMonth,
  compact,
}: {
  entries: CalEntry[];
  selected?: string;
  today: string;
  onPick?: (date: string) => void;
  onOpen?: (id: string) => void;
  initialMode?: "month" | "week";
  /** Week only (tasks hub): no Monat / Woche switch. */
  hideMonth?: boolean;
  /** Week only: shorter day columns (two entries per day), so the page below stays in view. */
  compact?: boolean;
}) {
  // The week-only hub (compact) sizes itself; the calendar with the Monat / Woche switch keeps one fixed day area.
  const fixed = !compact && !hideMonth;
  const perDay = compact ? 2 : fixed ? 3 : 4;
  const [state, setState] = useState<{ sel?: string; cursor?: string; mode: "month" | "week" }>({ mode: initialMode });
  const mode = state.mode;
  const sel = state.sel ?? selected ?? today;
  const cursor = parse(state.cursor ?? sel);

  const byDay: Record<string, CalEntry[]> = {};
  entries.forEach((e) => (byDay[e.date] ??= []).push(e));
  Object.values(byDay).forEach((l) => l.sort((a, b) => (a.time < b.time ? 1 : -1)));

  const pick = (ds: string) => {
    setState((s) => ({ ...s, sel: ds, cursor: ds }));
    onPick?.(ds);
  };

  // Month
  const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const start = new Date(first.getTime() - dowIdx(first) * DAY);
  const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  const total = Math.ceil((dowIdx(first) + lastDay) / 7) * 7;
  const cells = Array.from({ length: total }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY);
    const ds = iso(d);
    const list = byDay[ds] ?? [];
    const inMonth = d.getUTCMonth() === cursor.getUTCMonth();
    const isSel = ds === sel;
    const isToday = ds === today;
    return { d, ds, list, inMonth, isSel, isToday };
  });

  // Week
  const wsrc = state.cursor && mode === "week" ? parse(state.cursor) : parse(sel);
  const weekStart = new Date(wsrc.getTime() - dowIdx(wsrc) * DAY);
  const weekEnd = new Date(weekStart.getTime() + 6 * DAY);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * DAY);
    const ds = iso(d);
    return { d, ds, list: byDay[ds] ?? [], isSel: ds === sel, isToday: ds === today };
  });

  const monthKey = iso(first).slice(0, 7);
  const monthCount = entries.filter((e) => e.date.slice(0, 7) === monthKey).length;
  const activeDays = Object.keys(byDay).filter((k) => k.slice(0, 7) === monthKey).length;

  const shift = (months: number, days: number) => {
    const c = parse(state.cursor ?? sel);
    const n = months ? new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + months, 1)) : new Date(c.getTime() + days * DAY);
    setState((s) => ({ ...s, cursor: iso(n) }));
  };

  const isMonth = mode === "month";
  const title = isMonth ? `${monthName(cursor.getUTCMonth())} ${cursor.getUTCFullYear()}` : t("{from} to {to}", { from: weekStart.getUTCDate(), to: dayLabel(weekEnd) });
  const summary = isMonth ? t("{entries} entries on {days} days", { entries: monthCount, days: activeDays }) : t("Week {n}", { n: isoWeek(weekStart) });
  const prevLabel = isMonth ? t("Previous month") : t("Previous week");
  const nextLabel = isMonth ? t("Next month") : t("Next week");

  const line = "var(--border-subtle)";
  const chev = (d: string) => (
    <svg className="kx-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );

  return (
    <section
      aria-label={t("Calendar")}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr)",
        gap: fixed ? 8 : 12,
        minWidth: 0,
        height: fixed ? CALENDAR_PANEL_H : undefined,
        boxSizing: "border-box",
        alignContent: "start",
        padding: fixed ? "10px 14px" : 16,
        borderRadius: 16,
        background: "var(--bg-surface-flat)",
        boxShadow: "none",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, minHeight: 32 }}>
        <h2 className="kx-h-section" style={{ margin: 0, minWidth: 190 }}>
          {title}
        </h2>
        <div className="kxh-row" style={{ gap: 2 }}>
          <button type="button" className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm" aria-label={prevLabel} onClick={() => (isMonth ? shift(-1, 0) : shift(0, -7))}>
            {chev("M15 6l-6 6 6 6")}
          </button>
          <button type="button" className="kx-btn kx-btn--ghost kx-btn--icon kx-btn--sm" aria-label={nextLabel} onClick={() => (isMonth ? shift(1, 0) : shift(0, 7))}>
            {chev("M9 6l6 6-6 6")}
          </button>
        </div>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => pick(today)}>
          {t("Today")}
        </button>
        <span className="kx-meta" style={{ flex: "1 1 140px", minWidth: 0 }}>
          {summary}
        </span>
        {!hideMonth && (
          <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Calendar view")}>
            <button type="button" className="kx-tab" role="tab" aria-selected={isMonth} onClick={() => setState((s) => ({ ...s, mode: "month", cursor: sel }))}>
              {t("Month")}
            </button>
            <button type="button" className="kx-tab" role="tab" aria-selected={!isMonth} onClick={() => setState((s) => ({ ...s, mode: "week", cursor: sel }))}>
              {t("Week")}
            </button>
          </div>
        )}
      </div>

      {/* Weekday labels share the 7-column track of the grid below (V2-06a: minmax(0,1fr), nothing may widen a column). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))" }}>
        {DOW.map((w) => (
          <span key={w} className="kx-meta" style={{ padding: "0 10px", minWidth: 0 }}>
            {weekdayShort(w)}
          </span>
        ))}
      </div>

      <div style={fixed ? { height: BODY_H, minHeight: 0, overflow: "hidden" } : undefined} data-cal-body={isMonth ? "month" : "week"}>
      {isMonth ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,minmax(0,1fr))",
            gridTemplateRows: fixed ? `repeat(${total / 7},minmax(0,1fr))` : undefined,
            height: fixed ? "100%" : undefined,
            borderTop: `1px solid ${line}`,
          }}
        >
          {cells.map((c, i) => (
            <button
              key={c.ds}
              type="button"
              className="kxb"
              aria-label={`${dayLabel(c.d)}, ${c.list.length ? tn(c.list.length, "{n} entry", "{n} entries") : t("no entries")}`}
              aria-pressed={c.isSel}
              onClick={() => pick(c.ds)}
              style={{
                display: "flex",
                flexDirection: fixed ? "row" : "column",
                justifyContent: fixed ? "flex-start" : "space-between",
                alignItems: fixed ? "center" : "flex-start",
                gap: fixed ? 6 : 2,
                height: fixed ? undefined : 52,
                minHeight: 0,
                minWidth: 0,
                padding: fixed ? "0 8px" : "8px 10px",
                background: "transparent",
                boxShadow: c.isSel ? "inset 0 0 0 1.5px var(--accent-ai)" : `${i % 7 ? `inset 1px 0 0 ${line}, ` : ""}inset 0 -1px 0 ${line}`,
                opacity: c.inMonth ? undefined : 0.4,
              }}
            >
              <span
                style={{
                  fontSize: "calc(13px * var(--kx-fs, 1))",
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                  color: c.isToday ? "var(--tag-ai-fg)" : c.list.length ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {c.d.getUTCDate()}
              </span>
              <span style={{ display: "flex", gap: 3, alignItems: "center", minHeight: 6 }}>
                {c.list.slice(0, 4).map((e) => (
                  <i key={e.id} style={{ display: "block", width: 5, height: 5, borderRadius: "50%", background: e.dot }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", height: fixed ? "100%" : undefined }}>
          {week.map((c, i) => (
            <div
              key={c.ds}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr)",
                gap: 4,
                alignContent: "start",
                minWidth: 0,
                minHeight: fixed ? 0 : compact ? 92 : 168,
                overflowY: fixed ? "auto" : undefined,
                padding: "2px 6px 6px",
                borderLeft: i ? `1px solid ${line}` : undefined,
              }}
            >
              <button
                type="button"
                className="kxb"
                aria-label={`${dayLabel(c.d)}, ${tn(c.list.length, "{n} entry", "{n} entries")}`}
                aria-pressed={c.isSel}
                onClick={() => pick(c.ds)}
                style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, width: "100%", padding: fixed ? "2px 4px" : "4px 4px", borderRadius: 8, minHeight: fixed ? 28 : 36 }}
              >
                <span
                  className="kx-h-section"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: c.isToday || c.isSel ? "var(--tag-ai-fg)" : "var(--text-primary)",
                  }}
                >
                  {c.d.getUTCDate()}
                </span>
                <span className="kx-meta" style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }}>
                  {c.list.length ? String(c.list.length) : ""}
                </span>
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 2, minWidth: 0 }}>
                {c.list.slice(0, perDay).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="kxb kx-noterow"
                    title={e.title}
                    onClick={() => onOpen?.(e.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      minWidth: 0,
                      height: "auto",
                      minHeight: fixed ? 24 : 28,
                      padding: "0 6px",
                      borderRadius: 8,
                      fontSize: "calc(12px * var(--kx-fs, 1))",
                      fontWeight: 400,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <i style={{ display: "block", flex: "none", width: 6, height: 6, borderRadius: "50%", background: e.dot }} />
                    <span className="kx-truncate" style={{ minWidth: 0, flex: "1 1 0", textAlign: "left" }}>
                      {e.title}
                    </span>
                  </button>
                ))}
                {c.list.length > perDay && (
                  <span className="kx-meta" style={{ padding: "0 6px", fontSize: "calc(12px * var(--kx-fs, 1))" }}>
                    {t("+{n} more", { n: c.list.length - perDay })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
