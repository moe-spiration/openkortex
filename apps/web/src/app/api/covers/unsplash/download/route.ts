import { NextResponse } from "next/server";
import { t } from "@/i18n";
import { enterRequestLocale, localeOfRequest } from "@/i18n/server";
import { getSession } from "@/lib/supabase/server";
import { pingDownload, unsplashKey } from "@/server/covers/unsplash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/covers/unsplash/download { location } (W4): tells Unsplash a photo was chosen (API guideline). */
export async function POST(req: Request) {
  enterRequestLocale(localeOfRequest(req.headers));
  const session = await getSession();
  if (!session) return NextResponse.json({ error: t("Not signed in") }, { status: 401 });
  const key = unsplashKey();
  if (!key) return NextResponse.json({ ok: false, error: t("Unsplash is not set up") }, { status: 404 });
  let location = "";
  try {
    location = String(((await req.json()) as { location?: unknown }).location ?? "");
  } catch {
    /* empty body */
  }
  try {
    await pingDownload(key, location);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : t("Error") }, { status: 400 });
  }
}
