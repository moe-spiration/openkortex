import { generateText, streamText } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { enforceLimits, resetAccessCache, resetRateLimits, withUsageContext } from "../limits";
import { meterLanguageModel } from "../limits/meter";
import { estimateCost, providerOf, tokenCounts, usdToEur } from "../limits/pricing";
import { createRateLimiter, DEFAULT_RULES, rulesFromEnv } from "../limits/rate-limit";
import { createModelsHandlers } from "../routing/models";
import { FakeSupabase } from "./fake-supabase";
import { API_TOKEN, authed, mockModel, NOW, setup, USER_ID } from "./helpers";

beforeEach(() => {
  resetAccessCache();
  resetRateLimits();
});

const ctxOf = (t: ReturnType<typeof setup>) => ({ auth: { userId: USER_ID, mode: "api_token" as const, client: t.db.client }, deps: t.deps });

describe("rate limiter (sliding window)", () => {
  it("allows max per window, then refuses with a retry time, and frees up as the window slides", () => {
    let now = 0;
    const rl = createRateLimiter({ ...DEFAULT_RULES, chat: { max: 2, windowMs: 60_000 } }, () => now);
    expect(rl.hit("u", "chat").ok).toBe(true);
    now = 10_000;
    expect(rl.hit("u", "chat")).toMatchObject({ ok: true, remaining: 0 });
    now = 20_000;
    expect(rl.hit("u", "chat")).toMatchObject({ ok: false, retryAfterSec: 40 });
    expect(rl.hit("other", "chat").ok).toBe(true);
    now = 60_001;
    expect(rl.hit("u", "chat").ok).toBe(true);
  });

  it("reads KORTEX_RATE_<KIND> overrides", () => {
    const r = rulesFromEnv({ KORTEX_RATE_CHAT: "5/10", KORTEX_RATE_MODELS: "3", KORTEX_RATE_INGEST: "nonsense" });
    expect(r.chat).toEqual({ max: 5, windowMs: 10_000 });
    expect(r.models).toEqual({ max: 3, windowMs: 60_000 });
    expect(r.ingest).toEqual(DEFAULT_RULES.ingest);
  });
});

describe("pricing", () => {
  it("uses catalog prices, else a conservative default", () => {
    expect(estimateCost({ input: 1_000_000, output: 100_000 }, { input_per_mtok: 1, output_per_mtok: 5 })).toEqual({ usd: 1.5, estimated: false });
    expect(estimateCost({ input: 1_000_000, output: 0 }, null)).toEqual({ usd: 15, estimated: true });
    expect(estimateCost({ input: 1_000_000, output: 0 }, undefined, "embedding").usd).toBe(0.2);
  });

  it("reads AI SDK usage shapes and provider ids", () => {
    expect(tokenCounts({ inputTokens: { total: 12 }, outputTokens: { total: 3 } })).toEqual({ input: 12, output: 3 });
    expect(tokenCounts({ inputTokens: 7, outputTokens: 2 })).toEqual({ input: 7, output: 2 });
    expect(tokenCounts({ tokens: 40 })).toEqual({ input: 40, output: 0 });
    expect(providerOf("anthropic.messages")).toBe("anthropic");
    expect(providerOf("openrouter.chat")).toBe("openrouter");
    expect(providerOf("mock-provider")).toBe("unknown");
    expect(usdToEur(1.08)).toBeCloseTo(1);
  });
});

describe("enforceLimits", () => {
  it("refuses accounts that are not on the allowlist (no_access 403)", async () => {
    const t = setup({ db: new FakeSupabase({ allowed_users: [] }) });
    await expect(enforceLimits(ctxOf(t), "chat")).rejects.toMatchObject({ code: "no_access", status: 403 });
  });

  it("stops AI kinds once today's spend reaches the budget (budget_exceeded 402), not the models list", async () => {
    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(NOW);
    const t = setup({
      db: new FakeSupabase({
        user_settings: [{ user_id: USER_ID, daily_ai_budget_eur: 0.5 }],
        ai_usage: [{ user_id: USER_ID, day, cost_usd: 0.6 }],
      }),
    });
    const err = await enforceLimits(ctxOf(t), "chat").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "budget_exceeded", status: 402 });
    expect((err as Error).message).toContain("Tagesbudget");
    await expect(enforceLimits(ctxOf(t), "models")).resolves.toBeNull();
  });

  it("lets calls through below the budget (default 2 EUR without a settings row)", async () => {
    const t = setup();
    await expect(enforceLimits(ctxOf(t), "ingest")).resolves.toMatchObject({ budgetEur: 2, exceeded: false });
  });
});

describe("routes", () => {
  it("answers 429 with Retry-After once the per-user window is full", async () => {
    const t = setup({ env: { KORTEX_RATE_MODELS: "2/60" } });
    const h = createModelsHandlers(() => t.deps);
    const get = () => h.GET(new Request("https://kortex.test/api/models?provider=anthropic", authed()));
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  });

  it("every route refuses a signed-in account that is not allowlisted (403)", async () => {
    const t = setup({ db: new FakeSupabase({ allowed_users: [{ user_id: "someone-else" }] }) });
    const res = await createModelsHandlers(() => t.deps).GET(new Request("https://kortex.test/api/models", authed({ token: API_TOKEN })));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_access");
  });
});

describe("metering", () => {
  it("records generate and stream calls (tokens + cost) for the request's user", async () => {
    const t = setup({ catalog: [{ provider: "unknown", model_id: "mock-chat", pricing: { input_per_mtok: 1, output_per_mtok: 2 } } as never] });
    const model = meterLanguageModel(t.deps, mockModel([{ ok: true }]), "summarize");
    await withUsageContext({ userId: USER_ID }, async () => {
      await generateText({ model, prompt: "Hallo" });
      const s = streamText({ model, prompt: "Hallo" });
      await s.consumeStream();
    });
    const rows = t.db.rows("ai_usage");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: USER_ID, task: "summarize", model_id: "mock-chat", input_tokens: 10, output_tokens: 10 });
    expect(Number(rows[0]!.cost_usd)).toBeGreaterThan(0);
    expect(t.clientKinds).toContain("service");
  });

  it("does not record without a payer", async () => {
    const t = setup();
    await generateText({ model: meterLanguageModel(t.deps, mockModel([{}]), "summarize"), prompt: "x" });
    expect(t.db.rows("ai_usage")).toHaveLength(0);
  });
});
