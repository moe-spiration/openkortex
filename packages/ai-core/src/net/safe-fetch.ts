import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { KortexAiError } from "../errors";
import { defaultFetch, type FetchLike } from "../http";

/*
 * "Public http(s) only" for every server-side fetch of a URL that a page, feed or user controls
 * (covers, article pages, feeds, media downloads). Blocks private, loopback, link-local, CGNAT,
 * metadata and other non-public addresses (IPv4 and IPv6, incl. IPv4-mapped/NAT64/6to4 forms),
 * follows redirects by hand and checks every hop, and caps time and body size.
 *
 * DNS rebinding: the default transport (node:http/https) validates the addresses inside the
 * socket's own DNS lookup, i.e. exactly the IP it connects to. With an injected fetch (tests,
 * callers with their own HTTP stack) only the URL, literal IPs and redirects are checked, plus a
 * pre-resolution when `lookup` is given.
 */

export class BlockedUrlError extends KortexAiError {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`blocked URL (${reason}): ${redact(url)}`);
  }
}

const redact = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}${x.pathname.slice(0, 80)}`;
  } catch {
    return "(invalid)";
  }
};

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const)
  BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2001::", 23], // IETF protocol assignments (Teredo etc.)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const)
  BLOCKED.addSubnet(net, prefix, "ipv6");

/** Hex IPv6 groups → 8 numbers (handles "::" and a trailing dotted IPv4). */
function ipv6Groups(ip: string): number[] | null {
  let s = ip
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0]!;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1]!.split(".").map(Number);
    s =
      s.slice(0, -v4[1]!.length) +
      `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return null;
  const n = groups.map((g) => parseInt(g, 16));
  return n.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? n : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

/** True for addresses a server-side fetch may connect to. */
export function isPublicAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "");
  const kind = isIP(addr);
  if (kind === 4) return !BLOCKED.check(addr, "ipv4");
  if (kind !== 6) return false;
  const g = ipv6Groups(addr);
  if (!g) return false;
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002::/16).
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return isPublicAddress(v4From(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPublicAddress(v4From(g[6]!, g[7]!));
  if (g[0] === 0x2002) return isPublicAddress(v4From(g[1]!, g[2]!));
  return !BLOCKED.check(addr, "ipv6");
}

const BLOCKED_HOSTS =
  /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$|^metadata(\.google\.internal)?$/i;

/** Throws BlockedUrlError unless `raw` is an http(s) URL without credentials whose host may be public. */
export function assertPublicUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new BlockedUrlError(String(raw), "invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new BlockedUrlError(u.href, `scheme ${u.protocol}`);
  if (u.username || u.password) throw new BlockedUrlError(u.href, "credentials in URL");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new BlockedUrlError(u.href, "no host");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError(u.href, "non-public address");
  } else if (BLOCKED_HOSTS.test(host) || !host.includes(".")) {
    throw new BlockedUrlError(u.href, "internal host name");
  }
  return u;
}

export type ResolveFn = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultResolve: ResolveFn = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Resolves `host` and fails if any address is not public (or nothing resolves). */
export async function assertPublicHost(
  host: string,
  resolve: ResolveFn = defaultResolve,
): Promise<void> {
  const h = host.replace(/^\[|\]$/g, "");
  if (isIP(h)) {
    if (!isPublicAddress(h)) throw new BlockedUrlError(`http://${host}/`, "non-public address");
    return;
  }
  const addrs = await resolve(h);
  if (!addrs.length) throw new BlockedUrlError(`http://${host}/`, "no address");
  const bad = addrs.find((a) => !isPublicAddress(a.address));
  if (bad) throw new BlockedUrlError(`http://${host}/`, `resolves to non-public ${bad.address}`);
}

// --- Transport that checks the address it actually connects to -----------------------------

export interface GuardedTransportOptions {
  resolve?: ResolveFn;
  /** Tests only: which addresses count as allowed (default isPublicAddress). */
  isAllowed?: (ip: string) => boolean;
}

function bodyOf(body: RequestInit["body"]): Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  throw new TypeError("guarded transport: only string or byte bodies");
}

