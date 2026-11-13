// Data source switch and public Supabase config. Server-side only reads `KORTEX_DATA_SOURCE`;
// the browser learns the mode from the snapshot the workspace layout hands down.

export type DataSource = "mock" | "supabase";

const clean = (v: string | undefined): string | undefined => {
  const s = v?.trim();
  return s && !/^<.*>$/.test(s) ? s : undefined;
};

export function supabasePublicConfig(): { url: string; anonKey: string } | null {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return url && anonKey ? { url, anonKey } : null;
}

/**
 * `KORTEX_DATA_SOURCE=mock|supabase`. Default: `supabase` when the public Supabase keys are set,
 * else `mock`. `supabase` without keys falls back to `mock` (nothing to connect to).
 */
export function dataSource(): DataSource {
  // Resolved once by next.config.ts (same rule), so server, middleware and browser agree.
  const resolved = process.env.NEXT_PUBLIC_KORTEX_DATA_SOURCE;
  if (resolved === "mock") return "mock";
  if (resolved === "supabase") return supabasePublicConfig() ? "supabase" : "mock";
  const wanted = clean(process.env.KORTEX_DATA_SOURCE)?.toLowerCase();
  if (wanted === "mock") return "mock";
  return supabasePublicConfig() ? "supabase" : "mock";
}

/** IANA time zone for day boundaries (daily note, "today", item dates). */
export const timeZone = (): string => clean(process.env.KORTEX_TIMEZONE) ?? "Europe/Berlin";

/** Rewrites a request for the public Supabase address to the internal one; other requests pass unchanged. */
export function rewriteToInternal(url: string, publicUrl: string, internalUrl: string): string {
  const pub = publicUrl.replace(/\/+$/, "");
  return url === pub || url.startsWith(`${pub}/`)
    ? internalUrl.replace(/\/+$/, "") + url.slice(pub.length)
    : url;
}

/**
 * `SUPABASE_INTERNAL_URL` (server only, optional): where the web server itself reaches the Supabase
 * API when the public address does not lead there from inside its container (self-hosting on
 * `http://localhost:8000`, or a domain that resolves to the host). Clients are still created with
 * the public address, so cookie names, token issuer and signed URLs stay the public ones; only the
 * transport goes over the internal address. Returns the `fetch` to hand to a server-side client.
 */
export function supabaseServerFetch(
  env: Record<string, string | undefined> = process.env,
): typeof fetch | undefined {
  const internal = clean(env.SUPABASE_INTERNAL_URL);
  const pub = clean(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!internal || !pub) return undefined;
  return (input, init) => {
    if (typeof input === "string" || input instanceof URL)
      return fetch(rewriteToInternal(String(input), pub, internal), init);
    const target = rewriteToInternal(input.url, pub, internal);
    return target === input.url ? fetch(input, init) : fetch(new Request(target, input), init);
  };
}

/** Client options for every server-side Supabase client (spread into the options object). */
export function supabaseServerGlobal(): { global?: { fetch: typeof fetch } } {
  const f = supabaseServerFetch();
  return f ? { global: { fetch: f } } : {};
}
