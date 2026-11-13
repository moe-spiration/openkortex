import { describe, expect, it } from "vitest";
import { CRON_SECRET_HEADER, createCronHandlers } from "../cron/handler";
import { localTime, weekKey } from "../cron/digest";
import { FakeSupabase } from "./fake-supabase";
import { mockModel, mockRouter, NOW, seedFolders, setup, USER_ID } from "./helpers";

const URL_ = "https://kortex.test/api/cron/digest";
const SECRET = "cron-secret-0123456789-abcdefghijklmnop";
const OTHER = "33333333-3333-4333-8333-333333333333";
const NO_SETTINGS = "44444444-4444-4444-8444-444444444444";

const digestOut = {
  headline: "Kortex-Woche: MCP beschlossen.",
  themes: [
    { title: "Agenten", summary: "MCP wird die Schnittstelle.", items: ["Q4 Architektur-Sync"] },
  ],
  connections: [],
  open_loops: [],
  questions: [],
  suggestions: ["MCP testen.", "Docs schreiben.", "Pause machen."],
  focus: { topics: ["MCP"], projects: ["Kortex"], interests: [] },
};

/** NOW (Fri 2026-10-23, 10:00 in Berlin): USER_ID's digest day is Friday, OTHER's is Monday. */
function make(opts: { env?: Record<string, string>; budget?: number } = {}) {
  const db = new FakeSupabase({
    allowed_users: [{ user_id: USER_ID }, { user_id: OTHER }, { user_id: NO_SETTINGS }],
    user_settings: [
      { user_id: USER_ID, weekly_digest_day: 5, daily_ai_budget_eur: opts.budget ?? 2 },
      { user_id: OTHER, weekly_digest_day: 1, daily_ai_budget_eur: 2 },
    ],
    knowledge_items: [
      {
        id: "m1",
        user_id: USER_ID,
        title: "Q4 Architektur-Sync",
        type: "meeting",
        summary: "MCP beschlossen.",
        content_md: "…",
        cluster_name: "Kortex",
        folder_path: "20_Meetings",
        updated_at: "2026-10-21T10:00:00Z",
      },
    ],
    action_items: [],
  });
  seedFolders(db);
  const s = setup({
    db,
    // The cron writes digests on the cheap summarize route (fast), not chat_reasoning.
    // Monthly syntheses use chat_reasoning (chat).
    models: mockRouter({ fast: mockModel([digestOut]), chat: mockModel([digestOut]) }),
    env: { KORTEX_CRON_SECRET: SECRET, ...opts.env },
  });
  return { ...s, h: createCronHandlers(() => s.deps) };
}

const call = (body?: unknown, secret: string | null = SECRET) =>
  new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { [CRON_SECRET_HEADER]: secret } : {}),
    },
    body: body === undefined ? "" : JSON.stringify(body),
  });

