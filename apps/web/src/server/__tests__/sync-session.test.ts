import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../auth/api-tokens/secret";
import { scopeForPath, scopesFor } from "../auth/api-tokens/tokens";
import { createSyncSessionHandlers, SYNC_SESSION_TTL_SECONDS } from "../sync/session";
import { FakeSupabase } from "./fake-supabase";
import { NOW, setup, USER_ID } from "./helpers";

const URL_ = "https://kortex.test/api/sync/session";
const SECRET = "jwt-secret-for-tests-0123456789abcdef";

function make(scopes: string[], env: Record<string, string> = { SUPABASE_JWT_SECRET: SECRET }) {
  const db = new FakeSupabase();
  const raw = generateToken();
  db.rows("api_tokens").push({
    id: "tok-1",
    user_id: USER_ID,
    name: "Windows-App",
    token_hash: hashToken(raw),
    token_prefix: raw.slice(0, 11),
    scopes,
    created_at: NOW.toISOString(),
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
  });
  const s = setup({ db, env });
  return { h: createSyncSessionHandlers(() => s.deps), raw, db };
}

const post = (h: ReturnType<typeof createSyncSessionHandlers>, token?: string) =>
  h.POST(new Request(URL_, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} }));

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

describe("POST /api/sync/session", () => {
  it("trades a kx_ token with the sync scope for a signed user JWT", async () => {
    const { h, raw } = make(["ingest", "search", "ask", "sync"]);
    const res = await post(h, raw);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, user_id: USER_ID, supabase_url: "https://supabase.test", anon_key: "anon" });
    expect(body.expires_at).toBe(Math.floor(NOW.getTime() / 1000) * 1000 + SYNC_SESSION_TTL_SECONDS * 1000);
    const jwt = body.access_token as string;
    expect(decode(jwt)).toMatchObject({ sub: USER_ID, role: "authenticated", aud: "authenticated" });
    const [head, payload, sig] = jwt.split(".");
    expect(createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url")).toBe(sig);
    // Never hands out the service role.
    expect(JSON.stringify(body)).not.toContain("service");
  });

  it("refuses tokens without the sync scope (every older token)", async () => {
    const { h, raw } = make(["ingest", "search", "ask"]);
    const res = await post(h, raw);
    expect(res.status).toBe(401);
  });

  it("refuses revoked tokens and anonymous calls", async () => {
    const { h, raw, db } = make(["ingest", "sync"]);
    db.rows("api_tokens")[0]!.revoked_at = NOW.toISOString();
    expect((await post(h, raw)).status).toBe(401);
    expect((await post(h)).status).toBe(401);
  });

  it("says so when the server has no JWT secret", async () => {
    const { h, raw } = make(["ingest", "sync"], {});
    const res = await post(h, raw);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toMatch(/SUPABASE_JWT_SECRET/);
  });

  it("the sync scope is POST-only and only requested on purpose", () => {
    expect(scopeForPath("/api/sync/session", "POST")).toBe("sync");
    expect(scopeForPath("/api/sync/session", "GET")).toBeNull();
    expect(scopesFor({ search: true, ask: true })).not.toContain("sync");
    expect(scopesFor({ search: true, ask: true, sync: true })).toEqual(["ingest", "search", "ask", "sync"]);
  });
});
