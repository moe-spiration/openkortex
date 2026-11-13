import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth";
import { confirmJob, createJob, createStandingOrder, dismissJob, listJobs, listStandingOrders, runJob, setStandingOrder, undoJob } from "../agent/jobs";
import { runStandingOrders } from "../agent/standing-cron";
import { createCronHandlers } from "../cron/handler";
import { FakeSupabase } from "./fake-supabase";
import { mockRouter, setup, USER_ID } from "./helpers";

/* Agent jobs without network: fake Supabase, a chat model that calls the given tools, then answers. */

const MEETING_ID = "77777777-7777-4777-8777-777777777777";
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

function agentModel(calls: Array<{ tool: string; input: unknown }>, answer = "Erledigt [1].", fail = false) {
  let step = 0;
  const systems: string[] = [];
  const model = new MockLanguageModelV4({
    modelId: "mock-chat",
    doStream: async (opts) => {
      if (fail) throw new Error("model down");
      systems.push(JSON.stringify((opts as { prompt?: unknown }).prompt ?? ""));
      const call = calls[step++];
      const parts: unknown[] = call
        ? [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: `c${step}`, toolName: call.tool, input: JSON.stringify(call.input) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: answer },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ];
      return { stream: convertArrayToReadableStream(parts as never[]) };
    },
  });
  return { model, systems };
}

function make(chat: MockLanguageModelV4, env: Record<string, string> = {}) {
  const db = new FakeSupabase({
    knowledge_items: [
      { id: MEETING_ID, user_id: USER_ID, title: "Q4 Sync", type: "meeting", status: "processed", content_md: "# Q4 Sync\n\nMayer: Wir starten.", summary: null, folder_path: "20_Meetings", source_url: null, cluster_name: null, updated_at: "2026-11-11" },
    ],
    item_chunks: [],
    action_items: [],
    folders: [],
    user_settings: [{ user_id: USER_ID, locale: "de" }],
    agent_jobs: [],
    agent_standing_orders: [],
  });
  db.authUser = { id: USER_ID };
  db.rpcHandlers.match_knowledge_hybrid = () => [
    { item_id: MEETING_ID, title: "Q4 Sync", type: "meeting", page_or_timestamp: null, folder_path: "20_Meetings", source_url: null, chunk_text: "Mayer: Wir starten.", summary: null },
  ];
  const s = setup({ db, models: mockRouter({ chat }), env });
  const auth: AuthContext = { userId: USER_ID, mode: "session", client: db.client };
  return { ...s, auth, ctx: { client: db.client, userId: USER_ID } };
}

const jobs = (db: FakeSupabase) => db.tables.agent_jobs as Array<{ id: string; status: string; result: Record<string, unknown> | null; error: string | null; origin: string; title: string }>;
const tasks = (db: FakeSupabase) => db.tables.action_items as Array<{ id: string; title: string }>;
const NOW = new Date("2026-11-12T10:00:00Z");

describe("agent jobs", () => {
  it("runs with autonomy ask: searches, proposes, waits; confirming carries it out; undo takes it back", async () => {
    const { model, systems } = agentModel([
      { tool: "vault_search", input: { query: "Mayer offene Punkte" } },
      { tool: "task_create", input: { title: "Mayer das Angebot schicken", source: 1 } },
    ], "Ich schlage eine Aufgabe vor [1].");
    const { deps, db, auth, ctx } = make(model);
    const job = await createJob(ctx, { prompt: "Was ist mit Mayer offen? Lege Aufgaben an." });
    expect(job).toMatchObject({ status: "queued", origin: "manual", autonomy: "ask", title: "Was ist mit Mayer offen? Lege Aufgaben an." });

    await runJob(deps, auth, job.id);
    const row = jobs(db)[0]!;
    expect(row.status).toBe("waiting");
    expect(row.result).toMatchObject({
      answer_md: "Ich schlage eine Aufgabe vor [1].",
      steps: [{ kind: "search", label: "Mayer offene Punkte", count: 1 }],
      sources: [{ n: 1, item_id: MEETING_ID, title: "Q4 Sync", type: "meeting" }],
      proposal: { labels: ["Aufgabe „Mayer das Angebot schicken“ anlegen"] },
    });
    expect(tasks(db)).toHaveLength(0);
    // The model was told that nobody is watching.
    expect(systems[0]).toContain("im Hintergrund");

    // A second run of the same job does nothing (already claimed).
    await runJob(deps, auth, job.id);
    expect(jobs(db)[0]!.status).toBe("waiting");

    const confirmed = await confirmJob(ctx, job.id, NOW);
    expect(confirmed.status).toBe("done");
    expect(confirmed.result?.proposal).toBeUndefined();
    expect(confirmed.result?.done?.results.map((r) => r.ok)).toEqual([true]);
    expect(tasks(db).map((t) => t.title)).toEqual(["Mayer das Angebot schicken"]);
    await expect(confirmJob(ctx, job.id, NOW)).rejects.toThrow();

    const undone = await undoJob(ctx, job.id);
    expect(undone.result?.undone).toBe(true);
    expect(tasks(db)).toHaveLength(0);
    await expect(undoJob(ctx, job.id)).rejects.toThrow();
  });

  it("runs with autonomy self: changes are carried out at once and the job is done", async () => {
    const { model } = agentModel([{ tool: "note_create", input: { title: "Briefing Mayer", markdown: "Stand: offen." } }]);
    const { deps, db, auth, ctx } = make(model);
    const job = await createJob(ctx, { prompt: "Schreib ein Briefing zu Mayer", autonomy: "self", skill: "briefing" });
    await runJob(deps, auth, job.id);
    const row = jobs(db)[0]!;
    expect(row.status).toBe("done");
    expect((row.result as { done: { results: Array<{ ok: boolean; label: string }> } }).done.results).toMatchObject([{ ok: true, label: "Notiz „Briefing Mayer“ angelegt" }]);
    expect((db.tables.knowledge_items as Array<{ title: string }>).map((i) => i.title)).toContain("Briefing Mayer");
  });

  it("a job without changes is done with its answer; a failing model ends in error", async () => {
    const ok = make(agentModel([], "Nichts offen.").model);
    const a = await createJob(ok.ctx, { prompt: "Ist etwas offen?", autonomy: "read" });
    await runJob(ok.deps, ok.auth, a.id);
    expect(jobs(ok.db)[0]).toMatchObject({ status: "done", result: { answer_md: "Nichts offen." } });

    const bad = make(agentModel([], "", true).model);
    const b = await createJob(bad.ctx, { prompt: "Ist etwas offen?" });
    await runJob(bad.deps, bad.auth, b.id);
    expect(jobs(bad.db)[0]!.status).toBe("error");
    expect(jobs(bad.db)[0]!.error).toBeTruthy();
  });

  it("a dismissed job leaves the list and is not overwritten by a late run", async () => {
    const { model } = agentModel([]);
    const { deps, db, auth, ctx } = make(model);
    const job = await createJob(ctx, { prompt: "Später vielleicht" });
    await dismissJob(ctx, job.id, NOW);
    await runJob(deps, auth, job.id);
    expect(jobs(db)[0]!.status).toBe("cancelled");
    expect(await listJobs(ctx, NOW)).toEqual([]);
  });

  it("closes a job that was cut off", async () => {
    const { db, ctx } = make(agentModel([]).model);
    db.rows("agent_jobs").push({ id: "22222222-2222-4222-8222-222222222222", user_id: USER_ID, title: "Hängt", prompt: "Hängt", skill: null, autonomy: "ask", status: "running", origin: "manual", action_item_id: null, result: null, error: null, created_at: "2026-11-12T09:00:00Z", started_at: "2026-11-12T09:00:00Z", finished_at: null });
    const list = await listJobs(ctx, NOW);
    expect(list[0]).toMatchObject({ status: "error", error: "Der Auftrag wurde unterbrochen. Starte ihn noch einmal." });
    expect(jobs(db)[0]!.status).toBe("error");
  });
});

