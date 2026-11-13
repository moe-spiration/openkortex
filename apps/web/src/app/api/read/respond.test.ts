import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ source: "supabase" as "supabase" | "mock", session: null as null | { user: { id: string } } }));
const loaders = vi.hoisted(() => ({
  loadDailyCheckin: vi.fn(async (date: string) => ({ ok: true as const, data: { date } })),
  getHomeBriefing: vi.fn(async (input: unknown) => ({ ok: true as const, data: input })),
  loadLife: vi.fn(async () => ({ ok: false as const, error: "kaputt" })),
}));

vi.mock("@/lib/supabase/config", () => ({ dataSource: () => env.source }));
vi.mock("@/lib/supabase/server", () => ({ getSession: async () => env.session }));
vi.mock("@/lib/api/actions", () => ({ loadDailyCheckin: loaders.loadDailyCheckin }));
vi.mock("@/server/home/actions", () => ({ getHomeBriefing: loaders.getHomeBriefing, getHomeData: vi.fn() }));
vi.mock("@/lib/data/life", () => ({ loadLife: loaders.loadLife, loadLifeScores: vi.fn() }));

const checkin = await import("./checkin/route");
const briefing = await import("./briefing/route");
const life = await import("./life/route");

const get = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => {
  env.source = "supabase";
  env.session = { user: { id: "u1" } };
  Object.values(loaders).forEach((l) => l.mockClear());
});

describe("read routes", () => {
  it("401 without a session, and the loader never runs", async () => {
    env.session = null;
    const res = await checkin.GET(get("/api/read/checkin?date=2026-10-25"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: false, error: "Nicht angemeldet" });
    expect(loaders.loadDailyCheckin).not.toHaveBeenCalled();
  });

  it("200 with the loader's result and private, no-store", async () => {
    const res = await checkin.GET(get("/api/read/checkin?date=2026-10-25"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ ok: true, data: { date: "2026-10-25" } });
    expect(loaders.loadDailyCheckin).toHaveBeenCalledWith("2026-10-25");
  });

  it("a loader error is a 500 with the same body shape", async () => {
    const res = await life.GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "kaputt" });
  });

  it("rejects a bad date or time zone with 400", async () => {
    expect((await checkin.GET(get("/api/read/checkin?date=heute"))).status).toBe(400);
    expect((await briefing.GET(get("/api/read/briefing?date=2026-10-25&tz=%3Cscript%3E"))).status).toBe(400);
    expect(loaders.loadDailyCheckin).not.toHaveBeenCalled();
    expect(loaders.getHomeBriefing).not.toHaveBeenCalled();
  });

  it("briefing passes a well-formed cached copy and drops a malformed one", async () => {
    const cached = { date: "2026-10-25", summary: "S", taskIds: ["t1"], kind: "ai", model: null, generatedAt: "2026-10-25T06:00:00Z" };
    await briefing.GET(get(`/api/read/briefing?date=2026-10-25&tz=Europe/Berlin&cached=${encodeURIComponent(JSON.stringify(cached))}`));
    expect(loaders.getHomeBriefing).toHaveBeenLastCalledWith({ date: "2026-10-25", timeZone: "Europe/Berlin", cached });
    await briefing.GET(get(`/api/read/briefing?date=2026-10-25&cached=${encodeURIComponent('{"summary":1}')}`));
    expect(loaders.getHomeBriefing).toHaveBeenLastCalledWith({ date: "2026-10-25", cached: null });
  });

  it("mock mode serves nothing (the client reads its mock data)", async () => {
    env.source = "mock";
    const res = await life.GET();
    expect(res.status).toBe(404);
    expect(loaders.loadLife).not.toHaveBeenCalled();
  });
});
