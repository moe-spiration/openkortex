import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPublicHost,
  assertPublicUrl,
  BlockedUrlError,
  createGuardedTransport,
  createSafeFetch,
  isPublicAddress,
  readBodyLimited,
  readTextLimited,
} from "../src/net/safe-fetch";
import { fakeFetch } from "./helpers";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:c0a8:0101::1",
    "2001:db8::1",
    "[::1]",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each([
    "93.184.216.34",
    "1.1.1.1",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));

  it("rejects garbage", () => {
    expect(isPublicAddress("not-an-ip")).toBe(false);
    expect(isPublicAddress("1.2.3")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it.each([
    ["file:///etc/passwd", "scheme"],
    ["ftp://example.com/x", "scheme"],
    ["gopher://example.com/", "scheme"],
    ["http://user:pw@example.com/", "credentials"],
    ["http://localhost:3000/", "internal host"],
    ["http://app.localhost/", "internal host"],
    ["http://metadata.google.internal/computeMetadata/v1/", "internal host"],
    ["http://intranet/", "internal host"],
    ["http://169.254.169.254/latest/meta-data/", "non-public"],
    ["http://2130706433/", "non-public"], // decimal 127.0.0.1
    ["http://0177.0.0.1/", "non-public"], // octal
    ["http://0x7f.1/", "non-public"],
    ["http://[::1]:8080/", "non-public"],
    ["http://[::ffff:169.254.169.254]/", "non-public"],
  ])("blocks %s (%s)", (url, reason) => {
    expect(() => assertPublicUrl(url)).toThrow(BlockedUrlError);
    expect(() => assertPublicUrl(url)).toThrow(new RegExp(reason));
  });

  it("allows public http(s)", () => {
    expect(assertPublicUrl("https://www.heise.de/a?b=1").hostname).toBe("www.heise.de");
    expect(assertPublicUrl("http://93.184.216.34/").hostname).toBe("93.184.216.34");
  });

  it("DNS check: every resolved address must be public", async () => {
    await expect(
      assertPublicHost("ok.example", async () => [{ address: "93.184.216.34", family: 4 }]),
    ).resolves.toBeUndefined();
    await expect(
      assertPublicHost("evil.example", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]),
    ).rejects.toThrow(/resolves to non-public 10.0.0.5/);
    await expect(
      assertPublicHost("v6.example", async () => [{ address: "fd00::1", family: 6 }]),
    ).rejects.toThrow(BlockedUrlError);
    await expect(assertPublicHost("empty.example", async () => [])).rejects.toThrow(/no address/);
  });
});

describe("createSafeFetch (injected fetch)", () => {
  it("follows redirects by hand and blocks a hop to an internal address", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === "https://shop.example/p",
        respond: () => new Response(null, { status: 302, headers: { location: "/q" } }),
      },
      {
        match: (u) => u === "https://shop.example/q",
        respond: () =>
          new Response(null, {
            status: 301,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
      },
    ]);
    await expect(createSafeFetch({ fetch })("https://shop.example/p")).rejects.toThrow(
      /non-public/,
    );
    expect(fetch.calls.map((c) => c.url)).toEqual([
      "https://shop.example/p",
      "https://shop.example/q",
    ]);
  });

  it("returns the final response with its URL; drops cookies on other hosts", async () => {
    const fetch = fakeFetch([
      {
        match: (u) => u === "https://a.example/x",
        respond: () =>
          new Response(null, { status: 302, headers: { location: "https://cdn.example/y" } }),
      },
      { match: (u) => u === "https://cdn.example/y", respond: () => new Response("ok") },
    ]);
    const res = await createSafeFetch({ fetch })("https://a.example/x", {
      headers: { cookie: "s=1", "user-agent": "k" },
    });
    expect(await res.text()).toBe("ok");
    expect(res.url).toBe("https://cdn.example/y");
    expect(fetch.calls[0]!.headers).toMatchObject({ cookie: "s=1" });
    expect(fetch.calls[1]!.headers.cookie).toBeUndefined();
    expect(fetch.calls[1]!.headers["user-agent"]).toBe("k");
  });

  it("stops redirect loops and checks DNS per hop when a resolver is given", async () => {
    const loop = fakeFetch([
      {
        match: () => true,
        respond: () =>
          new Response(null, { status: 302, headers: { location: "https://loop.example/" } }),
      },
    ]);
    await expect(
      createSafeFetch({ fetch: loop, maxRedirects: 3 })("https://loop.example/"),
    ).rejects.toThrow(/too many redirects/);
    const fetch = fakeFetch([{ match: () => true, respond: () => new Response("x") }]);
    const resolve = async (h: string) => [
      { address: h === "rebind.example" ? "127.0.0.1" : "93.184.216.34", family: 4 },
    ];
    await expect(createSafeFetch({ fetch, resolve })("https://rebind.example/")).rejects.toThrow(
      /non-public 127.0.0.1/,
    );
    await expect(
      createSafeFetch({ fetch, resolve })("https://fine.example/"),
    ).resolves.toBeInstanceOf(Response);
  });
});

describe("body limits", () => {
  const stream = (chunks: number[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const n of chunks) c.enqueue(new Uint8Array(n));
          c.close();
        },
      }),
    );
  it("caps bytes while streaming, even without Content-Length", async () => {
    expect(await readBodyLimited(stream([400, 400]), 1000)).toHaveLength(800);
    expect(await readBodyLimited(stream([600, 600]), 1000)).toBeNull();
    expect(
      await readBodyLimited(new Response("x", { headers: { "content-length": "5000" } }), 1000),
    ).toBeNull();
    expect(await readTextLimited(new Response("a".repeat(5000)), 100)).toHaveLength(100);
  });
});

describe("guarded transport (real sockets)", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/hello" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/plain", "set-cookie": ["a=1", "b=2"] });
      res.end(`hello ${req.headers["x-test"] ?? ""}`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("checks the address the socket connects to: a public-looking name resolving to loopback is refused", async () => {
    const transport = createGuardedTransport({
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await expect(transport(`http://rebind.example:${port}/`)).rejects.toThrow(
      /non-public 127.0.0.1/,
    );
    await expect(transport(`http://127.0.0.1:${port}/`)).rejects.toThrow(BlockedUrlError);
  });

  it("works as fetch when the address is allowed (status, headers, body, manual redirects)", async () => {
    const transport = createGuardedTransport({
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      isAllowed: (ip) => ip === "127.0.0.1",
    });
    const res = await transport(`http://test.example:${port}/hello`, {
      headers: { "x-test": "ok" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(await res.text()).toBe("hello ok");
    const redirect = await transport(`http://test.example:${port}/redirect`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/hello");
  });
});
