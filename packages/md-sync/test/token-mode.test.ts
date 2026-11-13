import { describe, expect, it, vi } from "vitest";
import { ConfigError, readConfig } from "../src/config";
import { ApiDropzoneStore } from "../src/remote/api-dropzone-store";
import { TokenAuthError, TokenSession } from "../src/remote/token-session";
import { statusLine } from "../src/status-line";

const TOKEN = `kx_${"a".repeat(43)}`;
const USER = "11111111-1111-4111-8111-111111111111";

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readConfig: token mode (desktop sidecar)", () => {
  const base = { KORTEX_VAULT_PATH: "C:/Vault", KORTEX_SYNC_TOKEN: TOKEN, KORTEX_API_URL: "https://kortex.example.com/" };

  it("needs no service-role key and no user id", () => {
    const cfg = readConfig({ ...base });
    expect(cfg.auth).toEqual({ mode: "token", apiUrl: "https://kortex.example.com", token: TOKEN });
  });

  it("keeps AI ingest off even when a provider key is present", () => {
    const cfg = readConfig({ ...base, OPENROUTER_API_KEY: "o" });
    expect(cfg.ingest.enabled).toBe(false);
    expect(cfg.ingest.disabledReason).toMatch(/token mode/);
  });

  it("ignores a service-role key next to the token", () => {
    const cfg = readConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: "secret", KORTEX_USER_ID: USER });
    expect(cfg.auth.mode).toBe("token");
    expect(JSON.stringify(cfg)).not.toContain("secret");
  });

  it("rejects a malformed token and a plain-http remote API", () => {
    expect(() => readConfig({ ...base, KORTEX_SYNC_TOKEN: "kx_short" })).toThrow(ConfigError);
    expect(() => readConfig({ ...base, KORTEX_API_URL: "http://kortex.example.com" })).toThrow(/https/);
    expect(readConfig({ ...base, KORTEX_API_URL: "http://localhost:3000" }).auth).toMatchObject({ apiUrl: "http://localhost:3000" });
    expect(() => readConfig({ KORTEX_VAULT_PATH: "C:/Vault", KORTEX_SYNC_TOKEN: TOKEN })).toThrow(/KORTEX_API_URL/);
  });

  it("service mode still works as before", () => {
    const cfg = readConfig({
      KORTEX_VAULT_PATH: "C:/Vault",
      KORTEX_USER_ID: USER.toUpperCase(),
      SUPABASE_URL: "https://supabase.example.com",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    });
    expect(cfg.auth).toEqual({ mode: "service", userId: USER, supabaseUrl: "https://supabase.example.com", serviceRoleKey: "service" });
    expect(() => readConfig({ KORTEX_VAULT_PATH: "C:/Vault" })).toThrow(/KORTEX_SYNC_TOKEN/);
  });
});

describe("TokenSession", () => {
  const session = (expiresAt: number) => ({
    ok: true,
    access_token: `jwt-${expiresAt}`,
    expires_at: expiresAt,
    user_id: USER,
    supabase_url: "https://supabase.example.com",
    anon_key: "anon",
  });

  it("trades the kx_ token at /api/sync/session and caches until shortly before expiry", async () => {
    let now = 1_000_000;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
      return jsonRes(200, session(now + 3_600_000));
    });
    const s = new TokenSession({ apiUrl: "https://k.example.com/", token: TOKEN, fetch: fetchFn as unknown as typeof fetch, now: () => now });
    expect(await s.accessToken()).toBe(`jwt-${1_000_000 + 3_600_000}`);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://k.example.com/api/sync/session");
    now += 30 * 60_000;
    await s.accessToken();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 27 * 60_000; // 3 min left < 5 min margin
    await s.accessToken();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, session(Date.now() + 3_600_000)));
    const s = new TokenSession({ apiUrl: "https://k.example.com", token: TOKEN, fetch: fetchFn as unknown as typeof fetch });
    await Promise.all([s.accessToken(), s.accessToken(), s.accessToken()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a rejected token is a TokenAuthError, even while an old JWT is still valid", async () => {
    let now = 0;
    let status = 200;
    const fetchFn = vi.fn(async () => (status === 200 ? jsonRes(200, session(now + 3_600_000)) : jsonRes(status, { ok: false, error: { message: "API-Token wurde widerrufen" } })));
    const s = new TokenSession({ apiUrl: "https://k.example.com", token: TOKEN, fetch: fetchFn as unknown as typeof fetch, now: () => now });
    await s.accessToken();
    status = 401;
    now += 57 * 60_000;
    await expect(s.accessToken()).rejects.toBeInstanceOf(TokenAuthError);
  });

  it("a network blip keeps the still-valid JWT", async () => {
    let now = 0;
    let fail = false;
    const fetchFn = vi.fn(async () => {
      if (fail) throw new Error("ECONNRESET");
      return jsonRes(200, session(now + 3_600_000));
    });
    const s = new TokenSession({ apiUrl: "https://k.example.com", token: TOKEN, fetch: fetchFn as unknown as typeof fetch, now: () => now });
    const first = await s.accessToken();
    fail = true;
    now += 57 * 60_000;
    expect(await s.accessToken()).toBe(first);
    now += 10 * 60_000; // expired now
    await expect(s.accessToken()).rejects.toThrow(/ECONNRESET/);
  });
});

