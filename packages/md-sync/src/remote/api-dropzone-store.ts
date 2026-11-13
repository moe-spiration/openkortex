import { DropzonePostponeError, type DropzoneStore, type DropzoneSubmitResult, type DropzoneUpload } from "./dropzone-store";

/*
 * Dropzone in token mode (desktop sidecar): the file goes through `POST /api/ingest` (multipart)
 * with the user's `kx_` token, exactly like a drag & drop in the web app. The server stages the
 * bytes, dedups (a known file comes back as `duplicate`), enforces the allowlist and the AI budget
 * and queues OCR / transcript / organizer. The daemon itself writes nothing to ingest_jobs.
 *
 * A file the server cannot take right now (offline, daily budget or rate limit, server busy, token
 * not valid any more) stays in the dropzone and is tried again later; only a real refusal of the
 * file (type, size, ...) sends it to `.failed`.
 */
const LATER = new Set([401, 403, 408, 425, 429, 500, 502, 503, 504]);

export class ApiDropzoneStore implements DropzoneStore {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async submit(file: DropzoneUpload): Promise<DropzoneSubmitResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.name);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.apiUrl.replace(/\/+$/, "")}/api/ingest`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}` },
        body: form,
      });
    } catch (error) {
      throw new DropzonePostponeError(`offline: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; item_id?: string; duplicate?: boolean; error?: { message?: string } | string }
      | null;
    if (!res.ok || !body?.item_id) {
      const msg =
        (typeof body?.error === "string" ? body.error : body?.error?.message) ?? `HTTP ${res.status}`;
      if (LATER.has(res.status)) throw new DropzonePostponeError(`HTTP ${res.status}: ${msg}`);
      throw new Error(`dropzone ingest: ${msg}`);
    }
    return { status: body.duplicate ? "duplicate" : "created", itemId: body.item_id };
  }
}