/** fetch() over node:http/https whose DNS lookup rejects non-public addresses (no rebinding). */
export function createGuardedTransport(o: GuardedTransportOptions = {}): FetchLike {
  const resolve = o.resolve ?? defaultResolve;
  const allowed = o.isAllowed ?? isPublicAddress;
  type LookupCb = (
    err: Error | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void;
  const lookup = (hostname: string, opts: { all?: boolean }, cb: LookupCb) => {
    resolve(hostname)
      .then((addrs) => {
        const bad = addrs.find((a) => !allowed(a.address));
        if (!addrs.length || bad)
          return cb(
            new BlockedUrlError(
              `http://${hostname}/`,
              bad ? `resolves to non-public ${bad.address}` : "no address",
            ),
            "",
          );
        if (opts.all) return cb(null, addrs);
        cb(null, addrs[0]!.address, addrs[0]!.family);
      })
      .catch((err: Error) => cb(err, ""));
  };
  return (input, init = {}) =>
    new Promise<Response>((resolveRes, reject) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(host) && !allowed(host))
        return reject(new BlockedUrlError(url.href, "non-public address"));
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      headers["accept-encoding"] ??= "gzip, deflate, br";
      const body = bodyOf(init.body);
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(url, {
        method: init.method ?? "GET",
        headers,
        lookup: lookup as never,
        signal: init.signal ?? undefined,
      });
      req.on("response", (res) => {
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const decoder =
          enc === "gzip"
            ? createGunzip()
            : enc === "deflate"
              ? createInflate()
              : enc === "br"
                ? createBrotliDecompress()
                : null;
        const stream = decoder ? res.pipe(decoder) : res;
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined || (decoder && (k === "content-encoding" || k === "content-length")))
            continue;
          for (const one of Array.isArray(v) ? v : [v]) h.append(k, one);
        }
        const status = res.statusCode ?? 502;
        const empty = init.method === "HEAD" || status === 204 || status === 304;
        const r = new Response(
          empty ? null : (Readable.toWeb(stream as Readable) as ReadableStream),
          {
            status,
            statusText: res.statusMessage,
            headers: h,
          },
        );
        if (empty) res.resume();
        Object.defineProperty(r, "url", { value: url.href });
        resolveRes(r);
      });
      req.on("error", reject);
      req.end(body);
    });
}

// --- Public fetch with manual, re-checked redirects -----------------------------------------

export interface SafeFetchOptions {
  /** Injected HTTP (tests, own stack). Default: the guarded node transport. */
  fetch?: FetchLike;
  /** DNS pre-check for injected fetches (the default transport checks at connect time). */
  resolve?: ResolveFn;
  maxRedirects?: number;
  /** Per request, used when the caller passes no signal (default 30 s). */
  timeoutMs?: number;
  /**
   * Headers for a hop's URL, given the caller's original headers (e.g. a cookie only for one
   * site's hosts). Default: the original headers minus cookie/authorization on other hosts.
   */
  headersFor?: (url: URL, base: Headers) => Headers;
}

const SENSITIVE = ["cookie", "authorization", "proxy-authorization"];

/** fetch() that only reaches public http(s) hosts, on every redirect hop. Response.url = final URL. */
export function createSafeFetch(o: SafeFetchOptions = {}): FetchLike {
  const transport =
    o.fetch && o.fetch !== defaultFetch ? o.fetch : createGuardedTransport({ resolve: o.resolve });
  const preResolve = o.fetch && o.fetch !== defaultFetch ? o.resolve : undefined;
  const maxRedirects = o.maxRedirects ?? 5;
  return async (input, init = {}) => {
    let url = assertPublicUrl(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const origin = url.host;
    const base = new Headers(init.headers);
    let method = init.method ?? "GET";
    let body = init.body;
    const signal = init.signal ?? AbortSignal.timeout(o.timeoutMs ?? 30_000);
    for (let hop = 0; ; hop++) {
      if (preResolve) await assertPublicHost(url.hostname, preResolve);
      let headers = new Headers(base);
      if (o.headersFor) headers = o.headersFor(url, headers);
      else if (url.host !== origin) for (const k of SENSITIVE) headers.delete(k);
      const res = await transport(url.href, {
        ...init,
        method,
        body,
        headers,
        signal,
        redirect: "manual",
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) {
        if (!res.url) Object.defineProperty(res, "url", { value: url.href });
        return res;
      }
      await res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new BlockedUrlError(url.href, "too many redirects");
      url = assertPublicUrl(new URL(location, url));
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
    }
  };
}

/** Body as bytes, at most `maxBytes` (streamed: a missing or wrong Content-Length can't bypass it). null = too large. */
export async function readBodyLimited(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Text body, at most `maxBytes` (cut, not refused). */
export async function readTextLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - total;
    parts.push(value.byteLength > room ? value.subarray(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(parts));
}
