"use server";

import { requestLocale } from "@/app/request-locale";
import { enterRequestLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { readerFormatOf, splitStoragePath } from "@/components/reader/liveDoc";
import type { ReaderFormat } from "@/components/reader/mockDoc";
import { ensureBootstrapped, getSession } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

/*
 * Server action of the split reader: a short-lived signed URL for an item's stored original
 * (Supabase Storage). Runs as the signed-in user (RLS on knowledge_items and storage.objects) and
 * also filters by user_id. Never throws to the client and never logs the URL.
 */

const SIGNED_URL_SECONDS = 3600;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface ReaderFileUrl {
  url: string;
  format: ReaderFormat;
  /** ISO time the URL stops working. */
  expiresAt: string;
}

export async function getReaderFileUrl(itemId: string): Promise<ActionResult<ReaderFileUrl>> {
  enterRequestLocale(await requestLocale());
  try {
    if (!isUuid(itemId)) return { ok: false, error: t("Invalid ID") };
    const session = await getSession();
    if (!session) return { ok: false, error: t("Not signed in") };
    await ensureBootstrapped(session);
    const { client, user } = session;
    const { data, error } = await client
      .from("knowledge_items")
      .select("file_storage_path,file_mime_type,type,title")
      .eq("user_id", user.id)
      .eq("id", itemId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: t("Entry not found") };
    const path = data.file_storage_path ?? "";
    const format = path ? readerFormatOf(data.file_mime_type, path) : null;
    const loc = splitStoragePath(path);
    if (!format || !loc) return { ok: false, error: t("No PDF/EPUB stored") };
    // Originals live under <user_id>/ (storage RLS enforces it too).
    if (!loc.key.startsWith(`${user.id}/`)) return { ok: false, error: t("File does not belong to this account") };
    const signed = await client.storage.from(loc.bucket).createSignedUrl(loc.key, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? t("Signed URL missing"));
    return {
      ok: true,
      data: { url: signed.data.signedUrl, format, expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kortex] getReaderFileUrl failed:", message);
    return { ok: false, error: message };
  }
}
