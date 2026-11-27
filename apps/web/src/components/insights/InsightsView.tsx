"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createNote } from "@/lib/api/actions";
import {
  RANGES,
  type InsightsData,
  type InsightsRange,
  type Recommendation,
} from "@/lib/mock/insights";
import { lifeHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { ActivityChart, Kpis, SourcesHabits, SpacesChart } from "./Charts";
import { EnergyInsights } from "./EnergyInsights";
import { Recommendations, type RecHandlers, type RecState } from "./Recommendations";
import { useInsightsData } from "./useInsightsData";
import { ThemeHero } from "@/components/theme/ThemeHero";
import { LocationBar, ViewBar } from "@/components/shell/Bars";
import { useLook } from "@/components/theme/look";
import { t } from "@/i18n";

/** Insights dashboard (design/reference/Insights.dc.html). */
export function InsightsView() {
  const insights = useInsightsData();
  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-main-window)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <ThemeHero topic="insights" height={320} />
      {insights.status === "ready" ? (
        <InsightsBody d={insights.data} live={insights.live} />
      ) : (
        <p
          className="kx-body kx-muted"
          role="status"
          style={{ maxWidth: 1160, margin: "0 auto", padding: "30px 32px" }}
        >
          {insights.status === "error"
            ? t("Insights could not be loaded: {error}", { error: insights.error ?? "" })
            : t("Loading insights …")}
        </p>
      )}
    </div>
  );
}

function InsightsBody({ d, live }: { d: InsightsData; live: boolean }) {
  const router = useRouter();
  const { openNote, showToast } = useShell();
  const ruhe = useLook() === "ruhe";
  const [range, setRange] = useState<InsightsRange>(30);
  const [rec, setRec] = useState<RecState>({ cat: "all", done: {}, later: {}, hero: false });

  // The prototype's graphFn also opens the graph's serendipity panel; the graph route has no hook for that yet.
  const graph = () => router.push("/graph");
  const handlers: RecHandlers = {
    setCat: (cat) => setRec((s) => ({ ...s, cat })),
    act: (r: Recommendation) => {
      setRec((s) => ({ ...s, done: { ...s.done, [r.k]: true } }));
      if (r.fn?.kind === "note") openNote(r.fn.id);
      else if (r.fn?.kind === "life") router.push(lifeHref(r.fn.key));
      else if (r.fn?.kind === "graph") graph();
      if (r.msg) showToast(r.msg);
    },
    later: (r) => {
      setRec((s) => ({ ...s, later: { ...s.later, [r.k]: true } }));
      showToast(t("Comes back tomorrow"));
    },
    more: (r) => showToast(t("Kortex will show more like \"{title}\" from now on", { title: r.title })),
    heroAct: () => {
      const lead = d.lead;
      if (!lead) return;
      setRec((s) => ({ ...s, hero: true }));
      if (!live) return showToast(t("Synthesis note \"{title}\" created", { title: lead.title }));
      const title = t("Synthesis: {title}", { title: lead.title });
      void createNote({
        title,
        contentMd: `# ${title}\n\n${lead.long}\n\n${lead.tags.map(([tag]) => tag).join(" ")}\n`,
        folderPath: "10_Notes",
        tags: lead.tags.map(([tag]) => tag.replace(/^#/, "")),
      }).then((r) => {
        if (r.ok) showToast(t("Synthesis note \"{title}\" created in 10_Notes", { title: lead.title }));
        else {
          setRec((s) => ({ ...s, hero: false }));
          showToast(t("Synthesis note not created: {error}", { error: r.error }));
        }
      });
    },
    heroGraph: graph,
    resetLater: () => setRec((s) => ({ ...s, later: {} })),
  };

  return (
    <div
      className="kx-pack-head"
      style={{
        maxWidth: 1160,
        margin: "0 auto", // V2-08d: the footbar (60 px + 16 px inset) and the quick chips float over the scroll area;
        // 136 px keeps the last block >= 24 px above them.
        padding: ruhe ? "22px 32px 136px" : "130px 32px 136px", // Vivid: title block at the bottom of the pack background (spec 5.2); Ruhe: the head is the location bar
        position: "relative",
        zIndex: 1,
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr)",
        gap: 22,
      }}
    >
      {ruhe ? (
        <>
          <LocationBar icon="chart" crumbs={[{ label: "Insights" }]} meta={d.asOf} />
          <ViewBar tabs={RANGES.map(([r]) => ({ id: String(r), label: t("{n} days", { n: r }) }))} value={String(range)} onChange={(v) => setRange(Number(v) as typeof range)} label={t("Period")} />
        </>
      ) : (
        <header
          className="kx-pagetitle kx-insights-head"
          style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}
        >
          <div className="kx-pagetitle-text" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <span className="kx-eyebrow">Insights</span>
            <h1 className="kx-h-page" style={{ margin: "4px 0 0" }}>
              {t("Your Second Brain in numbers")}
            </h1>
            <p className="kx-body kx-muted kx-pagetitle-meta" style={{ margin: "6px 0 0" }}>
              {d.asOf}
            </p>
          </div>
          <div className="kx-tabs" role="tablist" aria-label={t("Period")}>
            {RANGES.map(([r]) => (
              <button
                key={r}
                type="button"
                className="kx-tab"
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
              >
                {t("{n} days", { n: r })}
              </button>
            ))}
          </div>
        </header>
      )}

      <Recommendations d={d} s={rec} h={handlers} />
      <Kpis d={d} range={range} />
      <EnergyInsights d={d} live={live} range={range} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(520px,100%),1fr))",
          gap: 16,
        }}
      >
        <ActivityChart key={range} d={d} range={range} />
        <SpacesChart d={d} />
        <SourcesHabits d={d} />
      </div>
    </div>
  );
}
