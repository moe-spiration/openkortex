import { useEffect, useSyncExternalStore } from "react";
import { agentJobOp, loadAgentJobs, type AgentJobOp } from "../api/kortex";
import { hasActiveJobs, type JobView, type StandingOrderView } from "../lib/agentJobs";

/*
 * The agent's jobs and standing orders, shared by Home ("Über Nacht erledigt", "Dein Agent"), the daily stack
 * ("Vorsortieren") and the agent screen. One small store: loaded on first use, polled every few seconds while a
 * job runs, refreshed after every operation.
 */

interface Snapshot {
  jobs: JobView[];
  orders: StandingOrderView[];
  loaded: boolean;
  error: string | null;
}

let snap: Snapshot = { jobs: [], orders: [], loaded: false, error: null };
const listeners = new Set<() => void>();
const emit = (next: Partial<Snapshot>) => {
  snap = { ...snap, ...next };
  for (const l of listeners) l();
};

let inflight: Promise<void> | null = null;
export function refreshAgentJobs(): Promise<void> {
  inflight ??= loadAgentJobs()
    .then((r) => emit({ jobs: r.jobs, orders: r.orders, loaded: true, error: null }))
    .catch((e: unknown) => emit({ loaded: true, error: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Runs one operation; null on success, else the error text. The list is refreshed either way. */
export async function runAgentOp<T = unknown>(op: AgentJobOp): Promise<{ data: T | null; error: string | null }> {
  try {
    const data = await agentJobOp<T>(op);
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    void refreshAgentJobs();
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The store, loaded on first use (live only) and polled while a job is queued or running. */
export function useAgentJobs(live: boolean): Snapshot {
  const s = useSyncExternalStore(subscribe, () => snap);
  useEffect(() => {
    if (live && !snap.loaded) void refreshAgentJobs();
  }, [live]);
  const busy = hasActiveJobs(s.jobs);
  useEffect(() => {
    if (!live || !busy) return;
    const id = setInterval(() => void refreshAgentJobs(), 4000);
    return () => clearInterval(id);
  }, [live, busy]);
  return s;
}
