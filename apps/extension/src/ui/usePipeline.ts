import { useEffect, useState } from "react";
import { describePipeline, type Pipeline } from "../lib/result";
import type { StatusFetcher } from "../lib/messages";

const EVERY_MS = 2_000;
const MAX_POLLS = 45;

/**
 * Follows an accepted item until the server has finished it (processed / error) or the budget is
 * used up (~90 s; the options page keeps showing the latest state afterwards).
 */
export function usePipeline(itemId: string | null, fetchStatus: StatusFetcher | undefined, every = EVERY_MS): Pipeline | null {
  const [state, setState] = useState<Pipeline | null>(null);
  useEffect(() => {
    if (!itemId || !fetchStatus) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const tick = async () => {
      const res = await fetchStatus(itemId);
      if (!alive) return;
      if (res.ok) {
        const p = describePipeline(res.data);
        setState(p);
        if (p.final) return;
      }
      if (++polls < MAX_POLLS) timer = setTimeout(() => void tick(), every);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [itemId, fetchStatus, every]);
  return state;
}
