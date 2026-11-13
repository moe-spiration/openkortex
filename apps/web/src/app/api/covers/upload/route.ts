import { NextResponse } from "next/server";
import { t } from "@/i18n";
import { enterRequestLocale, localeOfRequest } from "@/i18n/server";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import { checkCoverFile, coverPath } from "@/server/covers/upload";
import { createSupabaseStorageGateway } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/covers/upload (multipart, field `file`) → `{ url }` (W4): stores an own cover image. */
export async function POST(req: Request) {
  enterRequestLocale(localeOfRequest(req.headers));
  const session = await getSession();
  if (!session) return NextResponse.json({ error: t("Not signed in") }, { status: 401 });
  try {
    await ensureBootstrapped(session);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ error: t("No file") }, { status: 400 });
    const check = checkCoverFile(file.type, file.size);
    if ("error" in check) return NextResponse.json({ error: check.error }, { status: 400 });
    const path = coverPath(session.user.id, crypto.randomUUID(), check.ext);
    const stored = await createSupabaseStorageGateway(session.client).upload({
      bucket: "kortex-media",
      path,
      data: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
    });
    if (!stored.url) return NextResponse.json({ error: t("No link for the image") }, { status: 500 });
    return NextResponse.json({ url: stored.url, path });
  } catch (err) {
    console.error("[kortex] cover upload failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: t("Upload failed") }, { status: 500 });
  }
}
