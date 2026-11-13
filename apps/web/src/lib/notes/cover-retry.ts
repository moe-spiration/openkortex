/*
 * Retry plan for cover images (W4). A cover is a remote URL (signed storage link or Unsplash) that the browser
 * requests the instant it is picked or uploaded. Two things go wrong now and then: the request fails (storage proxy
 * hiccup, object not yet readable) or it hangs without ever firing load or error. Both leave an empty <img>.
 * CoverImg retries on error and after a stall timeout; each retry gets a cache-busting query parameter, so the
 * browser opens a fresh request instead of reusing the failed or stalled one.
 */

/** Wait (ms) before retry n+1 after attempt n failed. */
export const COVER_RETRY_MS = [300, 1000, 2000, 4000] as const;

/** An attempt that neither loads nor fails within this time (ms) counts as failed. */
export const COVER_STALL_MS = 5000;

/** Query parameter that makes a retry a fresh request. Storage and Unsplash ignore unknown parameters. */
export const COVER_RETRY_PARAM = "kx_retry";

/** The URL for attempt n: attempt 0 is the stored URL unchanged, later http(s) attempts carry the retry parameter. */
export function coverAttemptSrc(src: string, attempt: number): string {
  if (attempt <= 0 || !/^https?:\/\//i.test(src)) return src;
  try {
    const u = new URL(src);
    u.searchParams.set(COVER_RETRY_PARAM, String(attempt));
    return u.toString();
  } catch {
    return src;
  }
}

/** Delay before the next attempt after attempt n failed, or null when the retries are used up. */
export function coverRetryDelay(attempt: number): number | null {
  return COVER_RETRY_MS[attempt] ?? null;
}
