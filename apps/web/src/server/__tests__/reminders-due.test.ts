import { describe, expect, it } from "vitest";
import { scopeForPath } from "../auth/api-tokens/tokens";
import { createDueHandlers } from "../reminder/due";
import { FakeSupabase } from "./fake-supabase";
import { OTHER_USER, setup, USER_ID } from "./helpers";

const URL_ = "https://kortex.test/api/reminders/due";
const A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const B = "11111111-1111-4111-8111-bbbbbbbbbbbb";
const C = "11111111-1111-4111-8111-cccccccccccc";
const D = "11111111-1111-4111-8111-dddddddddddd";
const E = "11111111-1111-4111-8111-eeeeeeeeeeee";

const row = (id: string, extra: Record<string, unknown>) => ({ id, user_id: USER_ID, title: `T-${id.slice(-4)}`, status: "processed", source_url: null, remind_at: null, metadata: {}, ...extra });
const get = (h: ReturnType<typeof createDueHandlers>) => h.GET(new Request(URL_, { headers: { authorization: "Bearer kx_test_token_0123456789abcdef" } }));

function make() {
  const db = new FakeSupabase({
    allowed_users: [{ user_id: USER_ID }],
    knowledge_items: [
      row(A, { remind_at: "2026-10-23T06:00:00.000Z", source_url: "https://example.com/a" }), // due
      row(B, { remind_at: "2026-10-24T06:00:00.000Z" }), // later
      row(C, { remind_at: "2026-10-22T06:00:00.000Z", status: "archived" }), // archived
      row(D, { source_url: "https://shop.example.com", metadata: { watch: { enabled: true, interval: "daily", last_diff: { at: "2026-10-23T05:00:00.000Z", summary: "Preis", added: [], removed: [] } } } }),
      row(E, { metadata: { watch: { enabled: true, interval: "daily", seen_at: "2026-10-23T06:00:00.000Z", last_diff: { at: "2026-10-23T05:00:00.000Z", summary: "x", added: [], removed: [] } } } }), // seen
      { ...row("22222222-2222-4222-8222-222222222222", { remind_at: "2026-10-01T00:00:00.000Z" }), user_id: OTHER_USER },
    ],
  });
  const s = setup({ db });
  return createDueHandlers(() => s.deps);
}

describe("GET /api/reminders/due", () => {
  it("returns due reminders and unseen radar changes, oldest first, own items only", async () => {
    const res = await get(make());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual([
      { id: `radar:${D}:2026-10-23T05:00:00.000Z`, title: "T-dddd", remind_at: "2026-10-23T05:00:00.000Z", kind: "radar", url: "https://shop.example.com" },
      { id: A, title: "T-aaaa", remind_at: "2026-10-23T06:00:00.000Z", kind: "reminder", url: "https://example.com/a" },
    ]);
  });

  it("needs auth", async () => {
    expect((await make().GET(new Request(URL_))).status).toBe(401);
  });

  it("is open to personal tokens with the read scope, GET only", () => {
    expect(scopeForPath("/api/reminders/due", "GET")).toBe("search");
    expect(scopeForPath("/api/reminders/due", "POST")).toBeNull();
  });
});
