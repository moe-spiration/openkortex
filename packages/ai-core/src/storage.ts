import { STORAGE_BUCKETS, storagePath, type StorageBucket } from "@kortex/db";

export { STORAGE_BUCKETS };
export type { StorageBucket };

export interface StorageUpload {
  bucket: StorageBucket;
  /** Always `{user_id}/{item_id}.{ext}` (storage RLS requires the user id prefix). */
  path: string;
  data: Uint8Array;
  contentType: string;
}

export interface StorageUploadResult {
  path: string;
  /** Signed or public URL, if the gateway can produce one. */
  url?: string;
}

/**
 * Storage port. Adapters never talk to Supabase directly; `apps/web` passes a
 * gateway backed by `supabase.storage.from(bucket).upload(path, data)`.
 */
export interface StorageGateway {
  upload(file: StorageUpload): Promise<StorageUploadResult>;
}

export const itemStoragePath = (userId: string, itemId: string, ext: string): string =>
  storagePath(userId, `${itemId}.${ext.replace(/^\./, "").toLowerCase()}`);

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export const imageExtension = (mimeType: string | undefined): string =>
  (mimeType && IMAGE_EXT[mimeType.toLowerCase()]) || "bin";

/** In-memory gateway for tests and local dry runs. */
export function createMemoryStorageGateway(): StorageGateway & {
  readonly files: Map<string, StorageUpload>;
} {
  const files = new Map<string, StorageUpload>();
  return {
    files,
    async upload(file) {
      files.set(`${file.bucket}/${file.path}`, file);
      return { path: file.path };
    },
  };
}
