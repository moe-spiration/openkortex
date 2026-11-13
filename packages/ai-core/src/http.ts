import { ExtractionError } from "./errors";

/** Minimal fetch signature so tests (and edge runtimes) can inject their own. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 KortexBot/0.1";

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

/** fetch + timeout + status check. Throws ExtractionError on non-2xx. */
export async function request(
  fetchFn: FetchLike,
  adapterId: string,
  url: string,
  { timeoutMs = 30_000, ...init }: RequestOptions = {},
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal });
  } catch (cause) {
    throw new ExtractionError(adapterId, `request to ${new URL(url).host} failed`, { cause });
  }
  if (!res.ok) {
    // Keep the provider's reason (e.g. Eden AI: ["File unrecognized or corrupted"]): short,
    // single line. Response bodies never contain our keys; URLs are not echoed.
    const reason = await errorBody(res);
    throw new ExtractionError(
      adapterId,
      `${new URL(url).host} responded ${res.status}${reason ? `: ${reason}` : ""}`,
    );
  }
  return res;
}

/** First 300 characters of an error response, whitespace collapsed; "" when unreadable. */
export async function errorBody(res: Response): Promise<string> {
  try {
    const text = (await res.text()).replace(/\s+/g, " ").trim();
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return "";
  }
}

export async function requestJson<T>(
  fetchFn: FetchLike,
  adapterId: string,
  url: string,
  init?: RequestOptions,
): Promise<T> {
  const res = await request(fetchFn, adapterId, url, init);
  try {
    return (await res.json()) as T;
  } catch (cause) {
    throw new ExtractionError(adapterId, `invalid JSON from ${new URL(url).host}`, { cause });
  }
}

export async function requestText(
  fetchFn: FetchLike,
  adapterId: string,
  url: string,
  init?: RequestOptions,
): Promise<string> {
  const res = await request(fetchFn, adapterId, url, init);
  return res.text();
}
