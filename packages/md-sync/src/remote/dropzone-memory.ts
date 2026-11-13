import { randomUUID } from "node:crypto";
import { dedupKeys, findDuplicateIn, type DedupItem } from "@kortex/db";
import {
  itemTypeForUpload,
  titleForUpload,
  type DropzoneStore,
  type DropzoneSubmitResult,
  type DropzoneUpload,
} from "./dropzone-store";

export interface MemoryDropzoneItem {
  id: string;
  type: string;
  title: string;
  content_hash: string;
  file_name: string;
  size: number;
}

/** In-memory `DropzoneStore` for tests; dedups through the same matcher as the DB side. */
export class InMemoryDropzoneStore implements DropzoneStore {
  readonly items: MemoryDropzoneItem[] = [];
  /** Test hook: reject the next N submits. */
  failNext = 0;
  calls = 0;

  async submit(file: DropzoneUpload): Promise<DropzoneSubmitResult> {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("remote unavailable");
    }
    const type = itemTypeForUpload(file.name, file.mimeType);
    const title = titleForUpload(file.name);
    const cand = { type, title, hash: file.hash };
    const hit = findDuplicateIn(
      this.items.map((i) => ({ ...i, source_url: null, source_url_norm: null, metadata: {} }) as unknown as DedupItem),
      cand,
      await dedupKeys(cand),
    );
    if (hit) return { status: "duplicate", itemId: hit.item.id };
    const id = randomUUID();
    this.items.push({
      id,
      type,
      title,
      content_hash: file.hash,
      file_name: file.name,
      size: file.bytes.byteLength,
    });
    return { status: "created", itemId: id };
  }
}
