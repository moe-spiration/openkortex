"use client";

import { msg, t } from "@/i18n";
import Link from "next/link";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { energyLabel } from "@kortex/db/daily";
import { Ico } from "@/components/shell/icons";
import { JOURNAL_DAY_HREF } from "@/lib/shell/nav";
import { pickEnergy, type DailyCheckin as Checkin } from "./daily";

/*
 * "Heute im Überblick" (Feinschliff Live `.panel.panel-cover`): a soft gradient cover, two tiles (streak with the
 * energy bars of the last days, energy picker 1-10) and the "Top 3 heute" checklist. Every change goes through
 * `onChange`, which saves the existing daily check-in (`10_Notes/Daily/YYYY-MM-DD.md`, components/home/daily.ts).
 * Habits are not tracked in Kortex (they live in Griply).
 */

/** One bar of the history: energy 1-10 or null (no check-in that day). */
export interface EnergyDay {
  date: string;
  energy: number | null;
}

const WEEKDAY = [msg("Sun"), msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat")];
const weekdayOf = (iso: string) => {
  const wd = WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  return wd ? t(wd) : "";
};
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Energy picker 1-10: click or arrow keys pick, hover previews the value and its word ("Gut"). */
export function EnergyPicker({ value, onPick }: { value: number | null; onPick: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = hover ?? value;
  const focusAt = (v: number) => refs.current[v - 1]?.focus();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = value ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(10, cur + 1 || 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, cur - 1 || 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 10;
    if (next === null) return;
    e.preventDefault();
    onPick(next);
    focusAt(next);
  };
  return (
    <>
      <div className="hm-stat-head">
        <span className="e-micro">{t("Energy")}</span>
        <span className="e-meta" aria-live="polite">
          {shown ? energyLabel(shown) : t("How are you?")}
        </span>
      </div>
      <div className="hm-v">
        {shown ?? "–"}
        <small> / 10</small>
      </div>
      <div className="hm-energy" role="radiogroup" aria-label={t("Energy today, 1 to 10")} onMouseLeave={() => setHover(null)} onKeyDown={onKey}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const checked = value === n;
          const lit = n <= (shown ?? 0);
          const preview = hover !== null && hover !== value && lit;
          return (
            <button
              key={n}
              ref={(el) => {
                refs.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={t("Energy {n} of 10, {label}", { n, label: energyLabel(n) })}
              tabIndex={checked || (value === null && n === 1) ? 0 : -1}
              className={preview ? "is-preview" : lit ? "is-on" : undefined}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(null)}
              onClick={() => onPick(n)}
            />
          );
        })}
      </div>
    </>
  );
}

export function TodayOverview({
  checkin,
  streak,
  history,
  now,
  onChange,
  style,
}: {
  checkin: Checkin;
  /** Days in a row with a daily note (the shared streak value; computed elsewhere, W6). */
  streak: number;
  /** Last days, oldest first, today last. */
  history: EnergyDay[];
  now: Date | null;
  onChange: (fn: (c: Checkin) => Checkin) => void;
  style?: CSSProperties;
}) {
  return (
    <section className="hm-bx hm-today fs-home-today" aria-label={t("Today at a glance")} style={style}>
      {/* Feinschliff Live `.panel-cover .cover`: a soft accent/teal/rose gradient fading out downwards, no photo. */}
      <div className="hm-today-bg fs-home-cover" aria-hidden />
      <div className="hm-today-in">
        <div className="hm-bx-h">
          <h2 className="e-h2">{t("Today at a glance")}</h2>
          {/* fx3: the check-in is part of the journal: same daily note, written on there (Tagebuch, tab Tag). */}
          <span className="kxh-row" style={{ gap: 10 }}>
            <span className="e-meta e-num">{now ? t("As of {time}", { time: hhmm(now) }) : ""}</span>
            <Link href={JOURNAL_DAY_HREF} className="kx-btn kx-btn--ghost kx-btn--sm" title={t("Capture the day's thoughts in the same daily note")}>
              <Ico name="sun" />
              {t("Continue in the journal")}
            </Link>
          </span>
        </div>
        <div className="hm-stats">
          <div className="hm-stat fs-home-stat">
            <span className="e-micro">Streak</span>
            <div className="hm-v">
              <span data-testid="streak-value">{streak}</span>
              <small> {streak === 1 ? t("day") : t("days")}</small>
            </div>
            <div className="hm-bars" role="list" aria-label={t("Energy of the last {n} days", { n: history.length })}>
              {history.map((d) => {
                const label = `${weekdayOf(d.date)}: ${d.energy ? t("Energy {n} of 10", { n: d.energy }) : t("no check-in")}`;
                return (
                  <span
                    key={d.date}
                    role="listitem"
                    title={label}
                    aria-label={label}
                    className={d.energy ? "is-on" : undefined}
                    style={{ height: d.energy ? `${Math.max(18, d.energy * 10)}%` : "12%" }}
                  />
                );
              })}
            </div>
          </div>
          <div className="hm-stat fs-home-stat">
            <EnergyPicker value={checkin.energy} onPick={(v) => onChange((c) => pickEnergy(c, v))} />
          </div>
        </div>
        <div className="fs-home-top3">
          <div className="e-micro" style={{ padding: "0 8px 6px" }}>
            {t("Top 3 today")}
          </div>
          {checkin.focus.length === 0 && <span className="e-meta" style={{ padding: "0 8px 6px", display: "block" }}>{t("No open tasks.")}</span>}
          {checkin.focus.map((f) => (
            <button
              key={f.key}
              type="button"
              role="checkbox"
              aria-checked={f.done}
              className={"hm-trow" + (f.done ? " is-done" : "")}
              onClick={() => onChange((c) => ({ ...c, focus: c.focus.map((x) => (x.key === f.key ? { ...x, done: !x.done } : x)) }))}
            >
              <span className={"hm-cb" + (f.done ? " is-on" : "")} aria-hidden>
                {f.done && <Check className="kx-ico" />}
              </span>
              <span className="hm-trow-t e-clamp1">{f.text}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
