"use client";

import { useState, type CSSProperties } from "react";
import { type InsightsData, type InsightsRange } from "@/lib/mock/insights";
import { monthAbbr } from "@/components/views/entries";
import { InIco } from "./icons";
import { intlLocale, t, tn } from "@/i18n";

const panel: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 18,
  borderRadius: 16,
  background: "var(--kx-panel-bg, var(--lum-2))",
  boxShadow: "var(--kx-panel-edge, var(--edge-surface))",
};
const dayLabel = (d: Date) => t("{month} {day}", { day: d.getUTCDate(), month: monthAbbr(d.getUTCMonth()) });
const axis: CSSProperties = { fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-muted)" };
/** Date ticks are Geist (V2-01c); numeric ticks keep the mono axis style. */
const axisDate: CSSProperties = { ...axis, fontSize: "calc(12px * var(--kx-fs, 1))", fontVariantNumeric: "tabular-nums" };
const tip = (left: string, w: number): CSSProperties => ({
  position: "absolute",
  top: -6,
  left,
  width: w,
  display: "grid",
  gap: 2,
  padding: "6px 10px",
  borderRadius: 12,
  background: "var(--bg-floating-glass)",
  boxShadow: "var(--shadow-floating)",
  pointerEvents: "none",
  zIndex: 2,
});

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dec1 = (v: number) => v.toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Activity series for a range: days, or 13 weekly sums for 90 days (prototype `pts`). */
export function activity(d: InsightsData, range: InsightsRange) {
  const daily = d.activity;
  const N = daily.length;
  const pts =
    range === 90
      ? Array.from({ length: 13 }, (_, w) => {
          const chunk = daily.slice(Math.max(0, N - (13 - w) * 7), N - (12 - w) * 7);
          const tick = dayLabel(day(chunk[0]!.date));
          return { v: chunk.reduce((s, x) => s + x.v, 0), label: t("Week from {date}", { date: tick }), tick };
        })
      : daily.slice(N - range).map((x) => {
          const tick = dayLabel(day(x.date));
          return { v: x.v, label: tick, tick };
        });
  const sum = (n: number) => daily.slice(N - n).reduce((s, x) => s + x.v, 0);
  const prev = (n: number) =>
    daily.slice(Math.max(0, N - 2 * n), N - n).reduce((s, x) => s + x.v, 0);
  const cur = sum(range);
  // The 90-day mock has no earlier period; the prototype assumed 86 %.
  const pr = N >= 2 * range ? prev(range) : Math.round(cur * 0.86);
  const delta = pr ? Math.round(((cur - pr) / pr) * 100) : null;
  return { pts, cur, delta };
}

export function Kpis({ d, range }: { d: InsightsData; range: InsightsRange }) {
  const { cur, delta } = activity(d, range);
  const auto = d.autoPct[range];
  const kpis = [
    {
      label: t("New entries"),
      value: String(cur),
      delta:
        delta === null
          ? cur
            ? t("new in this period")
            : t("no entries yet")
          : t("{delta} % vs. previous period", { delta: `${delta >= 0 ? "+" : ""}${delta}` }),
      up: delta === null || delta >= 0,
    },
    {
      label: t("Processed automatically"),
      value: auto === null ? "0" : String(Math.round((cur * auto) / 100)),
      delta: auto === null ? t("nothing processed yet") : t("{pct} % without manual tagging", { pct: auto }),
      up: true,
    },
    {
      label: t("Average energy"),
      value: d.energyAvg ?? "–",
      delta:
        d.energyDelta === null
          ? d.energyAvg
            ? t("last 7 days")
            : t("Fill in the check-in on Home")
          : t("{delta} vs. previous week", { delta: `${d.energyDelta >= 0 ? "+" : "−"}${dec1(Math.abs(d.energyDelta))}` }),
      up: d.energyDelta === null || d.energyDelta >= 0,
    },
    {
      label: t("Journal streak"),
      testid: "streak-value",
      value: String(d.streak),
      delta: d.streakRecord ? t("days in a row, record {record}", { record: d.streakRecord }) : t("days in a row"),
      up: true,
    },
  ];
  return (
    <section
      aria-label={t("Key figures")}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
        gap: 12,
      }}
    >
      {kpis.map((k) => (
        <div key={k.label} style={{ ...panel, gap: 6, padding: 16 }}>
          <span className="kx-help">{k.label}</span>
          <span
            className="kx-h-display"
            style={{ fontVariantNumeric: "tabular-nums" }}
            data-testid={"testid" in k ? k.testid : undefined}
          >
            {k.value}
          </span>
          <span
            className="kxh-row"
            style={{ gap: 4, fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}
          >
            <InIco name={k.up ? "in-up" : "in-down"} sm style={{ color: "var(--status-synced)" }} />
            {k.delta}
          </span>
        </div>
      ))}
    </section>
  );
}

