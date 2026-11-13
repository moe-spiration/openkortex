import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { authenticate } from "../auth";
import { createToken, deleteToken, listTokens, resolveToken, revokeToken } from "../auth/api-tokens/store";
import { generateToken, hashToken } from "../auth/api-tokens/secret";
import { looksLikePersonalToken, scopeForPath, scopesFor, tokenState } from "../auth/api-tokens/tokens";
import { createTranscribeHandlers } from "../chat/transcribe";
import { createIngestHandlers } from "../ingest/handler";
import { FakeSupabase } from "./fake-supabase";
import {
  fakeFetch,
  json,
  mockModel,
  mockRouter,
  NOW,
  OTHER_USER,
  seedFolders,
  setup,
  USER_ID,
} from "./helpers";

const BASE = "https://kortex.test/api/ingest";
const MINUTE = 60_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function seedToken(db: FakeSupabase, over: Record<string, unknown> = {}) {
  const raw = generateToken();
  db.rows("api_tokens").push({
    id: `tok-${db.rows("api_tokens").length + 1}`,
    user_id: USER_ID,
    name: "Chrome",
    token_hash: hashToken(raw),
    token_prefix: raw.slice(0, 11),
    scopes: ["ingest"],
    created_at: iso(-86_400_000),
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    ...over,
  });
  return raw;
}

function make(db = new FakeSupabase()) {
  seedFolders(db);
  const s = setup({
    db,
    fetch: fakeFetch([
      {
        match: (u) => u.startsWith("https://r.jina.ai/"),
        respond: () =>
          json({ data: { title: "Artikel", url: "https://example.com/a", content: `# Artikel\n\n${"Text. ".repeat(200)}` } }),
      },
    ]),
    models: mockRouter({
      fast: mockModel([{ title: "Artikel", summary: "s", cluster_name: "Misc", suggested_folder_path: "30_Clippings", tags: [], entities: [], action_items: [] }]),
    }),
  });
  return { ...s, db, h: createIngestHandlers(() => s.deps) };
}

const bearer = (token: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
});

describe("token format", () => {
  it("generates kx_ + 43 url-safe chars, unique, and only the hash identifies it", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^kx_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(looksLikePersonalToken(a)).toBe(true);
    expect(looksLikePersonalToken("kx_short")).toBe(false);
    expect(looksLikePersonalToken("a.b.c")).toBe(false);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a.slice(3));
  });

  it("only accepts personal tokens on the capture endpoints and the search", () => {
    expect(scopeForPath("/api/ingest")).toBe("ingest");
    expect(scopeForPath("/api/ingest/anything")).toBe("ingest");
    expect(scopeForPath("/api/chat/transcribe")).toBe("ingest");
    expect(scopeForPath("/api/search")).toBe("search");
    expect(scopeForPath("/api/search/x")).toBeNull();
    expect(scopeForPath("/api/chat/transcribe/x")).toBeNull();
    expect(scopeForPath("/api/chat")).toBeNull();
    expect(scopeForPath("/api/meeting/live")).toBeNull();
    expect(scopeForPath("/api/ingestion")).toBeNull();
  });

  it("lets the web clipper remove a highlight (POST only)", () => {
    expect(scopeForPath("/api/highlight", "POST")).toBe("ingest");
    expect(scopeForPath("/api/highlight", "GET")).toBeNull();
    expect(scopeForPath("/api/highlight/x", "POST")).toBeNull();
  });

  it("lets the desktop write a live meeting (ingest) and coach it (search), never read it back", () => {
    expect(scopeForPath("/api/meeting/live", "POST")).toBe("ingest");
    expect(scopeForPath("/api/meeting/live", "post")).toBe("ingest");
    expect(scopeForPath("/api/meeting/live", "GET")).toBeNull();
    expect(scopeForPath("/api/meeting/coach", "POST")).toBe("search");
    expect(scopeForPath("/api/meeting/coach", "GET")).toBeNull();
    expect(scopeForPath("/api/meeting/live/x", "POST")).toBeNull();
  });

  it("opens the copilot (POST /api/chat) only with the ask scope, never its write actions", () => {
    expect(scopeForPath("/api/chat", "POST")).toBe("ask");
    expect(scopeForPath("/api/chat", "GET")).toBeNull();
    expect(scopeForPath("/api/chat/action", "POST")).toBeNull();
    expect(scopesFor()).toEqual(["ingest"]);
    expect(scopesFor({ search: true, ask: true })).toEqual(["ingest", "search", "ask"]);
    expect(scopesFor({ ask: true })).toEqual(["ingest", "ask"]);
  });

  it("derives state from revoked_at / expires_at", () => {
    expect(tokenState({ revoked_at: null, expires_at: null }, NOW)).toBe("active");
    expect(tokenState({ revoked_at: iso(-1), expires_at: null }, NOW)).toBe("revoked");
    expect(tokenState({ revoked_at: null, expires_at: iso(-1) }, NOW)).toBe("expired");
    expect(tokenState({ revoked_at: null, expires_at: iso(MINUTE) }, NOW)).toBe("active");
  });
});

