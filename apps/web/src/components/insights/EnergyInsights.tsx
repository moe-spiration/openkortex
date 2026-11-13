"use client";

import { useEffect, useMemo, useState } from "react";
import {
  energyCorrelations,
  energyDecimal,
  energyDelta,
  energyLabel,
  energySeries,
  energyStats,
  MIN_ENERGY_DAYS,
  type EnergyComparison,
  type EnergyPoint,
} from "@kortex/db/daily";
import { storedCheckin } from "@/components/home/daily";
import type { InsightsData, InsightsRange } from "@/lib/mock/insights";
import { energyFacts, insightsToday, mockEnergyDays, sparkPath, type StoredDay } from "./energy";
import { monthAbbr } from "@/components/views/entries";
import { t } from "@/i18n";

/*
 * Energie als Tagesmetrik (Tactile Craft decision 11): curve over the Insights range (7/30/90 days) in the
 * dummy's sparkline style (monochrome line, accent tint below, accent end point, fine grid,
 * tabular numbers) and the correlations with focus (Top 3) and output (new entries) as plain
 * mean comparisons. Source: the same daily check-ins as Home (`10_Notes/Daily/*.md`).
 */

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return t("{month} {day}", { day: d.getUTCDate(), month: monthAbbr(d.getUTCMonth()) });
};
/** Stored check-ins of the window (this device), read after mount. */
function useStoredDays(live: boolean, d: InsightsData, today: string | null): StoredDay[] {
  const [days, setDays] = useState<StoredDay[]>([]);
  useEffect(() => {
    if (!today) return;
    if (!live) return setDays(mockEnergyDays(d, today, 90));
    const out: StoredDay[] = [];
    for (let i = 0; i < 90; i++) {
      const date = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
      const c = storedCheckin(date, true);
      if (c) out.push(c);
    }
    setDays(out);
  }, [live, d, today]);
  return days;
}

function Side({ avg, n, hi, label }: { avg: number | null; n: number; hi: boolean; label: string }) {
  return (
    <span className="in-side">
      <span className="e-meta e-clamp1">
        {label} <span className="e-num">({n})</span>
      </span>
      <span className={"in-bar" + (hi ? " is-hi" : "")} aria-hidden>
        <i style={{ width: `${avg === null ? 0 : avg * 10}%` }} />
      </span>
      <span className="e-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--t2)" }}>
        {avg === null ? "–" : t("Ø {value}", { value: energyDecimal(avg) })}
      </span>
    </span>
  );
}

function CorrRow({ c }: { c: EnergyComparison }) {
  const up = c.delta !== null && c.delta > 0.05;
  const desc = c.enough && c.delta !== null
    ? t("{label}: Ø {withAvg} {withLabel}, Ø {withoutAvg} {withoutLabel}, difference {delta}", {
        label: c.label,
        withAvg: energyDecimal(c.withAvg!),
        withLabel: c.withLabel,
        withoutAvg: energyDecimal(c.withoutAvg!),
        withoutLabel: c.withoutLabel,
        delta: energyDelta(c.delta),
      })
    : t("{label}: too few days so far", { label: c.label });
  return (
    <div className="in-corr-row" role="row" aria-label={desc}>
      <span className="lbl e-clamp1" role="cell">
        {c.label}
      </span>
      <Side avg={c.withAvg} n={c.nWith} hi={!!c.enough && (c.delta ?? 0) > 0} label={c.withLabel} />
      <Side avg={c.withoutAvg} n={c.nWithout} hi={!!c.enough && (c.delta ?? 0) < 0} label={c.withoutLabel} />
      <span className={"in-delta" + (up ? " is-up" : "")} role="cell">
        {c.delta === null ? <span className="e-meta">{t("too few")}</span> : energyDelta(c.delta)}
      </span>
    </div>
  );
}

