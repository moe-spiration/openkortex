import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryBrainRepository } from "../src/memory-repository";
import { isAuthorized, safeEqual, startHttpServer, type RunningHttpServer } from "../src/http";
import { mintUserJwt } from "../src/config";
import { createHmac } from "node:crypto";
import { callTool } from "./helpers";

const TOKEN = "test-token-0123456789abcdef";
let repo: InMemoryBrainRepository;
let http: RunningHttpServer;

beforeEach(async () => {
  repo = new InMemoryBrainRepository();
  http = await startHttpServer({ repo, bearerToken: TOKEN, port: 0 });
});
afterEach(() => http.close());

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
});
const post = (headers: Record<string, string> = {}, body = initBody) =>
  fetch(http.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });

async function httpClient(token?: string) {
  const client = new Client({ name: "http-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(http.url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  await client.connect(transport);
  return client;
}

describe("HTTP transport", () => {
  it("binds to 127.0.0.1 by default", () => {
    expect(http.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it("rejects requests without a token or with a wrong one (401)", async () => {
    const bad: Record<string, string>[] = [
      {},
      { Authorization: "Bearer wrong-token-0123456789" },
      { Authorization: TOKEN },
      { Authorization: "Basic abc" },
      { Authorization: "Bearer " },
    ];
    for (const headers of bad) {
      const res = await post(headers);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
      expect(await res.text()).not.toContain("kortex-brain");
    }
  });

  it("does not let an unauthenticated client connect or call tools", async () => {
    await expect(httpClient()).rejects.toThrow();
    await expect(httpClient("wrong-token-0123456789")).rejects.toThrow();
    expect(repo.items.size).toBe(0);
  });

  it("serves the MCP protocol with the right token: list and call tools", async () => {
    const client = await httpClient(TOKEN);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);
      const saved = await callTool(client, "brain_save_item", {
        title: "Via HTTP",
        content_md: "hello",
      });
      expect(saved.isError).toBe(false);
      expect(repo.items.size).toBe(1);
      const found = await callTool(client, "brain_search", { query: "http" });
      expect(found.json.count).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("accepts the Bearer scheme case-insensitively", async () => {
    expect((await post({ Authorization: `bearer ${TOKEN}` })).status).toBe(200);
  });

  it("only allows POST, 404s other paths, and exposes an unauthenticated health check", async () => {
    expect((await fetch(http.url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(
      405,
    );
    expect(
      (await fetch(http.url, { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } }))
        .status,
    ).toBe(405);
    const base = http.url.replace("/mcp", "");
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    // GET /mcp without a token is still a 401, not a 405 that leaks routing details
    expect((await fetch(http.url)).status).toBe(401);
  });

  it("answers malformed bodies with 400 and oversized ones with 413", async () => {
    expect((await post({ Authorization: `Bearer ${TOKEN}` }, "{not json")).status).toBe(400);
    const big = JSON.stringify({ x: "a".repeat(5 * 1024 * 1024) });
    const res = await post({ Authorization: `Bearer ${TOKEN}` }, big).catch(() => null);
    // The server may reset the connection once the limit is hit; either outcome means it was refused.
    if (res) expect(res.status).toBe(413);
  });

  it("refuses to start with a short token", async () => {
    await expect(startHttpServer({ repo, bearerToken: "short", port: 0 })).rejects.toThrow(
      /at least 16/,
    );
  });
});

describe("bearer helpers", () => {
  it("safeEqual compares in constant time over equal-length digests", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("isAuthorized needs a Bearer header with the exact token", () => {
    expect(isAuthorized(undefined, "t")).toBe(false);
    expect(isAuthorized("Bearer t", "t")).toBe(true);
    expect(isAuthorized("Bearer t ", "t")).toBe(true);
    expect(isAuthorized("Bearer T", "t")).toBe(false);
    expect(isAuthorized("Bearer ", "")).toBe(false);
  });
});

describe("mintUserJwt", () => {
  it("produces a verifiable HS256 token for the user", () => {
    const { token, expiresAtMs } = mintUserJwt(
      "secret",
      "11111111-1111-4111-8111-111111111111",
      600,
      1_700_000_000_000,
    );
    const [h, b, s] = token.split(".") as [string, string, string];
    expect(createHmac("sha256", "secret").update(`${h}.${b}`).digest("base64url")).toBe(s);
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({
      sub: "11111111-1111-4111-8111-111111111111",
      role: "authenticated",
      aud: "authenticated",
      iat: 1_700_000_000,
      exp: 1_700_000_600,
    });
    expect(expiresAtMs).toBe(1_700_000_600_000);
  });
});
