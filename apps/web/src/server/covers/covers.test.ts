import { describe, expect, it, vi } from "vitest";
import { checkCoverFile, coverPath, COVER_MAX_BYTES } from "./upload";
import { cleanQuery, isDownloadLocation, mapSearch, pingDownload, searchUnsplash, searchUrl, unsplashKey } from "./unsplash";

describe("W4 unsplash proxy", () => {
  it("reads the key only when it is set and not a placeholder", () => {
    expect(unsplashKey({})).toBeNull();
    expect(unsplashKey({ UNSPLASH_ACCESS_KEY: "" })).toBeNull();
    expect(unsplashKey({ UNSPLASH_ACCESS_KEY: "<DEIN_UNSPLASH_ACCESS_KEY>" })).toBeNull();
    expect(unsplashKey({ UNSPLASH_ACCESS_KEY: '"abc"' })).toBe("abc");
  });

  it("cleans the query and builds a landscape search", () => {
    expect(cleanQuery("  berge   im  nebel ")).toBe("berge im nebel");
    expect(cleanQuery(null)).toBe("");
    expect(cleanQuery("x".repeat(300))).toHaveLength(100);
    const u = new URL(searchUrl("berge", 99));
    expect(u.origin + u.pathname).toBe("https://api.unsplash.com/search/photos");
    expect(u.searchParams.get("query")).toBe("berge");
    expect(u.searchParams.get("orientation")).toBe("landscape");
    expect(u.searchParams.get("page")).toBe("50");
  });

  it("maps results with credit and download location, drops broken ones", () => {
    const out = mapSearch({
      total: 2,
      results: [
        {
          id: "a1",
          alt_description: "Berge",
          color: "#334455",
          urls: { raw: "https://images.unsplash.com/photo-1?ixid=x", small: "https://images.unsplash.com/photo-1?w=400" },
          user: { name: "Ana", links: { html: "https://unsplash.com/@ana" } },
          links: { download_location: "https://api.unsplash.com/photos/a1/download?ixid=x" },
        },
        { id: "b2", urls: {} },
      ],
    });
    expect(out.total).toBe(2);
    expect(out.results).toHaveLength(1);
    const p = out.results[0]!;
    expect(p.url).toBe("https://images.unsplash.com/photo-1?ixid=x&w=1600&q=80&fm=jpg&fit=crop");
    expect(p.thumb).toContain("w=400");
    expect(p.author).toEqual({ name: "Ana", link: "https://unsplash.com/@ana?utm_source=kortex&utm_medium=referral" });
    expect(p.download).toContain("/photos/a1/download");
    expect(mapSearch(null)).toEqual({ results: [], total: 0 });
  });

  it("only pings Unsplash download endpoints", async () => {
    expect(isDownloadLocation("https://api.unsplash.com/photos/a1/download?ixid=x")).toBe(true);
    expect(isDownloadLocation("https://evil.example/photos/a1/download")).toBe(false);
    expect(isDownloadLocation("http://api.unsplash.com/photos/a1/download")).toBe(false);
    expect(isDownloadLocation("nonsense")).toBe(false);
    const fetcher = vi.fn(async () => new Response("{}"));
    await expect(pingDownload("k", "https://evil.example/x", fetcher as unknown as typeof fetch)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the key as Client-ID and reports errors", async () => {
    const ok = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Client-ID k");
      return new Response(JSON.stringify({ total: 0, results: [] }));
    });
    await expect(searchUnsplash("k", "berge", 1, ok as unknown as typeof fetch)).resolves.toEqual({ enabled: true, results: [], total: 0 });
    const bad = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(searchUnsplash("k", "berge", 1, bad as unknown as typeof fetch)).rejects.toThrow("403");
  });
});

describe("W4 cover upload", () => {
  it("accepts images up to 8 MB", () => {
    expect(checkCoverFile("image/jpeg", 1000)).toEqual({ ext: "jpg" });
    expect(checkCoverFile("IMAGE/PNG", 1000)).toEqual({ ext: "png" });
    expect(checkCoverFile("application/pdf", 1000)).toHaveProperty("error");
    expect(checkCoverFile("image/webp", 0)).toHaveProperty("error");
    expect(checkCoverFile("image/webp", COVER_MAX_BYTES + 1)).toHaveProperty("error");
  });
  it("stores under the user's covers prefix (storage RLS)", () => {
    expect(coverPath("u1", "id1", "png")).toBe("u1/covers/id1.png");
  });
});