describe("Bearer kx_… on /api/chat/transcribe (desktop voice notes)", () => {
  function transcribeSetup(db = new FakeSupabase()) {
    const seen: string[] = [];
    const models = Object.assign(mockRouter(), {
      transcriber: () => ({
        id: "edenai:deepgram",
        transcribe: async () => [{ startSec: 0, endSec: 3, text: "Milch kaufen." }],
        transcribeUrl: async () => [],
      }),
    });
    const s = setup({ db, models });
    return { ...s, seen, h: createTranscribeHandlers(() => s.deps) };
  }
  const audioReq = (token: string) => {
    const form = new FormData();
    form.append("audio", new File([new Uint8Array([1, 2, 3, 4])], "voice.wav", { type: "audio/wav" }));
    return new Request("https://kortex.test/api/chat/transcribe", bearer(token, { method: "POST", body: form }));
  };

  it("transcribes as the token owner with the ingest scope", async () => {
    const { h, db, clientKinds } = transcribeSetup();
    const raw = seedToken(db, { name: "Desktop" });
    const res = await h.POST(audioReq(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, text: "Milch kaufen.", model: "edenai:deepgram" });
    expect(clientKinds).toContain("service");
  });

  it("refuses a revoked token", async () => {
    const { h, db } = transcribeSetup();
    const raw = seedToken(db, { revoked_at: iso(-MINUTE) });
    const res = await h.POST(audioReq(raw));
    expect(res.status).toBe(401);
  });
});

