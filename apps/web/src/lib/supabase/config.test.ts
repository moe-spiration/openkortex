import { afterEach, describe, expect, it, vi } from "vitest";
import { rewriteToInternal, supabaseServerFetch } from "./config";

describe("internal Supabase address of the web server", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rewrites only requests for the public address", () => {
    const r = (url: string) =>
      rewriteToInternal(url, "http://localhost:8000/", "http://gateway:8001");
    expect(r("http://localhost:8000/auth/v1/user")).toBe("http://gateway:8001/auth/v1/user");
    expect(r("http://localhost:8000")).toBe("http://gateway:8001");
    expect(r("http://localhost:80001/auth/v1/user")).toBe("http://localhost:80001/auth/v1/user");
    expect(r("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("is off without SUPABASE_INTERNAL_URL", () => {
    expect(
      supabaseServerFetch({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8000" }),
    ).toBeUndefined();
    expect(supabaseServerFetch({ SUPABASE_INTERNAL_URL: "http://gateway:8001" })).toBeUndefined();
  });

  it("sends string, URL and Request input to the internal address and keeps method and headers", async () => {
    const calls: Array<{ url: string; method?: string; auth?: string | null }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      calls.push({ url: req.url, method: req.method, auth: req.headers.get("authorization") });
      return new Response("{}");
    });
    const f = supabaseServerFetch({
      NEXT_PUBLIC_SUPABASE_URL: "https://kortex.example.com",
      SUPABASE_INTERNAL_URL: "http://gateway:8001/",
    })!;
    await f("https://kortex.example.com/rest/v1/items?select=id", {
      headers: { authorization: "Bearer a" },
    });
    await f(new URL("https://kortex.example.com/auth/v1/user"));
    await f(
      new Request("https://kortex.example.com/storage/v1/object/x", {
        method: "POST",
        body: "b",
        headers: { authorization: "Bearer c" },
      }),
    );
    await f("https://openrouter.ai/api/v1/models");
    expect(calls).toEqual([
      { url: "http://gateway:8001/rest/v1/items?select=id", method: "GET", auth: "Bearer a" },
      { url: "http://gateway:8001/auth/v1/user", method: "GET", auth: null },
      { url: "http://gateway:8001/storage/v1/object/x", method: "POST", auth: "Bearer c" },
      { url: "https://openrouter.ai/api/v1/models", method: "GET", auth: null },
    ]);
  });
});
