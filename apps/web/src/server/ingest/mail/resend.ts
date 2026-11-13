import type { FetchLike } from "@kortex/ai-core";

/*
 * Resend Receiving API (docs checked 2026-11-01): the `email.received` webhook only carries
 * metadata; body, headers and the raw .eml come from GET /emails/receiving/{id}, attachments from
 * GET /emails/receiving/{id}/attachments (each with a signed `download_url`, valid 1 h).
 */

export const RESEND_API = "https://api.resend.com";

export interface ResendReceivedEmail {
  id: string;
  from: string;
  to?: string[];
  cc?: string[];
  subject?: string | null;
  created_at?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string>;
  message_id?: string | null;
  raw?: { download_url?: string; expires_at?: string } | null;
  attachments?: Array<{ id: string; filename?: string | null; content_type?: string; size?: number }>;
}

export interface ResendAttachment {
  id: string;
  filename?: string | null;
  size?: number;
  content_type?: string;
  content_disposition?: string | null;
  content_id?: string | null;
  download_url?: string;
  expires_at?: string;
}

export class ResendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface ResendClient {
  getReceivedEmail(id: string): Promise<ResendReceivedEmail>;
  listAttachments(emailId: string): Promise<ResendAttachment[]>;
  /** Signed download URL (raw .eml or attachment), capped at `maxBytes`; null when larger. */
  download(url: string, maxBytes: number): Promise<Uint8Array | null>;
}

const ID = /^[\w-]{1,100}$/;

export function createResendClient(apiKey: string, fetchImpl: FetchLike = fetch): ResendClient {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetchImpl(`${RESEND_API}${path}`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });
    if (!res.ok) throw new ResendError(`Resend ${path.split("/").slice(0, 3).join("/")}: HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  };
  return {
    getReceivedEmail(id) {
      if (!ID.test(id)) throw new ResendError("invalid email id");
      return get<ResendReceivedEmail>(`/emails/receiving/${id}?html_format=cid`);
    },
    async listAttachments(emailId) {
      if (!ID.test(emailId)) throw new ResendError("invalid email id");
      const out: ResendAttachment[] = [];
      let after: string | undefined;
      for (let page = 0; page < 5; page++) {
        const r = await get<{ data?: ResendAttachment[]; has_more?: boolean }>(
          `/emails/receiving/${emailId}/attachments?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        );
        out.push(...(r.data ?? []));
        after = out.at(-1)?.id;
        if (!r.has_more || !after) break;
      }
      return out;
    },
    async download(url, maxBytes) {
      if (!/^https:\/\//i.test(url)) throw new ResendError("download URL must be https");
      const res = await fetchImpl(url);
      if (!res.ok) throw new ResendError(`download: HTTP ${res.status}`, res.status);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) return null;
      if (!res.body) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return buf.byteLength > maxBytes ? null : buf;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
      }
      return out;
    },
  };
}
