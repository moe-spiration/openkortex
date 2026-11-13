import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/lib/api";
import { remindOptions } from "../src/lib/remind";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/lib/settings";

const settings = (over: Partial<ExtensionSettings> = {}) => async () => ({ ...DEFAULT_SETTINGS, ...over });
const live = { mockMode: false, baseUrl: "https://kortex.example.com", token: "secret-token" };
const ITEM = "11111111-1111-4111-8111-111111111111";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("remindOptions", () => {
  it("offers tonight 18:00, tomorrow 08:00 and next Monday 08:00 in local time", () => {
    const wed = new Date(2026, 10, 4, 10, 0); // Wed 4 Nov 2026, 10:00 local
    const [tonight, tomorrow, nextWeek] = remindOptions(wed);
    expect(new Date(tonight!.iso).getHours()).toBe(18);
    expect(new Date(tonight!.iso).getDate()).toBe(4);
    expect(new Date(tomorrow!.iso).getDate()).toBe(5);
    expect(new Date(tomorrow!.iso).getHours()).toBe(8);
    expect(new Date(nextWeek!.iso).getDay()).toBe(1);
    expect(new Date(nextWeek!.iso).getDate()).toBe(9);
  });

  it("moves tonight to 21:00 after 18:00 and drops it after 21:00", () => {
    const evening = remindOptions(new Date(2026, 10, 4, 19, 0));
    expect(new Date(evening[0]!.iso).getHours()).toBe(21);
    expect(remindOptions(new Date(2026, 10, 4, 22, 0)).map((o) => o.key)).toEqual(["tomorrow", "next-week"]);
  });
});

describe("api.remind", () => {
  it("posts item_id and remind_at to /api/reminder with the token", async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: true, item_id: ITEM, remind_at: "2026-11-05T07:00:00.000Z" }));
    const api = createApiClient({ getSettings: settings(live), fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await api.remind(ITEM, "2026-11-05T07:00:00.000Z");
    expect(res).toEqual({ ok: true, data: { remind_at: "2026-11-05T07:00:00.000Z" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://kortex.example.com/api/reminder");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ item_id: ITEM, remind_at: "2026-11-05T07:00:00.000Z" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("reports server errors and never touches the network in mock mode", async () => {
    const failing = createApiClient({
      getSettings: settings(live),
      fetchImpl: (async () => json(403, { ok: false, error: { code: "unauthorized", message: "nein" } })) as unknown as typeof fetch,
    });
    expect(await failing.remind(ITEM, null)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const fetchImpl = vi.fn();
    const mock = createApiClient({ getSettings: settings({ mockMode: true }), fetchImpl });
    expect(await mock.remind(ITEM, "2026-11-05T07:00:00.000Z")).toMatchObject({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
