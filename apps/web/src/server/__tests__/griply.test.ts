import { beforeEach, describe, expect, it } from "vitest";
import {
  CALLBACK_PATH,
  clearGriplyCache,
  disconnectGriply,
  finishGriplyConnect,
  griplyOverview,
  griplyStatus,
  handOverToGriply,
  startGriplyConnect,
  type ConnectionRow,
  type ConnectionStore,
  type GriplyIo,
  type McpPort,
} from "../griply/service";

/* The Griply connection without network: an in-memory table and a fake MCP server (synthetic data). */

const USER = "user-1";
const SERVER = "https://mcp.example.com/mcp";

function memoryStore(): ConnectionStore & { rows: Map<string, ConnectionRow> } {
  const rows = new Map<string, ConnectionRow>();
  return {
    rows,
    read: async (id) => (rows.has(id) ? structuredClone(rows.get(id)!) : null),
    save: async (id, row) => void rows.set(id, structuredClone(row)),
    remove: async (id) => void rows.delete(id),
  };
}

function fakeMcp(opts: { tools?: string[]; fail?: () => Error | null } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const mcp: McpPort = {
    async auth(provider, options) {
      if (!options.authorizationCode) {
        if (!(await provider.clientInformation())) await provider.saveClientInformation?.({ client_id: "kortex-client" });
        await provider.saveCodeVerifier("verifier");
        await provider.redirectToAuthorization(new URL(`https://app.example.com/authorize?state=${await provider.state?.()}&redirect_uri=${encodeURIComponent(String(provider.redirectUrl))}`));
        return "REDIRECT";
      }
      if (options.authorizationCode !== "good-code" || (await provider.codeVerifier()) !== "verifier") throw new Error("invalid_grant");
      await provider.saveTokens({ access_token: "at", token_type: "Bearer", refresh_token: "rt" });
      return "AUTHORIZED";
    },
    tools: async () => opts.tools ?? ["get_hierarchy", "get_tasks", "create_tasks"],
    async call(_url, provider, name, args) {
      const err = opts.fail?.();
      if (err) throw err;
      if (!(await provider.tokens())) throw Object.assign(new Error("no token"), { name: "UnauthorizedError" });
      calls.push({ name, args });
      if (name === "get_hierarchy") {
        return args.cursor
          ? { structuredContent: { goals: [{ id: "g2", name: "Second page goal", lifeAreas: [{ id: "a1" }] }] } }
          : { structuredContent: { lifeAreas: [{ id: "a1", name: "Health" }], goals: [{ id: "g1", name: "Run", lifeAreas: [{ id: "a1" }] }], nextCursor: "next" } };
      }
      if (name === "create_tasks") return { content: [{ type: "text", text: JSON.stringify({ results: [{ created: true, id: "gt-1", type: "task" }] }) }] };
      return { isError: true, content: [{ type: "text", text: "unknown tool" }] };
    },
  };
  return { mcp, calls };
}

const setup = (opts?: Parameters<typeof fakeMcp>[0]) => {
  const store = memoryStore();
  const { mcp, calls } = fakeMcp(opts);
  let now = new Date("2026-11-12T10:00:00Z");
  const io: GriplyIo = { store, mcp, now: () => now };
  return { io, store, calls, tick: (ms: number) => (now = new Date(now.getTime() + ms)) };
};

async function connect(io: GriplyIo) {
  const started = await startGriplyConnect(io, USER, SERVER, "https://kortex.example.com/");
  const state = new URL(started.url!).searchParams.get("state")!;
  return finishGriplyConnect(io, USER, "good-code", state);
}