describe("Bearer kx_… on /api/ingest", () => {
  it("acts as the token owner, reports the token name and records last use", async () => {
    const { h, db, clientKinds } = make();
    const raw = seedToken(db, { name: "Laptop" });
    const res = await h.GET(new Request(BASE, bearer(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user_id: USER_ID, token_name: "Laptop" });
    expect(clientKinds).toContain("service");
    expect(db.rows("api_tokens")[0]!.last_used_at).toBeTruthy();
  });

  it("refuses a deleted token (401)", async () => {
    const { h, db } = make();
    const raw = seedToken(db);
    await deleteToken(db.client, USER_ID, db.rows("api_tokens")[0]!.id as string);
    const res = await h.GET(new Request(BASE, bearer(raw)));
    expect(res.status).toBe(401);
  });

  it("touches last_used_at at most once a minute", async () => {
    const { h, db } = make();
    const recent = new Date(Date.now() - 5_000).toISOString();
    const raw = seedToken(db, { last_used_at: recent });
    await h.GET(new Request(BASE, bearer(raw)));
    expect(db.rows("api_tokens")[0]!.last_used_at).toBe(recent);

    db.rows("api_tokens")[0]!.last_used_at = new Date(Date.now() - 5 * MINUTE).toISOString();
    const stale = db.rows("api_tokens")[0]!.last_used_at;
    await h.GET(new Request(BASE, bearer(raw)));
    expect(db.rows("api_tokens")[0]!.last_used_at).not.toBe(stale);
  });

  it("captures into the owner's account (POST web_clip) with every query scoped to the owner", async () => {
    const { h, db, drain } = make();
    const raw = seedToken(db);
    const res = await h.POST(
      new Request(BASE, {
        ...bearer(raw, { method: "POST", headers: { "content-type": "application/json" } }),
        body: JSON.stringify({
          kind: "web_clip",
          client: { name: "kortex-extension", version: "0.1.0" },
          captured_at: NOW.toISOString(),
          url: "https://example.com/a",
          title: "Artikel",
          tags: [],
          idempotency_key: "11111111-2222-4333-8444-555555555555",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    await drain();
    const items = db.rows("knowledge_items");
    expect(items.length).toBe(1);
    expect(items[0]!.user_id).toBe(USER_ID);
  });

  it.each([
    ["unknown", () => `kx_${"A".repeat(43)}`, /Ungültig/],
    ["revoked", (db: FakeSupabase) => seedToken(db, { revoked_at: iso(-MINUTE) }), /widerrufen/],
    ["expired", (db: FakeSupabase) => seedToken(db, { expires_at: iso(-MINUTE) }), /abgelaufen/],
    ["without the ingest scope", (db: FakeSupabase) => seedToken(db, { scopes: [] }), /nicht verwendet/],
  ])("rejects a %s token with 401", async (_name, mk, message) => {
    const { h, db } = make();
    const raw = mk(db);
    const res = await h.GET(new Request(BASE, bearer(raw)));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toMatch(message);
  });

  it("still enforces the allowlist: a token of a non-allowlisted account is refused (403)", async () => {
    const db = new FakeSupabase({ allowed_users: [{ user_id: "someone-else" }] });
    const { h } = make(db);
    const raw = seedToken(db, { user_id: OTHER_USER });
    const res = await h.GET(new Request(BASE, bearer(raw)));
    expect(res.status).toBe(403);
  });

  it("does not open other routes to personal tokens", async () => {
    const t = setup();
    const raw = seedToken(t.db);
    await expect(
      authenticate(new Request("https://kortex.test/api/chat", bearer(raw)), t.deps.env, t.deps.clients, []),
    ).rejects.toMatchObject({ code: "unauthorized", status: 403 });
  });

  it("keeps the owner-wide token working", async () => {
    const { h } = make();
    const res = await h.GET(new Request(BASE, bearer("kx_test_token_0123456789abcdef")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user_id: USER_ID });
  });
});

describe("token store (as the signed-in user)", () => {
  it("creates a token: raw value once, only the hash stored, listing never exposes either", async () => {
    const db = new FakeSupabase();
    const { token, row } = await createToken(db.client, USER_ID, "  Chrome   Laptop ", NOW);
    expect(token).toMatch(/^kx_/);
    expect(row.name).toBe("Chrome Laptop");
    const stored = db.rows("api_tokens");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored[0]!.token_prefix).toBe(token.slice(0, 11));
    expect(stored[0]!.scopes).toEqual(["ingest"]);

    const listed = await listTokens(db.client, USER_ID);
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("adds the search scope only on request", async () => {
    const db = new FakeSupabase();
    const { token } = await createToken(db.client, USER_ID, "Desktop", NOW, { search: true });
    expect(db.rows("api_tokens")[0]!.scopes).toEqual(["ingest", "search"]);
    expect((await resolveToken(db.client, token, "search", NOW)).ok).toBe(true);
    const plain = await createToken(db.client, USER_ID, "Chrome", NOW);
    expect(await resolveToken(db.client, plain.token, "search", NOW)).toEqual({ ok: false, reason: "scope" });
    // Desktop token: search plus "Fragen".
    const desk = await createToken(db.client, USER_ID, "Windows", NOW, { search: true, ask: true });
    expect((await resolveToken(db.client, desk.token, "ask", NOW)).ok).toBe(true);
    expect(await resolveToken(db.client, plain.token, "ask", NOW)).toEqual({ ok: false, reason: "scope" });
  });

  it("validates the name and caps active tokens", async () => {
    const db = new FakeSupabase();
    await expect(createToken(db.client, USER_ID, "   ", NOW)).rejects.toThrow(/Namen/);
    await expect(createToken(db.client, USER_ID, "x".repeat(81), NOW)).rejects.toThrow(/zu lang/);
    for (let i = 0; i < 10; i++) await createToken(db.client, USER_ID, `t${i}`, NOW);
    await expect(createToken(db.client, USER_ID, "elf", NOW)).rejects.toThrow(/Maximal 10/);
  });

  it("revokes a token (once) and a revoked token stops resolving", async () => {
    const db = new FakeSupabase();
    const { token, row } = await createToken(db.client, USER_ID, "Chrome", NOW);
    expect((await resolveToken(db.client, token, "ingest", NOW)).ok).toBe(true);
    await revokeToken(db.client, USER_ID, row.id, NOW);
    expect(await resolveToken(db.client, token, "ingest", NOW)).toEqual({ ok: false, reason: "revoked" });
    await expect(revokeToken(db.client, USER_ID, row.id, NOW)).rejects.toThrow(/nicht gefunden/);
  });

  it("deletes a token (active or revoked): it is gone from the list and stops resolving", async () => {
    const db = new FakeSupabase();
    const a = await createToken(db.client, USER_ID, "Chrome", NOW);
    const b = await createToken(db.client, USER_ID, "Alt", NOW);
    await revokeToken(db.client, USER_ID, b.row.id, NOW);
    await deleteToken(db.client, USER_ID, a.row.id);
    await deleteToken(db.client, USER_ID, b.row.id);
    expect(await listTokens(db.client, USER_ID)).toEqual([]);
    expect(await resolveToken(db.client, a.token, "ingest", NOW)).toEqual({ ok: false, reason: "unknown" });
    expect(await resolveToken(db.client, b.token, "search", NOW)).toEqual({ ok: false, reason: "unknown" });
    await expect(deleteToken(db.client, USER_ID, a.row.id)).rejects.toThrow(/nicht gefunden/);
  });

  it("cannot delete somebody else's token", async () => {
    const db = new FakeSupabase();
    const { row } = await createToken(db.client, OTHER_USER, "fremd", NOW);
    await expect(deleteToken(db.client, USER_ID, row.id)).rejects.toThrow();
    expect(db.rows("api_tokens")).toHaveLength(1);
  });

  it("cannot revoke somebody else's token", async () => {
    const db = new FakeSupabase();
    const { row } = await createToken(db.client, OTHER_USER, "fremd", NOW);
    await expect(revokeToken(db.client, USER_ID, row.id, NOW)).rejects.toThrow();
    expect(db.rows("api_tokens")[0]!.revoked_at ?? null).toBeNull();
  });

  it("supports an expiry in days", async () => {
    const db = new FakeSupabase();
    const { row } = await createToken(db.client, USER_ID, "kurz", NOW, { expiresInDays: 30 });
    expect(row.expires_at).toBe(new Date(NOW.getTime() + 30 * 86_400_000).toISOString());
  });
});

// The extension's own client (apps/extension/src/lib/api.ts) against this route with a token that was
// created through the Settings code path: create → ping → clip + highlight → status → revoke.
interface ExtensionApi {
  clientInfo(version: string): unknown;
  createApiClient(deps: {
    getSettings: () => Promise<unknown>;
    fetchImpl?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
  }): {
    ingest(req: unknown): Promise<{ ok: boolean; [key: string]: unknown }>;
    ping(): Promise<{ ok: boolean; [key: string]: unknown }>;
    status(id: string): Promise<{ ok: boolean; [key: string]: unknown }>;
  };
}
const EXTENSION_API = fileURLToPath(new URL("../../../../extension/src/lib/api.ts", import.meta.url));

describe("extension client with a personal token (end to end, in-memory)", () => {
  it("create → test connection → clip + highlight → processed → revoke", async () => {
    const { h, db, drain } = make();
    const { token } = await createToken(db.client, USER_ID, "Chrome Laptop", NOW);
    const ext = (await import(/* @vite-ignore */ EXTENSION_API)) as ExtensionApi;
    let stated: string | null = null;
    const route = (input: URL | RequestInfo, init?: RequestInit) => {
      const req = new Request(input as URL, init);
      stated = req.headers.get("accept-language");
      return req.method === "GET" ? h.GET(req) : h.POST(req);
    };
    const client = ext.createApiClient({
      getSettings: async () => ({ mockMode: null, baseUrl: "https://kortex.test", token }),
      fetchImpl: route,
    });
    const base = { client: ext.clientInfo("0.1.0"), captured_at: NOW.toISOString() };

    expect(await client.ping()).toEqual({ ok: true, data: { user_id: USER_ID, token_name: "Chrome Laptop" } });

    const clip = await client.ingest({
      ...base,
      kind: "web_clip",
      url: "https://example.com/a",
      title: "Artikel",
      tags: [],
      idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(clip).toMatchObject({ ok: true, kind: "web_clip", auto_routed: true, status: "inbox" });
    const hl = await client.ingest({
      ...base,
      kind: "highlight",
      url: "https://example.com/a",
      page_title: "Artikel",
      quote_text: "Text.",
      locator: {
        v: 1,
        quote: { exact: "Text.", prefix: "", suffix: "" },
        position: { start: 0, end: 5 },
        range: { startXPath: "/p", startOffset: 0, endXPath: "/p", endOffset: 5 },
      },
    });
    expect(hl).toMatchObject({ ok: true, kind: "highlight", duplicate: true });

    await drain();
    const status = await client.status(String(clip.item_id));
    expect(status).toMatchObject({ ok: true, data: { status: "processed" } });
    // every row written for this capture belongs to the token's owner
    expect(db.rows("knowledge_items").every((r) => r.user_id === USER_ID)).toBe(true);
    expect(db.rows("item_highlights")).toHaveLength(1);

    // revoking in Settings cuts the extension off at once, with the server's reason
    await revokeToken(db.client, USER_ID, String(db.rows("api_tokens")[0]!.id), NOW);
    // The extension client states its language and the server answers in it. Which one it states
    // depends on whether the client shares this suite's @kortex/i18n instance (German) or loads
    // its own (English), so the expectation follows the header it sent.
    const denied = await client.ping();
    expect(["en", "de"]).toContain(stated);
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "unauthorized", message: stated === "de" ? "API-Token wurde widerrufen" : "API token was revoked" },
    });
    expect(await client.ingest({ ...base, kind: "web_clip", url: "https://example.com/b", title: "B", tags: [] })).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    expect(db.rows("knowledge_items").some((r) => String(r.source_url ?? "").includes("example.com/b"))).toBe(false);
  });
});
