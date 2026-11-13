"use client";

import { useEffect, useSyncExternalStore } from "react";
import { hasActiveJobs, type JobView } from "@/lib/agent-jobs";
import { isLiveData } from "@/lib/workspace-data";
import { getAgentJobs } from "@/server/agent/actions";

/*
 * The agent's jobs, shared by every place that shows them (agent page, sidebar badge, Orbit-Bar chip, Home).
 * One list, one poll: every 5 seconds while a job is queued or running, once a minute otherwise, and only
 * while someone is looking (a mounted subscriber, a visible tab). The mock mode has no jobs.
 */

/** Window events: a job was started elsewhere (detail: its id), a standing order was created elsewhere. */
export const AGENT_JOB_EVENT = "kortex:agent-job";
export const AGENT_ORDER_EVENT = "kortex:agent-order";

const ACTIVE_MS = 5000;
const IDLE_MS = 60_000;
const EMPTY: readonly JobView[] = [];

let jobs: readonly JobView[] = EMPTY;
let loaded = false;
let timer: number | null = null;
let users = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function schedule() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (!users) return;
  timer = window.setTimeout(() => void refreshAgentJobs(), hasActiveJobs(jobs) ? ACTIVE_MS : IDLE_MS);
}

/** Reads the list now (after starting, confirming or dismissing a job elsewhere). */
export async function refreshAgentJobs(): Promise<void> {
  if (!isLiveData()) return;
  if (typeof document !== "undefined" && document.hidden && loaded) return schedule();
  const r = await getAgentJobs();
  if (r.ok) {
    jobs = r.data;
    loaded = true;
    emit();
  }
  schedule();
}

/** Puts one job into the list at once (the answer of a server action), without waiting for the next poll. */
export function putAgentJob(job: JobView) {
  jobs = jobs.some((j) => j.id === job.id) ? jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...jobs];
  loaded = true;
  emit();
  schedule();
}

/** Changes one job in place (optimistic: dismissed). */
export function patchAgentJob(id: string, patch: Partial<JobView>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The jobs and whether the first answer is in. Starts the poll while mounted. */
export function useAgentJobs(): { jobs: readonly JobView[]; loaded: boolean } {
  const list = useSyncExternalStore(subscribe, () => jobs, () => EMPTY);
  const ready = useSyncExternalStore(subscribe, () => loaded, () => false);
  useEffect(() => {
    users += 1;
    if (users === 1) void refreshAgentJobs();
    return () => {
      users -= 1;
      if (!users && timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  return { jobs: list, loaded: ready || !isLiveData() };
}
