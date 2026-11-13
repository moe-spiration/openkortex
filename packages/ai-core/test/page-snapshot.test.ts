import { describe, expect, it } from "vitest";
import { fetchPageSnapshot, robotsDisallows, type FetchLike } from "../src";

const LONG = "Ein längerer Absatz über das Produkt und seine Preise. ".repeat(12);
const page = (body = `<article><h1>Preise</h1><p>${LONG}</p></article>`) =>
  `<html><head><title>Preise</title></head><body>${body}</body></html>`;

/** Serves robots.txt and the page; unknown hosts are public (IP-literal-free names pass the URL check). */
function site(opts: { robots?: string; status?: number; html?: string; type?: string }): FetchLike {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/robots.txt"))
      return opts.robots === undefined
        ? new Response("nope", { status: 404 })
        : new Response(opts.robots, { status: 200 });
    return new Response(opts.html ?? page(), {
      status: opts.status ?? 200,
      headers: { "content-type": opts.type ?? "text/html; charset=utf-8" },
    });
  };
}

describe("robotsDisallows", () => {
  it("applies the most specific rule for kortexbot or *", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/open\n";
    expect(robotsDisallows(robots, "/private/x")).toBe(true);
    expect(robotsDisallows(robots, "/private/open/1")).toBe(false);
    expect(robotsDisallows(robots, "/blog")).toBe(false);
    expect(robotsDisallows("User-agent: KortexBot\nDisallow: /\n", "/a")).toBe(true);
    expect(robotsDisallows("User-agent: otherbot\nDisallow: /\n", "/a")).toBe(false);
  });
});

describe("fetchPageSnapshot", () => {
  const url = "https://shop.example.com/preise";

  it("returns the page text as Markdown", async () => {
    const r = await fetchPageSnapshot(url, { fetch: site({}) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.markdown).toContain("Preise");
  });

  it.each([
    [403, /403/],
    [429, /429/],
    [404, /404/],
  ])("marks HTTP %i as not observable", async (status, re) => {
    const r = await fetchPageSnapshot(url, { fetch: site({ status }) });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(re);
  });

  it("respects robots.txt", async () => {
    const r = await fetchPageSnapshot(url, { fetch: site({ robots: "User-agent: *\nDisallow: /" }) });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("robots.txt") });
  });

  it("detects captcha pages and empty shells", async () => {
    const captcha = await fetchPageSnapshot(url, {
      fetch: site({ html: "<html><head><title>Just a moment...</title></head><body><p>x</p></body></html>" }),
    });
    expect(captcha.ok).toBe(false);
    const empty = await fetchPageSnapshot(url, { fetch: site({ html: page("<div id=app></div>") }) });
    expect(empty).toEqual({ ok: false, reason: expect.stringContaining("keinen Text") });
  });

  it("reports network errors and private hosts instead of throwing", async () => {
    const down: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    expect((await fetchPageSnapshot(url, { fetch: down })).ok).toBe(false);
    const priv = await fetchPageSnapshot("http://127.0.0.1/x", { fetch: site({}) });
    expect(priv.ok).toBe(false);
  });
});
