/*
 * Client side of the read routes (app/api/read/*): GET, same-origin cookies, no caching. Returns
 * the loader's own `{ ok, data } | { ok: false, error }`, so callers keep their result handling.
 * Pass an AbortSignal and abort it on unmount: an aborted read rejects with an AbortError, which
 * callers ignore (`isAbort`). Network failures resolve to `{ ok: false }`.
 */

import { t } from "@/i18n";

export type ReadName = "home" | "briefing" | "life" | "life-scores" | "status" | "settings" | "checkin" | "favorites";

type Result = { ok: true; data: unknown } | { ok: false; error: string };

export async function readApi<R extends Result>(
  name: ReadName,
  params?: Record<string, string | null | undefined>,
  signal?: AbortSignal,
): Promise<R> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v != null) q.set(k, v);
  const qs = q.size ? `?${q}` : "";
  let res: Response;
  try {
    res = await fetch(`/api/read/${name}${qs}`, {
      method: "GET",
      signal,
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    return { ok: false, error: t("No connection") } as R;
  }
  const body = (await res.json().catch(() => null)) as Result | null;
  // Aborted while the body was read: still an abort, not an error.
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (body && typeof body === "object" && typeof body.ok === "boolean") return body as R;
  return { ok: false, error: res.status === 401 ? t("Not signed in") : t("Loading failed ({status})", { status: res.status }) } as R;
}

export const isAbort = (err: unknown): boolean =>
  (err instanceof DOMException && err.name === "AbortError") || (err instanceof Error && err.name === "AbortError");
