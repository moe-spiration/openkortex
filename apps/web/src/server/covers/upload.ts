import { t } from "@/i18n";
/*
 * W4 (feedback round 3): own cover images. The browser posts the file to POST /api/covers/upload; it is stored in the
 * private bucket kortex-media under `<user_id>/covers/` (storage RLS checks the prefix) and served as a long-lived
 * signed URL (server/storage.ts), which becomes knowledge_items.cover_image_url.
 */

export const COVER_MAX_BYTES = 8 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const COVER_TYPES = Object.keys(EXT);

/** Checks type and size; returns the file extension or an error message. */
export function checkCoverFile(type: string, size: number): { ext: string } | { error: string } {
  const ext = EXT[type.toLowerCase()];
  if (!ext) return { error: t("Images only (JPG, PNG, WebP, GIF, AVIF)") };
  if (size <= 0) return { error: t("The file is empty") };
  if (size > COVER_MAX_BYTES) return { error: t("The image is larger than 8 MB") };
  return { ext };
}

export const coverPath = (userId: string, id: string, ext: string) => `${userId}/covers/${id}.${ext}`;