export function ActivityChart({ d, range }: { d: InsightsData; range: InsightsRange }) {
  const [hov, setHov] = useState(-1);
  const { pts } = activity(d, range);
  const n = pts.length;
  const max = Math.max(...pts.map((x) => x.v));
  const top = Math.max(4, Math.ceil(max / 2) * 2);
  const ticks = [pts[0]!, pts[Math.floor(n / 2)]!, pts[n - 1]!].map((p) => p.tick);
  const h = hov >= 0 && hov < n ? pts[hov] : undefined;
  return (
    <section aria-label={t("New entries")} style={panel}>
      <div className="kxh-row">
        <h2 className="kx-h-card" style={{ margin: 0 }}>
          {t("New entries")}
        </h2>
        <span className="kx-help" style={{ marginLeft: "auto" }}>
          {range === 90 ? t("per week") : t("per day")}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 180,
          display: "grid",
          gridTemplateColumns: "30px 1fr",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "flex-end",
            paddingBottom: 20,
          }}
        >
          <span className="kx-num" style={axis}>
            {top}
          </span>
          <span className="kx-num" style={axis}>
            {Math.round(top / 2)}
          </span>
          <span className="kx-num" style={axis}>
            0
          </span>
        </div>
        <div style={{ position: "relative", display: "grid", gridTemplateRows: "1fr 20px" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 1,
              background: "var(--border-subtle)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 80,
              height: 1,
              background: "var(--border-subtle)",
            }}
          />
          <div
            style={{
              position: "relative",
              display: "grid",
              gridTemplateColumns: `repeat(${n},minmax(0,1fr))`,
              gap: n > 20 ? 2 : 6,
              alignItems: "end",
              height: "100%",
            }}
          >
            {pts.map((x, i) => (
              <button
                key={i}
                type="button"
                className="kxb"
                aria-label={`${x.label}: ${tn(x.v, "{n} entry", "{n} entries")}`}
                onMouseEnter={() => setHov(i)}
                onFocus={() => setHov(i)}
                onMouseLeave={() => setHov(-1)}
                onBlur={() => setHov(-1)}
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  minWidth: 0,
                }}
              >
                <i
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: 22,
                    height: `${Math.max(3, (x.v / top) * 100)}%`,
                    borderRadius: "4px 4px 0 0",
                    background: hov === i ? "var(--tag-ai-fg)" : "var(--accent-ai)",
                  }}
                />
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            {ticks.map((tick, i) => (
              <span key={i} style={axisDate}>
                {tick}
              </span>
            ))}
          </div>
          {h && (
            <div
              role="status"
              style={tip(
                `clamp(0px, calc(${((hov + 0.5) / n) * 100}% - 60px), calc(100% - 120px))`,
                120,
              )}
            >
              <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-muted)" }}>
                {h.label}
              </span>
              <strong style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{tn(h.v, "{n} entry", "{n} entries")}</strong>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function SpacesChart({ d }: { d: InsightsData }) {
  const max = Math.max(1, ...d.spaces.map((x) => x.v));
  return (
    <section aria-label={t("Entries by space")} style={panel}>
      <div className="kxh-row">
        <h2 className="kx-h-card" style={{ margin: 0 }}>
          {t("Entries by space")}
        </h2>
        <span className="kx-help" style={{ marginLeft: "auto" }}>
          {t("total {n}", { n: d.spacesTotal })}
        </span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {d.spaces.length === 0 && <span className="kx-help">{t("No entries in the vault yet.")}</span>}
        {d.spaces.map((x) => (
          <div
            key={x.label}
            style={{
              display: "grid",
              gridTemplateColumns: "150px 1fr 34px",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="kx-truncate" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>
              {x.label}
            </span>
            <span style={{ height: 14, display: "flex", alignItems: "center" }}>
              <i
                style={{
                  display: "block",
                  height: 12,
                  borderRadius: "0 4px 4px 0",
                  width: `${(x.v / max) * 100}%`,
                  background: `var(--tag-${x.g}-dot)`,
                }}
              />
            </span>
            <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", textAlign: "right" }}>
              {x.v}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SourcesHabits({ d }: { d: InsightsData }) {
  const SOURCES = d.sources;
  const last = SOURCES.length - 1;
  return (
    <section aria-label={t("Where your entries come from")} style={{ ...panel, gap: 18, alignContent: "start" }}>
      <div style={{ display: "grid", gap: 10 }}>
        <h2 className="kx-h-card" style={{ margin: 0 }}>
          {t("Where your entries come from")}
        </h2>
        {SOURCES.length === 0 && (
          <span className="kx-help">
            {t("Once there are entries, you see here which ways they come in.")}
          </span>
        )}
        <div
          style={{ display: "flex", gap: 2, height: 14 }}
          role="img"
          aria-label={SOURCES.map((x) => t("{label} {pct} percent", { label: x.label, pct: x.pct })).join(", ")}
        >
          {SOURCES.map((x, i) => (
            <i
              key={x.label}
              style={{
                display: "block",
                height: "100%",
                width: `${x.pct}%`,
                background: x.c,
                borderRadius: i === 0 ? "4px 0 0 4px" : i === last ? "0 4px 4px 0" : 0,
              }}
            />
          ))}
        </div>
        <div className="kxh-wrap" style={{ gap: 14 }}>
          {SOURCES.map((x) => (
            <span
              key={x.label}
              className="kxh-row"
              style={{ gap: 6, fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}
            >
              <i
                style={{ display: "block", width: 8, height: 8, borderRadius: 2, background: x.c }}
              />
              {x.label}{" "}
              <span className="kx-num" style={{ color: "var(--text-primary)" }}>
                {x.pct}%
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
