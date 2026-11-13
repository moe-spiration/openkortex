import { byLocale } from "@kortex/i18n";
import type { Json, KortexClient } from "@kortex/db";
import { stepCountIs, streamText } from "ai";
import { z } from "zod";
import { t } from "@/i18n";
import { runWithLocale } from "@/i18n/server";
import {
  isStale,
  jobTitle,
  parseStandingOrder,
  type JobAutonomy,
  type JobOrigin,
  type JobResult,
  type JobStatus,
  type JobView,
  type StandingOrderView,
} from "@/lib/agent-jobs";
import type { AuthContext } from "../auth";
import {
  AGENT_SKILLS,
  AgentActionSchema,
  AgentUndoSchema,
  SourceRegistry,
  agentPrompt,
  executeAction,
  undoAction,
  type AgentAction,
  type AgentActionResult,
  type AgentSkill,
} from "../chat/agent";
import { AGENT_STEPS, createAgentTools } from "../chat/agent-tools";
import { ChatRequestSchema } from "../chat/contract";
import { modelSettingsFor, toCitations } from "../chat/handler";
import { copilotSystemPrompt } from "../chat/prompts";
import { retrieveSources } from "../chat/retrieval";
import type { ServerDeps } from "../deps";
import { loadFocusContext } from "../digest/synthesis";
import { withUsageContext } from "../limits/usage";
import { localeOfSettings } from "../locale";
import { getUserSettings } from "../repo";

/*
 * Agent jobs: the agent of the copilot (server/chat), run to the end without anyone watching. A job
 * is a row in kortex.agent_jobs; `runJob` claims it, lets the model work with the same tools as the
 * copilot and stores the outcome. With autonomy "ask" the changes are only proposed and the job
 * waits ("waiting") until the user confirms or dismisses them; with "self" they are carried out and
 * can be taken back. Doc: docs/agent-jobs.md.
 */

type Ctx = { client: KortexClient; userId: string };
export type JobDeps = Pick<ServerDeps, "log" | "now" | "loadCatalog" | "createModels">;

const JOB_COLUMNS = "id,title,prompt,skill,autonomy,status,origin,action_item_id,result,error,created_at,started_at,finished_at" as const;
const ORDER_COLUMNS = "id,title,prompt,cadence,hour,weekday,autonomy,enabled,last_period" as const;
const LIST_LIMIT = 40;
const MAX_SOURCES = 40;
const MAX_STEPS_KEPT = 60;

interface JobRow {
  id: string;
  title: string;
  prompt: string;
  skill: string | null;
  autonomy: string;
  status: string;
  origin: string;
  action_item_id: string | null;
  result: Json | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const resultOf = (v: Json | null): JobResult | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as JobResult) : null);

const toView = (r: JobRow): JobView => ({
  id: r.id,
  title: r.title,
  prompt: r.prompt,
  skill: r.skill,
  autonomy: r.autonomy as JobAutonomy,
  status: r.status as JobStatus,
  origin: r.origin as JobOrigin,
  actionItemId: r.action_item_id,
  result: resultOf(r.result),
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export const JobInputSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  title: z.string().trim().min(1).max(200).optional(),
  skill: z.enum(AGENT_SKILLS).optional(),
  autonomy: z.enum(["read", "ask", "self"]).default("ask"),
  origin: z.enum(["manual", "standing", "task", "presort"]).default("manual"),
  action_item_id: z.uuid().optional(),
  standing_order_id: z.uuid().optional(),
});
export type JobInput = z.input<typeof JobInputSchema>;

