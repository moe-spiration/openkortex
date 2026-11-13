import type { StorageGateway } from "@kortex/ai-core";
import type { KortexClient } from "@kortex/db";

/** Validity of signed cover URLs (10 years). */
export const COVER_URL_TTL_SEC = 10 * 365 * 24 * 3600;

/**
 * StorageGateway backed by Supabase Storage. Uses the caller's client, so with a user
 * session the storage RLS (`{user_id}/...` prefix) applies.
 */
export function createSupabaseStorageGateway(client: KortexClient): StorageGateway {
  return {
    async upload({ bucket, path, data, contentType }) {
      const { error } = await client.storage
        .from(bucket)
        .upload(path, data, { contentType, upsert: true });
      if (error) throw new Error(`storage upload to ${bucket}/${path} failed: ${error.message}`);
      // Covers are shown as plain image URLs (cover_image_url): a long-lived signed URL keeps the
      // private bucket and works in every client. Other files stay path-only.
      if (bucket === "kortex-media" && path.includes("/covers/")) {
        const signed = await client.storage.from(bucket).createSignedUrl(path, COVER_URL_TTL_SEC);
        if (!signed.error && signed.data?.signedUrl) return { path, url: signed.data.signedUrl };
      }
      return { path };
    },
  };
}
