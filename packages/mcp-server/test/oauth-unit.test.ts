import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { isAllowedRedirectUri, loadOAuthConfig, redirectMatches } from "../src/oauth/config";
import { signJwt, verifyJwt } from "../src/oauth/jwt";
import { createLogger, createRateLimiter, createUsedSet, redact } from "../src/oauth/ops";
import { cleanClientName } from "../src/oauth/provider";

const USER = "11111111-1111-4111-8111-111111111111";
const env = {
  MCP_PUBLIC_URL: "https://mcp.example.com",
  MCP_OAUTH_SECRET: "s".repeat(48),
  KORTEX_USER_ID: USER,
  SUPABASE_URL: "https://supabase.example.com/",
  SUPABASE_ANON_KEY: "anon",
};

describe("loadOAuthConfig", () => {
  it("is off without MCP_PUBLIC_URL and derives resource, issuer and defaults otherwise", () => {
    expect(loadOAuthConfig({})).toBeNull();
    const cfg = loadOAuthConfig(env)!;
    expect(cfg).toMatchObject({
      publicUrl: "https://mcp.example.com",
      resource: "https://mcp.example.com/mcp",
      issuer: "https://mcp.example.com",
      allowedUserIds: [USER],
      supabaseUrl: "https://supabase.example.com",
      accessTtlSeconds: 3600,
      trustProxy: false,
    });
    expect(cfg.corsOrigins).toContain("https://claude.ai");
    expect(cfg.supabaseJwtSecret).toBeUndefined();
  });

  it("rejects insecure or incomplete setups with a precise message", () => {
    const bad = (over: Record<string, string | undefined>, msg: RegExp) =>
      expect(() => loadOAuthConfig({ ...env, ...over })).toThrow(msg);
    bad({ MCP_PUBLIC_URL: "http://mcp.example.com" }, /https/);
    bad({ MCP_PUBLIC_URL: "https://mcp.example.com/kortex" }, /without a path/);
    bad({ MCP_PUBLIC_URL: "https://mcp.example.com/?x=1" }, /query/);
    bad({ MCP_PUBLIC_URL: "nonsense" }, /absolute URL/);
    bad({ MCP_OAUTH_SECRET: "short" }, /at least 32/);
    bad({ MCP_OAUTH_SECRET: undefined }, /at least 32/);
    bad({ KORTEX_USER_ID: undefined }, /who may sign in/);
    bad({ MCP_OAUTH_ALLOWED_USER_IDS: "not-a-uuid" }, /not a UUID/);
    bad({ SUPABASE_ANON_KEY: undefined }, /SUPABASE_ANON_KEY/);
    bad({ MCP_OAUTH_REDIRECT_URIS: "http://evil.example/cb" }, /https/);
    bad({ MCP_OAUTH_ACCESS_TTL_SECONDS: "5" }, />= 60/);
  });

  it("allows http for localhost, several users, extra redirect URIs and the Supabase-token switch", () => {
    const cfg = loadOAuthConfig({
      ...env,
      MCP_PUBLIC_URL: "http://localhost:3333",
      MCP_OAUTH_ALLOWED_USER_IDS: `${USER}, 22222222-2222-4222-8222-222222222222`,
      MCP_OAUTH_REDIRECT_URIS: "https://app.example.com/cb",
      MCP_ACCEPT_SUPABASE_TOKENS: "1",
      SUPABASE_JWT_SECRET: "jwt-secret",
      MCP_TRUST_PROXY: "true",
    })!;
    expect(cfg.allowedUserIds).toHaveLength(2);
    expect(cfg.extraRedirectUris).toEqual(["https://app.example.com/cb"]);
    expect(cfg.supabaseJwtSecret).toBe("jwt-secret");
    expect(cfg.trustProxy).toBe(true);
  });
});