describe("Griply connection", () => {
  beforeEach(() => clearGriplyCache());

  it("starts the sign-in: saves a pending row and returns Griply's page", async () => {
    const { io, store } = setup();
    expect(await griplyStatus(io, USER)).toMatchObject({ state: "off" });
    const r = await startGriplyConnect(io, USER, SERVER, "https://kortex.example.com/");
    const url = new URL(r.url!);
    expect(url.origin).toBe("https://app.example.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`https://kortex.example.com${CALLBACK_PATH}`);
    const row = store.rows.get(USER)!;
    expect(row).toMatchObject({ status: "pending", server_url: SERVER, access: null });
    expect(row.secrets.state).toBe(url.searchParams.get("state"));
    expect(row.secrets.state!.length).toBeGreaterThan(20);
    expect(r.status.state).toBe("pending");
  });

  it("refuses an address that is not a public https server", async () => {
    const { io, store } = setup();
    await expect(startGriplyConnect(io, USER, "http://localhost:3000/mcp", "https://kortex.example.com")).rejects.toThrow(/Serveradresse/);
    expect(store.rows.size).toBe(0);
  });

  it("finishes the sign-in only with the saved state, then knows the access level", async () => {
    const { io, store } = setup();
    const started = await startGriplyConnect(io, USER, SERVER, "https://kortex.example.com");
    await expect(finishGriplyConnect(io, USER, "good-code", "wrong-state")).rejects.toThrow();
    await expect(finishGriplyConnect(io, "someone-else", "good-code", new URL(started.url!).searchParams.get("state")!)).rejects.toThrow();
    expect(store.rows.get(USER)!.status).toBe("pending");
    const status = await finishGriplyConnect(io, USER, "good-code", new URL(started.url!).searchParams.get("state")!);
    expect(status).toMatchObject({ state: "connected", access: "write", serverUrl: SERVER, connectedAt: "2026-11-12T10:00:00.000Z" });
    const row = store.rows.get(USER)!;
    expect(row.secrets.tokens?.access_token).toBe("at");
    expect(row.secrets.state).toBeUndefined();
    expect(row.secrets.verifier).toBeUndefined();
    // The code cannot be used a second time.
    await expect(finishGriplyConnect(io, USER, "good-code", "")).rejects.toThrow();
  });

  it("read only when Griply offers no tool that changes things", async () => {
    const { io } = setup({ tools: ["get_hierarchy", "get_tasks"] });
    expect((await connect(io)).access).toBe("read");
    await expect(handOverToGriply(io, USER, { id: "t1", title: "Task" })).rejects.toThrow(/nur lesen/);
  });

  it("keeps the client registration when the same server is connected again", async () => {
    const { io, store } = setup();
    await connect(io);
    store.rows.get(USER)!.secrets.client = { client_id: "kept" };
    await startGriplyConnect(io, USER, SERVER, "https://kortex.example.com");
    expect(store.rows.get(USER)!.secrets.client).toEqual({ client_id: "kept" });
    expect(store.rows.get(USER)!.secrets.tokens).toBeUndefined();
    await startGriplyConnect(io, USER, "https://other.example.com/mcp", "https://kortex.example.com");
    expect(store.rows.get(USER)!.secrets.client).toEqual({ client_id: "kortex-client" });
  });

  it("reads the overview over all pages and caches it for five minutes", async () => {
    const { io, calls, tick } = setup();
    await connect(io);
    const o = await griplyOverview(io, USER);
    expect(o.areas).toEqual([{ id: "a1", name: "Health", goals: [{ id: "g1", name: "Run" }, { id: "g2", name: "Second page goal" }], projects: [], habits: [] }]);
    expect(calls.map((c) => c.args)).toEqual([{}, { cursor: "next" }]);
    await griplyOverview(io, USER);
    expect(calls.length).toBe(2);
    tick(6 * 60_000);
    await griplyOverview(io, USER);
    expect(calls.length).toBe(4);
  });

  it("hands a task over and returns Griply's id", async () => {
    const { io, calls } = setup();
    await connect(io);
    expect(await handOverToGriply(io, USER, { id: "t1", title: "Send the offer", due: "2026-11-20" })).toBe("gt-1");
    expect(calls.at(-1)).toEqual({ name: "create_tasks", args: { tasks: [{ name: "Send the offer", clientRequestId: "t1", deadline: "2026-11-20" }] } });
  });

  it("needs a connection, and an expired sign-in sets it back to pending", async () => {
    const off = setup();
    await expect(griplyOverview(off.io, USER)).rejects.toThrow(/nicht verbunden/);

    let expired = false;
    const { io, store } = setup({ fail: () => (expired ? Object.assign(new Error("Unauthorized"), { name: "UnauthorizedError" }) : null) });
    await connect(io);
    expired = true;
    await expect(griplyOverview(io, USER)).rejects.toThrow(/abgelaufen/);
    expect(store.rows.get(USER)).toMatchObject({ status: "pending" });
    expect(store.rows.get(USER)!.secrets.tokens).toBeUndefined();
  });

  it("disconnect removes the row with its tokens", async () => {
    const { io, store } = setup();
    await connect(io);
    expect(await disconnectGriply(io, USER)).toMatchObject({ state: "off" });
    expect(store.rows.size).toBe(0);
  });
});