describe("standing orders", () => {
  it("are created from a sentence and can be switched off", async () => {
    const { ctx } = make(agentModel([]).model);
    await expect(createStandingOrder(ctx, "Fasse alles zusammen")).rejects.toThrow(/wann und was/);
    const order = await createStandingOrder(ctx, "Jeden Morgen um 6 Uhr den Tagesstapel vorbereiten");
    expect(order).toMatchObject({ cadence: "daily", hour: 6, weekday: null, enabled: true, autonomy: "ask", prompt: "Den Tagesstapel vorbereiten" });
    await setStandingOrder(ctx, order.id, { enabled: false });
    expect((await listStandingOrders(ctx))[0]!.enabled).toBe(false);
  });

  it("the cron starts a due order once per period and runs the job", async () => {
    const { model } = agentModel([], "Stapel vorbereitet.");
    const { deps, db, ctx } = make(model, { KORTEX_TIMEZONE: "Europe/Berlin" });
    const order = await createStandingOrder(ctx, "Jeden Morgen um 6 Uhr den Tagesstapel vorbereiten");
    // 04:30 UTC = 05:30 in Berlin: too early.
    deps.now = () => new Date("2026-11-12T04:30:00Z");
    expect((await runStandingOrders(deps)).runs).toEqual([]);
    // 05:10 UTC = 06:10 in Berlin.
    deps.now = () => new Date("2026-11-12T05:10:00Z");
    const first = await runStandingOrders(deps);
    expect(first.runs).toMatchObject([{ order_id: order.id, user_id: USER_ID, period: "2026-11-12", status: "started" }]);
    expect(jobs(db)).toMatchObject([{ status: "done", origin: "standing", title: "Jeden Morgen um 6 Uhr den Tagesstapel vorbereiten", result: { answer_md: "Stapel vorbereitet." } }]);
    // An hour later: the day is claimed.
    deps.now = () => new Date("2026-11-12T06:10:00Z");
    expect((await runStandingOrders(deps)).runs).toEqual([]);
    expect(jobs(db)).toHaveLength(1);
    // The next morning it runs again.
    deps.now = () => new Date("2026-11-13T05:10:00Z");
    expect((await runStandingOrders(deps)).runs).toHaveLength(1);
    expect(jobs(db)).toHaveLength(2);
  });

  it("skips users who are no longer on the allowlist", async () => {
    const { deps, db, ctx } = make(agentModel([]).model);
    await createStandingOrder(ctx, "Täglich um 6 Uhr Inbox aufräumen");
    db.tables.allowed_users = [];
    deps.now = () => new Date("2026-11-12T08:00:00Z");
    expect((await runStandingOrders(deps)).runs).toMatchObject([{ status: "skipped", reason: "not_allowed" }]);
    expect(jobs(db)).toHaveLength(0);
  });

  it("POST /api/cron/agent needs the cron secret", async () => {
    const secret = "s".repeat(40);
    const { deps } = make(agentModel([]).model, { KORTEX_CRON_SECRET: secret });
    const h = createCronHandlers(() => deps);
    const call = (headers: Record<string, string>) => h.agent(new Request("https://kortex.test/api/cron/agent", { method: "POST", headers }));
    expect((await call({})).status).toBe(401);
    const res = await call({ "x-kortex-cron-secret": secret });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, runs: [] });
  });
});