describe("redirect URI policy", () => {
  const cfg = { extraRedirectUris: ["https://app.example.com/cb"] };
  it("accepts the Claude callbacks, loopback addresses and configured extras", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "http://localhost:3118/callback",
      "http://127.0.0.1/callback",
      "http://[::1]:8000/cb",
      "https://app.example.com/cb",
    ]) {
      expect(isAllowedRedirectUri(cfg, ok), ok).toBe(true);
    }
  });
  it("refuses everything else", () => {
    for (const bad of [
      "https://evil.example/cb",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/other",
      "http://claude.ai/api/mcp/auth_callback",
      "http://example.com/cb",
      "javascript:alert(1)",
      "https://claude.ai/api/mcp/auth_callback#frag",
      "claude://cb",
      "not a url",
    ]) {
      expect(isAllowedRedirectUri(cfg, bad), bad).toBe(false);
    }
  });
  it("compares loopback URIs without the port and everything else exactly", () => {
    expect(redirectMatches(["http://127.0.0.1:1111/cb"], "http://127.0.0.1:9999/cb")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1/cb"], "http://127.0.0.1:9999/other")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1/cb"], "http://localhost:9999/cb")).toBe(false);
    expect(redirectMatches(["https://claude.ai/api/mcp/auth_callback"], "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectMatches(["https://claude.ai/api/mcp/auth_callback"], "https://claude.ai:444/api/mcp/auth_callback")).toBe(false);
  });
});

describe("jwt", () => {
  const secret = "k".repeat(40);
  const exp = Math.floor(Date.now() / 1000) + 60;

  it("round-trips and checks type, signature and expiry", () => {
    const t = signJwt(secret, { sub: "u", exp }, { typ: "at+jwt" });
    expect(verifyJwt(secret, t, { typ: "at+jwt" })).toMatchObject({ ok: true, claims: { sub: "u" } });
    expect(verifyJwt(secret, t, { typ: "code" })).toEqual({ ok: false, reason: "type" });
    expect(verifyJwt("x".repeat(40), t)).toEqual({ ok: false, reason: "signature" });
    expect(verifyJwt(secret, signJwt(secret, { exp: exp - 3600 }))).toEqual({ ok: false, reason: "expired" });
    expect(verifyJwt(secret, signJwt(secret, { sub: "u" }))).toEqual({ ok: false, reason: "expired" }); // exp is mandatory
    expect(verifyJwt(secret, signJwt(secret, { exp, nbf: exp + 3600 }))).toEqual({ ok: false, reason: "not_yet_valid" });
  });

  it("rejects tampering, malformed input and alg none", () => {
    const t = signJwt(secret, { sub: "u", exp });
    const [h, , s] = t.split(".") as [string, string, string];
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "admin", exp })).toString("base64url")}.${s}`;
    expect(verifyJwt(secret, forged)).toEqual({ ok: false, reason: "signature" });
    for (const junk of ["", "a.b", "a.b.c", "....", "x.y.z.w"]) expect(verifyJwt(secret, junk).ok).toBe(false);
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.`;
    expect(verifyJwt(secret, none).ok).toBe(false);
    // an RS256-declared header must not be accepted just because the HMAC matches
    const head = Buffer.from('{"alg":"RS256"}').toString("base64url");
    const body = Buffer.from(JSON.stringify({ exp })).toString("base64url");
    const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
    expect(verifyJwt(secret, `${head}.${body}.${sig}`)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("ops", () => {
  it("rate limiter counts per key and window and reports retry-after", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect([rl.take("a"), rl.take("a"), rl.take("a")]).toEqual([true, true, false]);
    expect(rl.take("b")).toBe(true);
    expect(rl.retryAfter("a")).toBe(1);
    t = 1001;
    expect(rl.take("a")).toBe(true);
    expect(rl.retryAfter("a")).toBe(0);
  });

  it("rate limiter stays bounded", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 });
    for (let i = 0; i < 100; i++) rl.take(`k${i}`);
    expect(rl.take("k0")).toBe(true); // evicted, starts fresh
  });

  it("used-set allows each id once until it expires", () => {
    let t = 0;
    const used = createUsedSet(() => t);
    expect(used.markUsed("x", 100)).toBe(true);
    expect(used.markUsed("x", 100)).toBe(false);
    expect(used.has("x")).toBe(true);
    t = 101;
    expect(used.has("x")).toBe(false);
    expect(used.markUsed("x", 300)).toBe(true);
  });

  it("logs one JSON object per line and never a credential", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), () => new Date("2026-10-24T08:00:00Z"));
    log.info("request", { path: "/mcp", status: 200, client_id: "abc", access_token: "SECRET", password: "pw", refresh_token: "r", authorization: "Bearer x", code: "c", code_verifier: "v" });
    const rec = JSON.parse(lines[0]!);
    expect(rec).toMatchObject({ ts: "2026-10-24T08:00:00.000Z", level: "info", msg: "request", path: "/mcp", status: 200, client_id: "abc" });
    expect(lines[0]).not.toMatch(/SECRET|"pw"|Bearer x/);
    expect(redact({ token_type: "Bearer", secret: "s" })).toEqual({ token_type: "Bearer", secret: "[redacted]" });
  });

  it("sanitises client names", () => {
    expect(cleanClientName("<script>alert(1)</script>Claude\u0000")).toBe("scriptalert(1)/scriptClaude");
    expect(cleanClientName("x".repeat(500))).toHaveLength(100);
    expect(cleanClientName(undefined)).toBe("Unbekannte Anwendung");
  });
});
