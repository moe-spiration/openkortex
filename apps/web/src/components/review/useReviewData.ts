"use client";

import { useCallback, useEffect, useState } from "react";
import { loadReview } from "@/lib/data/review";
import { MOCK_REVIEW, type ReviewData } from "@/lib/mock/review";
import { isLiveData } from "@/lib/workspace-data";

type ReviewLoad =
  | { status: "ready"; data: ReviewData; live: boolean }
  | { status: "loading" | "error"; data: null; live: true; error?: string };
export type ReviewState = ReviewLoad & { reload: () => void };

/** Weekly review data: the prototype mock, or in live mode this week from lib/data/review.ts. */
export function useReviewData(): ReviewState {
  const live = isLiveData();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const [state, setState] = useState<ReviewLoad>(() =>
    live
      ? { status: "loading", data: null, live: true }
      : { status: "ready", data: MOCK_REVIEW, live: false },
  );

  useEffect(() => {
    if (!live) return;
    let off = false;
    void loadReview().then((r) => {
      if (off) return;
      setState(
        r.ok
          ? { status: "ready", data: r.data, live: true }
          : { status: "error", data: null, live: true, error: r.error },
      );
    });
    return () => {
      off = true;
    };
  }, [live, tick]);

  return { ...state, reload };
}
