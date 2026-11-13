import { describe, expect, it, vi } from "vitest";
import { INSTANCE_KEY, bakedInstance, connectInstance, forgetInstance, normalizeServerUrl, readStoredInstance, type InstanceStorage } from "../src/api/instance";

function memory(initial: Record<string, string> = {}): InstanceStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("instance (which Kortex the app talks to)", () => {
  it("a build without all three values has no baked instance", () => {
    expect(bakedInstance({})).toBeNull();
    expect(bakedInstance({ kortexUrl: "https://kortex.example.com", supabaseUrl: "https://db.example.com" })).toBeNull();
    expect(bakedInstance({ kortexUrl: "https://kortex.example.com/", supabaseUrl: "https://db.example.com/", anonKey: " anon " })).toEqual({
      kortexUrl: "https://kortex.example.com",
      supabaseUrl: "https://db.example.com",
      anonKey: "anon",
    });
  });

  it("accepts https and local http only, and reduces the input to the origin", () => {
    expect(normalizeServerUrl("kortex.example.com")).toBe("https://kortex.example.com");
    expect(normalizeServerUrl(" https://kortex.example.com/home/ ")).toBe("https://kortex.example.com");
    expect(normalizeServerUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeServerUrl("http://10.0.2.2:3000")).toBe("http://10.0.2.2:3000");
    expect(normalizeServerUrl("http://kortex.example.com")).toBeNull();
    expect(normalizeServerUrl("ftp://kortex.example.com")).toBeNull();
    expect(normalizeServerUrl("")).toBeNull();
  });

  it("connect reads /api/instance, stores the instance and survives a restart", async () => {
    const storage = memory();
    const fetchImpl = answer({ app: "kortex", version: "1.0.0", supabase: { url: "https://db.example.com/", anonKey: "anon" } });
    const r = await connectInstance("kortex.example.com", storage, fetchImpl);
    expect(r).toEqual({ ok: true, instance: { kortexUrl: "https://kortex.example.com", supabaseUrl: "https://db.example.com", anonKey: "anon" } });
    expect(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toBe("https://kortex.example.com/api/instance");
    expect(await readStoredInstance(storage)).toEqual(r.ok ? r.instance : null);
    await forgetInstance(storage);
    expect(await readStoredInstance(storage)).toBeNull();
  });

  it("refuses servers that are not a Kortex, have no database or do not answer, and stores nothing", async () => {
    const storage = memory();
    expect((await connectInstance("example.com", storage, answer({ hello: "world" }))).ok).toBe(false);
    expect((await connectInstance("example.com", storage, answer({ app: "kortex", supabase: null }))).ok).toBe(false);
    expect((await connectInstance("example.com", storage, answer({}, 404))).ok).toBe(false);
    const down = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect((await connectInstance("example.com", storage, down)).ok).toBe(false);
    expect((await connectInstance("http://example.com", storage, answer({ app: "kortex" }))).ok).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("ignores a damaged stored value", async () => {
    expect(await readStoredInstance(memory({ [INSTANCE_KEY]: "{broken" }))).toBeNull();
    expect(await readStoredInstance(memory({ [INSTANCE_KEY]: JSON.stringify({ kortexUrl: "https://x.example.com" }) }))).toBeNull();
  });
});