describe("ApiDropzoneStore", () => {
  const file = { name: "scan.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]), hash: "file:x" };

  it("uploads through POST /api/ingest as multipart with the token", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const f = form.get("file") as File;
      expect(f.name).toBe("scan.pdf");
      expect(f.size).toBe(3);
      return jsonRes(200, { ok: true, item_id: "item-1", duplicate: false });
    });
    const store = new ApiDropzoneStore("https://k.example.com/", TOKEN, fetchFn as unknown as typeof fetch);
    expect(await store.submit(file)).toEqual({ status: "created", itemId: "item-1" });
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://k.example.com/api/ingest");
  });

  it("maps a server-side duplicate and errors", async () => {
    const dup = new ApiDropzoneStore("https://k", TOKEN, (async () => jsonRes(200, { ok: true, item_id: "old", duplicate: true })) as unknown as typeof fetch);
    expect(await dup.submit(file)).toEqual({ status: "duplicate", itemId: "old" });
    const bad = new ApiDropzoneStore("https://k", TOKEN, (async () => jsonRes(413, { ok: false, error: { message: "Datei ist größer als 50 MB" } })) as unknown as typeof fetch);
    await expect(bad.submit(file)).rejects.toThrow(/50 MB/);
    await expect(bad.submit(file)).rejects.not.toBeInstanceOf((await import("../src/remote/dropzone-store")).DropzonePostponeError);
    // Not now, but later: offline, budget / rate limit, server busy, token not valid.
    const { DropzonePostponeError } = await import("../src/remote/dropzone-store");
    for (const status of [401, 429, 503]) {
      const later = new ApiDropzoneStore("https://k", TOKEN, (async () => jsonRes(status, { ok: false, error: { message: "x" } })) as unknown as typeof fetch);
      await expect(later.submit(file)).rejects.toBeInstanceOf(DropzonePostponeError);
    }
    const offline = new ApiDropzoneStore("https://k", TOKEN, (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(offline.submit(file)).rejects.toBeInstanceOf(DropzonePostponeError);
  });
});

describe("statusLine", () => {
  it("is one prefixed JSON line", () => {
    const line = statusLine("status", { state: "running", last_error: "a\nb" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1).includes("\n")).toBe(false);
    expect(JSON.parse(line.replace(/^@@kortex-status /, ""))).toEqual({ state: "running", last_error: "a\nb" });
  });
});

describe("acquireVaultLock", () => {
  it("allows one daemon per vault and takes over dead or stale locks", async () => {
    const { mkdtempSync, rmSync, existsSync, utimesSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { acquireVaultLock, VaultLockedError, STALE_MS } = await import("../src/vault-lock");
    const vault = mkdtempSync(path.join(os.tmpdir(), "kx-lock-"));
    try {
      const a = acquireVaultLock(vault, "pc", { pid: 100, isAlive: () => true });
      expect(() => acquireVaultLock(vault, "pc", { pid: 200, isAlive: () => true })).toThrow(VaultLockedError);
      // Same pid again (restart of the same process) is fine.
      acquireVaultLock(vault, "pc", { pid: 100, isAlive: () => true }).release();
      expect(existsSync(a.file)).toBe(false);
      // Dead owner on this host: taken over.
      acquireVaultLock(vault, "pc", { pid: 300, isAlive: () => true });
      const b = acquireVaultLock(vault, "pc", { pid: 400, isAlive: (p) => p !== 300 });
      // Other host: locked while fresh, taken over once stale.
      expect(() => acquireVaultLock(vault, "laptop", { pid: 1 })).toThrow(/pc/);
      const old = new Date(Date.now() - STALE_MS - 1000);
      utimesSync(b.file, old, old);
      acquireVaultLock(vault, "laptop", { pid: 1 }).release();
      a.release();
      // Killed daemon whose PID Windows gave to another process: a lock not refreshed for
      // STALE_MS is taken over on this host too (it used to end in exit 5).
      const c = acquireVaultLock(vault, "pc", { pid: 500, isAlive: () => true });
      utimesSync(c.file, old, old);
      acquireVaultLock(vault, "pc", { pid: 600, isAlive: () => true }).release();
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