describe("POST /api/cron/digest", () => {
  it("refuses without or with a wrong secret, and when no secret is configured", async () => {
    const { h } = make();
    expect((await h.digest(call(undefined, null))).status).toBe(401);
    expect((await h.digest(call(undefined, "wrong"))).status).toBe(401);
    const off = make({ env: { KORTEX_CRON_SECRET: "short" } });
    expect((await off.h.digest(call())).status).toBe(503);
  });

  it("runs the digest for users whose day has come, once per ISO week", async () => {
    const { h, db } = make();
    const res = await h.digest(call());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, timezone: "Europe/Berlin", checked: 3 });
    expect(body.results).toEqual([
      expect.objectContaining({ user_id: USER_ID, period: "2026-W43", status: "done", digests: 1 }),
    ]);
    const digest = db.rows("knowledge_items").find((r) => r.type === "digest");
    // One deep weekly synthesis: 90_Digests/Weekly/2026-W43.md (md-sync: <folder_path>/<slug>.md).
    expect(digest).toMatchObject({
      user_id: USER_ID,
      folder_path: "90_Digests/Weekly",
      slug: "2026-W43",
      tags: ["digest/weekly", "digest/synthesis"],
    });
    expect(db.rows("knowledge_items").find((r) => r.slug === "Focus-Profile")).toMatchObject({
      folder_path: "40_AI_Memories",
      type: "note",
    });
    expect((digest!.metadata as { model_used?: string }).model_used).toBe("mock/fast");
    expect(db.rows("cron_runs")).toEqual([
      expect.objectContaining({
        user_id: USER_ID,
        job: "weekly_digest",
        period: "2026-W43",
        status: "done",
      }),
    ]);

    // The next hourly call in the same week does nothing.
    const again = await (await h.digest(call())).json();
    expect(again.results).toEqual([]);
    expect(db.rows("knowledge_items").filter((r) => r.type === "digest")).toHaveLength(1);
  });

  it("a non-numeric or out-of-range KORTEX_DIGEST_HOUR falls back to the default instead of disabling digests", async () => {
    const base = (await (await make().h.digest(call({ dry_run: true }))).json()).results;
    for (const bad of ["abc", "25", "-1", "7.5"]) {
      const { h } = make({ env: { KORTEX_DIGEST_HOUR: bad } });
      expect((await (await h.digest(call({ dry_run: true }))).json()).results).toEqual(base);
    }
  });

  it("before the configured hour nobody is due; dry_run and force for manual runs", async () => {
    const early = make({ env: { KORTEX_DIGEST_HOUR: "11" } });
    expect((await (await early.h.digest(call())).json()).results).toEqual([]);

    const { h, db } = make();
    const dry = await (
      await h.digest(call({ dry_run: true, force: true, jobs: ["weekly"] }))
    ).json();
    expect(
      dry.results.map((r: { user_id: string; status: string }) => [r.user_id, r.status]),
    ).toEqual([
      [USER_ID, "due"],
      [OTHER, "due"],
    ]);
    expect(db.rows("cron_runs")).toEqual([]);
    const forced = await (
      await h.digest(call({ force: true, user_ids: [OTHER], jobs: ["weekly"] }))
    ).json();
    expect(forced.results).toEqual([
      expect.objectContaining({ user_id: OTHER, status: "done", digests: 0 }),
    ]);
  });

  it("a user over the day budget is skipped and retried later", async () => {
    const { h, db, deps } = make({ budget: 0 });
    const body = await (await h.digest(call())).json();
    expect(body.results).toEqual([
      expect.objectContaining({ user_id: USER_ID, status: "skipped", reason: "budget_exceeded" }),
    ]);
    expect(db.rows("cron_runs")[0]).toMatchObject({
      status: "error",
      error: "budget_exceeded",
      attempts: 1,
    });

    // Too early for a retry …
    expect((await (await h.digest(call())).json()).results).toEqual([]);
    // … but 6 h later (budget raised) it runs.
    db.rows("user_settings")[0]!.daily_ai_budget_eur = 2;
    deps.now = () => new Date(NOW.getTime() + 6 * 3600_000);
    const later = await (await h.digest(call())).json();
    expect(later.results).toEqual([expect.objectContaining({ user_id: USER_ID, status: "done" })]);
    expect(db.rows("cron_runs")[0]).toMatchObject({ status: "done", attempts: 2 });
  });

  it("on the 1st of the month the monthly synthesis runs once for the month that ended", async () => {
    const { h, db, deps } = make();
    // Sunday 2026-11-01, 08:00 in Berlin: nobody's weekly day, but the 1st.
    deps.now = () => new Date("2026-11-01T07:00:00Z");
    const body = await (await h.digest(call())).json();
    expect(
      body.results.map((r: { user_id: string; job: string; period: string; digests: number }) => [
        r.user_id,
        r.job,
        r.period,
        r.digests,
      ]),
    ).toEqual([
      [USER_ID, "monthly_digest", "2026-10", 1],
      [OTHER, "monthly_digest", "2026-10", 0],
    ]);
    const monthly = db
      .rows("knowledge_items")
      .filter((r) => r.folder_path === "90_Digests/Monthly");
    expect(monthly).toEqual([expect.objectContaining({ slug: "2026-10", user_id: USER_ID })]);
    expect((monthly[0]!.metadata as { model_used?: string }).model_used).toBe("mock/chat");

    expect((await (await h.digest(call())).json()).results).toEqual([]);
    // Even a forced rerun of the claim finds the existing file and writes no second one.
    await h.digest(call({ force: true, rerun: false, jobs: ["monthly"] }));
    expect(
      db.rows("knowledge_items").filter((r) => r.folder_path === "90_Digests/Monthly"),
    ).toHaveLength(1);
  });

  it("local time and week key", () => {
    // 2026-10-25 00:30 UTC is Sunday 02:30 in Berlin (DST ends at 01:00 UTC) but Saturday in New York.
    const at = new Date("2026-10-25T00:30:00Z");
    expect(localTime(at, "Europe/Berlin")).toMatchObject({ weekday: 0, hour: 2 });
    expect(localTime(at, "America/New_York")).toMatchObject({ weekday: 6, hour: 20 });
    expect(weekKey(localTime(at, "Europe/Berlin").date)).toBe("2026-W43");
  });
});
