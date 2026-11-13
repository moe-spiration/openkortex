"use server";

import type { JobView, StandingOrderView } from "@/lib/agent-jobs";
import { getServerDeps } from "@/server/deps";
import { enforceLimits } from "@/server/limits";
import { runAction, type ActionCtx, type ActionResult } from "@/server/settings/run";
import type { AuthContext } from "../auth";
import {
  confirmJob,
  createJob,
  createStandingOrder,
  deleteStandingOrder,
  dismissJob,
  listJobs,
  listStandingOrders,
  runJob,
  setStandingOrder,
  undoJob,
  type JobInput,
} from "./jobs";

/* Server actions of the agent's jobs and standing orders. They run as the signed-in user (RLS). */

const authOf = (ctx: ActionCtx): AuthContext => ({ userId: ctx.userId, mode: "session", client: ctx.client });

export interface AgentOverview {
  jobs: JobView[];
  orders: StandingOrderView[];
}

export async function getAgentOverview(): Promise<ActionResult<AgentOverview>> {
  return runAction("agent overview", async (ctx) => {
    const [jobs, orders] = await Promise.all([listJobs(ctx, new Date()), listStandingOrders(ctx)]);
    return { jobs, orders };
  });
}

export async function getAgentJobs(): Promise<ActionResult<JobView[]>> {
  return runAction("agent jobs", (ctx) => listJobs(ctx, new Date()));
}

/** Queues a job and starts it after the answer is sent; the page polls for the outcome. */
export async function startAgentJob(input: Pick<JobInput, "prompt" | "title" | "skill" | "autonomy" | "action_item_id"> & { origin?: "manual" | "task" | "presort" }): Promise<ActionResult<JobView>> {
  return runAction("agent job start", async (ctx) => {
    const deps = getServerDeps();
    const auth = authOf(ctx);
    // The same rate limit and daily budget as a chat request.
    await enforceLimits({ auth, deps }, "chat");
    const job = await createJob(ctx, { ...input, origin: input.origin ?? "manual" });
    deps.defer(runJob(deps, auth, job.id));
    return job;
  });
}

export async function confirmAgentJob(id: string, picks?: number[]): Promise<ActionResult<JobView>> {
  return runAction("agent job confirm", (ctx) => confirmJob(ctx, id, new Date(), picks));
}

export async function dismissAgentJob(id: string): Promise<ActionResult<null>> {
  return runAction("agent job dismiss", async (ctx) => {
    await dismissJob(ctx, id, new Date());
    return null;
  });
}

export async function undoAgentJob(id: string): Promise<ActionResult<JobView>> {
  return runAction("agent job undo", (ctx) => undoJob(ctx, id));
}

export async function addStandingOrder(text: string): Promise<ActionResult<StandingOrderView>> {
  return runAction("standing order add", (ctx) => createStandingOrder(ctx, text));
}

export async function toggleStandingOrder(id: string, enabled: boolean): Promise<ActionResult<null>> {
  return runAction("standing order toggle", async (ctx) => {
    await setStandingOrder(ctx, id, { enabled });
    return null;
  });
}

export async function removeStandingOrder(id: string): Promise<ActionResult<null>> {
  return runAction("standing order remove", async (ctx) => {
    await deleteStandingOrder(ctx, id);
    return null;
  });
}
