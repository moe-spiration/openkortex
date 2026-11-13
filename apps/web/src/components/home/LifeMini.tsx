"use client";

import { tx } from "@/i18n";
import type { CSSProperties } from "react";
import { Ico } from "@/components/shell/icons";
import { useLifeScores } from "@/lib/shell/life-scores";
import { LIFE_AREAS, isLiveData } from "@/lib/workspace-data";
import { lifeMiniRows } from "./home-utils";

/**
 * "Life" on Home: each active area with its tinted icon, opening the area's page. No scores or bars (2026-11-12):
 * goals and habits live in Griply. The life-scores read only tells which areas are active.
 */
export function LifeMini({ go, style }: { go: (key: string) => void; style?: CSSProperties }) {
  const scores = useLifeScores();
  const rows = lifeMiniRows(LIFE_AREAS, scores, isLiveData());
  return (
    <section className="hm-bx hm-bx--5" aria-label="Life" style={style}>
      <div className="hm-bx-h">
        <h2 className="e-h2">Life</h2>
        <button type="button" className="e-link" onClick={() => go("overview")}>
          {tx("life", "Overview")}
        </button>
      </div>
      <div className="hm-life-mini">
        {rows.map((a) => (
          <button
            key={a.key}
            type="button"
            className="hm-lm"
            style={{ "--lc": `var(--tag-${a.tone}-dot)` } as CSSProperties}
            onClick={() => go(a.key)}
            aria-label={a.label}
          >
            <span className="e-lifeg" aria-hidden>
              <Ico name={a.icon} size="sm" />
            </span>
            <span className="hm-lm-t e-clamp1" style={{ minWidth: 0, flex: 1 }}>
              {a.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
