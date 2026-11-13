import { NextResponse } from "next/server";
import { t } from "@/i18n";
import { enterRequestLocale, localeOfRequest } from "@/i18n/server";
import { getSession } from "@/lib/supabase/server";
import { cleanQuery, searchUnsplash, unsplashKey } from "@/server/covers/unsplash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" } as const;

/**
 * GET /api/covers/unsplash?q=<suche>&page=1 (W4): Unsplash search for the cover dialog, signed-in users only.
 * Without UNSPLASH_ACCESS_KEY: `{ enabled: false, results: [] }` (the dialog then offers the upload only).
 * Without q: just `{ enabled }`.
 */
export async function GET(req: Request) {
  enterRequestLocale(localeOfRequest(req.headers));
  const session = await getSession();
  if (!session) return NextResponse.json({ error: t("Not signed in") }, { status: 401, headers: HEADERS });
  const key = unsplashKey();
  const params = new URL(req.url).searchParams;
  const q = cleanQuery(params.get("q"));
  if (!key || !q) return NextResponse.json({ enabled: !!key, results: [], total: 0 }, { headers: HEADERS });
  try {
    const page = Number(params.get("page")) || 1;
    return NextResponse.json(await searchUnsplash(key, q, page), { headers: HEADERS });
  } catch (err) {
    console.error("[kortex] unsplash search failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ enabled: true, results: [], total: 0, error: t("Unsplash cannot be reached right now") }, { status: 502, headers: HEADERS });
  }
}