/** Queues a job. It starts when `runJob` is called with its id. */
export async function createJob(ctx: Ctx, input: JobInput): Promise<JobView> {
  const job = JobInputSchema.parse(input);
  const { data, error } = await ctx.client
    .from("agent_jobs")
    .insert({
      user_id: ctx.userId,
      title: job.title ?? jobTitle(job.prompt),
      prompt: job.prompt,
      skill: job.skill ?? null,
      autonomy: job.autonomy,
      status: "queued",
      origin: job.origin,
      action_item_id: job.action_item_id ?? null,
      standing_order_id: job.standing_order_id ?? null,
    })
    .select(JOB_COLUMNS)
    .single();
  if (error || !data) throw new Error(`agent_jobs: ${error?.message ?? "insert failed"}`);
  return toView(data as JobRow);
}

/** The newest jobs. Jobs that were cut off (server restart) are closed as failed on the way. */
export async function listJobs(ctx: Ctx, now: Date): Promise<JobView[]> {
  const { data, error } = await ctx.client
    .from("agent_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", ctx.userId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw new Error(`agent_jobs: ${error.message}`);
  const jobs = ((data ?? []) as JobRow[]).map(toView);
  const stale = jobs.filter((j) => isStale(j, now));
  if (stale.length) {
    const patch = { status: "error", error: t("The job was interrupted. Start it again."), finished_at: now.toISOString() };
    await ctx.client.from("agent_jobs").update(patch).eq("user_id", ctx.userId).in("id", stale.map((j) => j.id)).in("status", ["queued", "running"]);
    for (const j of stale) Object.assign(j, { status: "error", error: patch.error, finishedAt: patch.finished_at });
  }
  return jobs;
}

async function readJob(ctx: Ctx, id: string): Promise<JobView> {
  const { data, error } = await ctx.client.from("agent_jobs").select(JOB_COLUMNS).eq("user_id", ctx.userId).eq("id", id).maybeSingle();
  if (error) throw new Error(`agent_jobs: ${error.message}`);
  if (!data) throw new Error(t("Job not found"));
  return toView(data as JobRow);
}

async function saveJob(ctx: Ctx, id: string, patch: { status?: JobStatus; result?: JobResult; error?: string | null; finished_at?: string }, onlyIf?: JobStatus): Promise<void> {
  let q = ctx.client
    .from("agent_jobs")
    .update({ ...patch, ...(patch.result ? { result: patch.result as unknown as Json } : {}) } as never)
    .eq("user_id", ctx.userId)
    .eq("id", id);
  if (onlyIf) q = q.eq("status", onlyIf);
  const { error } = await q;
  if (error) throw new Error(`agent_jobs: ${error.message}`);
}

const backgroundPrompt = () =>
  byLocale({
    en: "\nYou work on this job in the background; the user is not watching and cannot answer questions now. Finish the work with what the vault holds, decide small things yourself and say at the end, briefly, what you found, what you did or propose, and what is still open.",
    de: "\nDu bearbeitest diesen Auftrag im Hintergrund; der Nutzer sieht nicht zu und kann jetzt keine Rückfragen beantworten. Bring die Arbeit mit dem zu Ende, was der Vault hergibt, entscheide Kleinigkeiten selbst und sag am Ende kurz, was du gefunden hast, was du getan hast oder vorschlägst und was noch offen ist.",
  });

/**
 * Runs one queued job to the end. Never throws: a failure ends in status "error". Safe to call
 * twice (only the call that claims the row works).
 */
export async function runJob(deps: JobDeps, auth: AuthContext, jobId: string): Promise<void> {
  const ctx: Ctx = { client: auth.client, userId: auth.userId };
  const { data: claimed, error: claimError } = await ctx.client
    .from("agent_jobs")
    .update({ status: "running", started_at: deps.now().toISOString() })
    .eq("user_id", ctx.userId)
    .eq("id", jobId)
    .eq("status", "queued")
    .select(JOB_COLUMNS);
  if (claimError || !claimed?.length) return;
  const job = toView(claimed[0] as JobRow);

  try {
    const settings = await getUserSettings(ctx.client, ctx.userId);
    await runWithLocale(localeOfSettings(settings), () =>
      withUsageContext({ userId: ctx.userId }, async () => {
        const catalog = await deps.loadCatalog();
        const models = deps.createModels(modelSettingsFor(settings, undefined, catalog), catalog);
        const base = ChatRequestSchema.parse({
          messages: [{ role: "user", content: job.prompt }],
          mode: "brain",
          agent: true,
          autonomy: job.autonomy,
          ...(job.skill ? { skill: job.skill } : {}),
        });
        const [sources, focus] = await Promise.all([
          retrieveSources(auth, base, job.prompt, models, deps.log),
          loadFocusContext(ctx.client, ctx.userId),
        ]);
        const citations = toCitations(sources);
        const registry = new SourceRegistry(citations);
        const out: JobResult = { steps: [] };
        const tools = createAgentTools({
          auth,
          deps,
          models,
          base,
          registry,
          noteId: null,
          autonomy: job.autonomy,
          events: {
            step: (s) => void (out.steps!.length < MAX_STEPS_KEPT && out.steps!.push(s)),
            sources: () => undefined,
            proposal: (actions, labels) => void (out.proposal = { actions, labels }),
            done: (results) => void (out.done = { results }),
          },
        });
        const run = streamText({
          model: models.chat(),
          system:
            copilotSystemPrompt("brain", citations, deps.now().toISOString().slice(0, 10), { focus }) +
            agentPrompt(job.autonomy, (job.skill as AgentSkill | null) ?? undefined, false) +
            backgroundPrompt(),
          messages: [{ role: "user", content: job.prompt }],
          temperature: 0.3,
          tools,
          stopWhen: stepCountIs(AGENT_STEPS),
        });
        out.answer_md = (await run.text).trim();
        out.sources = registry
          .list()
          .slice(0, MAX_SOURCES)
          .map((c) => ({ n: c.n, item_id: c.item_id, title: c.title, type: c.type }));
        // Cancelled while it ran: the row is no longer "running" and stays as the user left it.
        await saveJob(ctx, job.id, { status: out.proposal?.actions.length ? "waiting" : "done", result: out, error: null, finished_at: deps.now().toISOString() }, "running");
      }),
    );
  } catch (err) {
    deps.log.error(`agent job ${job.id}`, err);
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    await saveJob(ctx, job.id, { status: "error", error: message, finished_at: deps.now().toISOString() }, "running").catch(() => undefined);
  }
}

/** Confirms a waiting job: carries out the proposed changes (all, or the picked ones). */
export async function confirmJob(ctx: Ctx, id: string, now: Date, picks?: number[]): Promise<JobView> {
  const job = await readJob(ctx, id);
  const proposal = job.result?.proposal;
  if (job.status !== "waiting" || !proposal?.actions.length) throw new Error(t("This job has nothing to confirm."));
  const actions: AgentAction[] = [];
  proposal.actions.forEach((raw, i) => {
    if (picks && !picks.includes(i)) return;
    const parsed = AgentActionSchema.safeParse(raw);
    if (parsed.success) actions.push(parsed.data);
  });
  const results: AgentActionResult[] = [];
  for (const action of actions) results.push(await executeAction(ctx, action));
  const rest: JobResult = { ...(job.result ?? {}) };
  delete rest.proposal;
  const result: JobResult = { ...rest, done: { results: [...(job.result?.done?.results ?? []), ...results] } };
  await saveJob(ctx, id, { status: "done", result, finished_at: now.toISOString() }, "waiting");
  return { ...job, status: "done", result, finishedAt: now.toISOString() };
}

/** Dismisses a job: a waiting or running one is cancelled (nothing is changed), a finished one leaves the list. */
export async function dismissJob(ctx: Ctx, id: string, now: Date): Promise<void> {
  await saveJob(ctx, id, { status: "cancelled", finished_at: now.toISOString() });
}

/** Takes the carried-out changes of a job back. */
export async function undoJob(ctx: Ctx, id: string): Promise<JobView> {
  const job = await readJob(ctx, id);
  const results = job.result?.done?.results ?? [];
  if (job.result?.undone || !results.some((r) => r.ok && r.undo)) throw new Error(t("This job has nothing to take back."));
  const failed: string[] = [];
  // Newest change first, so an edit on top of an edit unwinds in order.
  for (const r of [...results].reverse()) {
    if (!r.ok || !r.undo) continue;
    const undo = AgentUndoSchema.safeParse(r.undo);
    const res = undo.success ? await undoAction(ctx, undo.data) : { ok: false, error: "invalid" };
    if (!res.ok) failed.push(r.label);
  }
  if (failed.length) throw new Error(t("Not everything could be taken back: {list}", { list: failed.join(", ") }));
  const result: JobResult = { ...job.result, undone: true };
  await saveJob(ctx, id, { result });
  return { ...job, result };
}

// --- Standing orders -----------------------------------------------------------------------------

interface OrderRow {
  id: string;
  title: string;
  prompt: string;
  cadence: string;
  hour: number;
  weekday: number | null;
  autonomy: string;
  enabled: boolean;
  last_period: string | null;
}

export const toOrderView = (r: OrderRow): StandingOrderView => ({
  id: r.id,
  title: r.title,
  prompt: r.prompt,
  cadence: r.cadence === "weekly" ? "weekly" : "daily",
  hour: r.hour,
  weekday: r.weekday,
  autonomy: r.autonomy as JobAutonomy,
  enabled: r.enabled,
  lastPeriod: r.last_period,
});

const MAX_ORDERS = 20;

export async function listStandingOrders(ctx: Ctx): Promise<StandingOrderView[]> {
  const { data, error } = await ctx.client.from("agent_standing_orders").select(ORDER_COLUMNS).eq("user_id", ctx.userId).order("created_at", { ascending: true }).limit(MAX_ORDERS);
  if (error) throw new Error(`agent_standing_orders: ${error.message}`);
  return ((data ?? []) as OrderRow[]).map(toOrderView);
}

/** A standing order from one sentence ("Jeden Freitag meine Leseliste zusammenfassen"). Starts with "ask". */
export async function createStandingOrder(ctx: Ctx, text: string): Promise<StandingOrderView> {
  const parsed = parseStandingOrder(text.slice(0, 600));
  if (!parsed) throw new Error(t("Say when and what, for example: “Every Friday at 8 summarize my reading list”."));
  if ((await listStandingOrders(ctx)).length >= MAX_ORDERS) throw new Error(t("At most {n} standing orders.", { n: MAX_ORDERS }));
  const { data, error } = await ctx.client
    .from("agent_standing_orders")
    .insert({ user_id: ctx.userId, title: parsed.title, prompt: parsed.prompt, cadence: parsed.cadence, hour: parsed.hour, weekday: parsed.weekday, autonomy: "ask", enabled: true, last_period: null })
    .select(ORDER_COLUMNS)
    .single();
  if (error || !data) throw new Error(`agent_standing_orders: ${error?.message ?? "insert failed"}`);
  return toOrderView(data as OrderRow);
}

export async function setStandingOrder(ctx: Ctx, id: string, patch: { enabled?: boolean; autonomy?: JobAutonomy }): Promise<void> {
  const clean = { ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.autonomy ? { autonomy: patch.autonomy } : {}) };
  if (!Object.keys(clean).length) return;
  const { error } = await ctx.client.from("agent_standing_orders").update(clean).eq("user_id", ctx.userId).eq("id", id);
  if (error) throw new Error(`agent_standing_orders: ${error.message}`);
}

export async function deleteStandingOrder(ctx: Ctx, id: string): Promise<void> {
  const { error } = await ctx.client.from("agent_standing_orders").delete().eq("user_id", ctx.userId).eq("id", id);
  if (error) throw new Error(`agent_standing_orders: ${error.message}`);
}