export function EnergyInsights({ d, live, range }: { d: InsightsData; live: boolean; range: InsightsRange }) {
  const today = insightsToday(d);
  const stored = useStoredDays(live, d, today);
  const [hov, setHov] = useState(-1);
  const { series, stats, corr } = useMemo(() => {
    if (!today) return { series: [] as EnergyPoint[], stats: energyStats([]), corr: energyCorrelations([]) };
    const facts = energyFacts(d, today, range, stored);
    const s = energySeries(facts, today, range);
    return { series: s, stats: energyStats(s), corr: energyCorrelations(facts) };
  }, [d, today, range, stored]);
  const path = useMemo(() => sparkPath(series), [series]);
  const n = series.length;
  const xPct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const lastIdx = stats.last ? series.findIndex((p) => p.date === stats.last!.date) : -1;
  const hp = hov >= 0 ? series[hov] : undefined;
  // Habits are not tracked in Kortex (Griply): the relations are the completed Top 3 and the new entries.
  const rows = [corr.focus, corr.output];

  return (
    <section className="in-energy" aria-label={t("Energy")}>
      <div className="in-energy-h">
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <h2 className="e-h2">{t("Energy")}</h2>
          <span className="e-meta">{t("1 to 10 from your check-ins, last {range} days", { range })}</span>
        </div>
        <div className="in-energy-kpis">
          <div>
            <b>{stats.avg === null ? "–" : energyDecimal(stats.avg)}</b>
            <span className="e-meta">{t("Average")}</span>
          </div>
          <div>
            <b>{stats.trend === null ? "–" : energyDelta(stats.trend)}</b>
            <span className="e-meta">{t("Trend")}</span>
          </div>
          <div>
            <b>
              {stats.count}
              <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--t3)" }}> / {range}</span>
            </b>
            <span className="e-meta">{t("Days with check-in")}</span>
          </div>
        </div>
      </div>

      <div className="in-chart">
        <div className="in-yaxis" aria-hidden>
          <span>10</span>
          <span>5</span>
          <span>0</span>
        </div>
        <div className="in-plot">
          <div className="in-area">
            <span className="in-grid" style={{ top: 0 }} aria-hidden />
            <span className="in-grid" style={{ top: "50%" }} aria-hidden />
            <span className="in-grid" style={{ bottom: 0 }} aria-hidden />
            <svg viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden>
              <path d={path.area} fill="var(--accent-soft)" stroke="none" />
              <path d={path.line} fill="none" stroke="var(--t3)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {series.map((p, i) =>
              p.energy === null ? null : (
                <span key={p.date} className={"in-dot" + (i === lastIdx ? " is-last" : "")} style={{ left: `${xPct(i)}%`, top: `${100 - p.energy * 10}%`, ...(n > 40 && i !== lastIdx && i !== hov ? { opacity: 0 } : null) }} aria-hidden />
              ),
            )}
            {series.map((p, i) =>
              p.energy === null ? null : (
                <button
                  key={p.date}
                  type="button"
                  className="in-hit"
                  aria-label={t("{date}: energy {value} of 10, {label}", { date: dayLabel(p.date), value: p.energy, label: energyLabel(p.energy) })}
                  onMouseEnter={() => setHov(i)}
                  onFocus={() => setHov(i)}
                  onMouseLeave={() => setHov(-1)}
                  onBlur={() => setHov(-1)}
                  style={{ left: `${xPct(i) - 50 / Math.max(1, n)}%`, width: `${100 / Math.max(1, n)}%`, minWidth: 6 }}
                />
              ),
            )}
            {hp && hp.energy !== null && (
              <>
                <span className="in-cursor" style={{ left: `${xPct(hov)}%` }} aria-hidden />
                <span className="in-tip tc-float" role="status" style={{ left: `clamp(0px, calc(${xPct(hov)}% - 75px), calc(100% - 150px))` }}>
                  <span className="e-meta e-num">{dayLabel(hp.date)}</span>
                  <strong style={{ fontSize: "calc(13px * var(--kx-fs, 1))", fontWeight: 500 }}>
                    {t("Energy {value}/10 · {label}", { value: hp.energy, label: energyLabel(hp.energy) })}
                  </strong>
                </span>
              </>
            )}
            {stats.count === 0 && (
              <span className="in-empty">{t("No check-ins in this period yet. Enter your energy on Home and the curve builds up here.")}</span>
            )}
          </div>
          <div className="in-xaxis" aria-hidden>
            {n > 0 && (
              <>
                <span>{dayLabel(series[0]!.date)}</span>
                <span>{dayLabel(series[Math.floor((n - 1) / 2)]!.date)}</span>
                <span>{dayLabel(series[n - 1]!.date)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="in-corr" role="table" aria-label={t("Energy in relation to focus and output")}>
        <div className="in-corr-row in-corr-head" role="row">
          <span role="columnheader">{t("Relation")}</span>
          <span className="in-side" role="columnheader">{t("On days with")}</span>
          <span className="in-side" role="columnheader">{t("On days without")}</span>
          <span role="columnheader" style={{ textAlign: "right" }}>
            {t("Difference")}
          </span>
        </div>
        {corr.enough ? (
          rows.map((c) => <CorrRow key={c.key} c={c} />)
        ) : (
          <p className="in-hint" role="row">
            <span role="cell">
              {t("Too few days so far: from {min} days with an energy check-in, Kortex shows here how completed Top 3 and new entries relate to your energy ({days} of {min}).", { min: MIN_ENERGY_DAYS, days: corr.days })}
            </span>
          </p>
        )}
        <p className="in-hint">{t("Plain mean comparisons, no cause and effect. Numbers in brackets: days.")}</p>
      </div>
    </section>
  );
}
