"use client";

import { useEffect, useState } from "react";
import { loadInsights, refreshImpulses } from "@/lib/data/insights";
import { MOCK_INSIGHTS, type InsightsData } from "@/lib/mock/insights";
import { isLiveData } from "@/lib/workspace-data";

export type InsightsState =
  | { status: "ready"; data: InsightsData; live: boolean }
  | { status: "loading" | "error"; data: null; live: true; error?: string };

/**
 * Insights data: the prototype mock, or in live mode the figures from lib/data/insights.ts. When the
 * cached impulses are missing or older than their TTL, they are regenerated in the background
 * (one routed `summarize` call) and merged in when done.
 */
export function useInsightsData(): InsightsState {
  const live = isLiveData();
  const [state, setState] = useState<InsightsState>(() =>
    live
      ? { status: "loading", data: null, live: true }
      : { status: "ready", data: MOCK_INSIGHTS, live: false },
  );

  useEffect(() => {
    if (!live) return;
    let off = false;
    void loadInsights().then((r) => {
      if (off) return;
      if (!r.ok) return setState({ status: "error", data: null, live: true, error: r.error });
      setState({ status: "ready", data: r.data, live: true });
      if (r.data.impulses !== "none" && r.data.impulses !== "stale") return;
      void refreshImpulses().then((x) => {
        if (off) return;
        setState((s) =>
          s.status !== "ready"
            ? s
            : x.ok
              ? { ...s, data: { ...s.data, ...x.data } }
              : // Keep what we have; an empty section explains itself.
                {
                  ...s,
                  data: {
                    ...s.data,
                    impulses: s.data.recommendations.length ? "fresh" : "too_little",
                  },
                },
        );
      });
    });
    return () => {
      off = true;
    };
  }, [live]);

  return state;
}
