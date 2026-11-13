import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { t } from "@/i18n";
import { enterRequestLocale, localeOfRequest } from "@/i18n/server";
import { dataSource } from "@/lib/supabase/config";
import { getSession } from "@/lib/supabase/server";

/*
 * Read routes (GET /api/read/*): the read-only loads of Home, Life, the sidebar, the shell status,
 * settings and the daily check-in, which used to be server actions. Next.js runs a page's server
 * actions one at a time and navigating does not cancel them, so Life's first load waited behind Home's
 * (abnahmebericht P7-5). As GET requests they run in parallel and the client aborts them on unmount.
 *
 * Every route calls the same server function as before, with the same signed-in Supabase client
 * (cookie session, RLS plus explicit user_id filters), so the data and access rules are unchanged.
 * No session: 401. Responses are per user and never cached (`private, no-store`). Body: the loader's
 * own `{ ok, data } | { ok: false, error }`.
 */

export const READ_HEADERS = { "cache-control": "private, no-store" } as const;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function readError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: READ_HEADERS });
}

export async function readResponse<T>(load: () => Promise<Result<T>>): Promise<NextResponse> {
  // Answer in the caller's language (header, cookie or Accept-Language of this request).
  try {
    enterRequestLocale(localeOfRequest(await headers()));
  } catch {
    // Outside a request (unit tests): the process-wide language stays.
  }
  // Mock mode reads its data on the client; nothing to serve here.
  if (dataSource() === "mock") return readError(404, t("Mock mode: no live data"));
  const session = await getSession();
  if (!session) return readError(401, t("Not signed in"));
  try {
    const r = await load();
    return NextResponse.json(r, { status: r.ok ? 200 : 500, headers: READ_HEADERS });
  } catch (err) {
    console.error("[kortex] read route failed:", err instanceof Error ? err.message : err);
    return readError(500, t("Loading failed"));
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** IANA zone names: letters, digits, "/", "_", "+", "-"; at most 64 characters. */
const ZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;

/** `date` (YYYY-MM-DD, required) and `tz` (optional IANA zone) from the query, or a 400 response. */
export function dayParams(req: Request): { date: string; timeZone?: string } | NextResponse {
  const q = new URL(req.url).searchParams;
  const date = q.get("date") ?? "";
  const tz = q.get("tz");
  if (!DAY.test(date)) return readError(400, t("date (YYYY-MM-DD) is missing or invalid"));
  if (tz !== null && !ZONE.test(tz)) return readError(400, t("tz is invalid"));
  return tz ? { date, timeZone: tz } : { date };
}
