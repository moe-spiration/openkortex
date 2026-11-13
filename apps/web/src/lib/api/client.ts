// Typed browser client for the Kortex API routes (same-origin; the Supabase session cookie
// authenticates). Server modules are imported as types only, so nothing server-side ships.
import type { ApiFailure } from "@/server/api-error";
import type { ChatActionRequest, ChatActionResponse } from "@/server/chat/action";
import type { ChatRequest, Citation, CitationsData } from "@/server/chat/contract";
import type { AgentRequest, AgentResponse } from "@/server/chat/agent";
import type { DigestRequest, DigestResponse } from "@/server/digest/service";
import type { IngestRequest, IngestStatusResponse, IngestSuccess } from "@/server/ingest/contract";
import type { SearchResponse, SearchResult } from "@/server/search/handler";

export type {
  ApiFailure,
  ChatActionResponse,
  Citation,
  CitationsData,
  DigestResponse,
  IngestStatusResponse,
  IngestSuccess,
  SearchResponse,
  SearchResult,
};

/** Body for `useChat` (`@ai-sdk/react`) via `new DefaultChatTransport({ api: "/api/chat", body })`. */
export type ChatRequestBody = Omit<Partial<ChatRequest>, "messages">;

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly failure: ApiFailure["error"],
  ) {
    super(failure.message);
    this.name = "ApiClientError";
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await res.json().catch(() => null)) as T | ApiFailure | null;
  if (!res.ok || !body || (body as ApiFailure).ok === false) {
    const failure = (body as ApiFailure | null)?.error ?? {
      code: "server_error" as const,
      message: `HTTP ${res.status}`,
    };
    throw new ApiClientError(res.status, failure);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** POST /api/ingest (JSON kinds: web_clip, highlight, ai_chat, note). Returns before AI processing. */
export const ingest = (req: IngestRequest) => post<IngestSuccess>("/api/ingest", req);

/** POST /api/ingest as multipart (PDF, EPUB, images up to 50 MB). */
export function uploadFile(
  file: File,
  options: { folderPath?: string; tags?: string[]; title?: string; note?: string } = {},
) {
  const form = new FormData();
  form.append("file", file);
  if (options.folderPath) form.append("folder_path", options.folderPath);
  if (options.tags?.length) form.append("tags", options.tags.join(","));
  if (options.title) form.append("title", options.title);
  if (options.note) form.append("note", options.note);
  return call<IngestSuccess>("/api/ingest", { method: "POST", body: form });
}

/** GET /api/ingest?item_id= — poll until status is `processed` or `error`. */
export const ingestStatus = (itemId: string) =>
  call<IngestStatusResponse>(`/api/ingest?item_id=${encodeURIComponent(itemId)}`, {
    method: "GET",
  });

/** POST /api/chat/action — rewrite | summarize | outline | flashcards | tasks. */
export const chatAction = (req: Partial<ChatActionRequest> & Pick<ChatActionRequest, "action">) =>
  post<ChatActionResponse>("/api/chat/action", req);

/** POST /api/chat/agent — carry out the agent's confirmed changes, or take changes back. */
export const agentRun = <T extends AgentRequest>(req: T) =>
  post<Extract<AgentResponse, { op: T["op"] }>>("/api/chat/agent", req);

/** GET /api/search — hybrid search (vector + full text) over the signed-in user's vault. */
export const searchVault = (q: string, opts: { limit?: number; signal?: AbortSignal } = {}) =>
  call<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&limit=${opts.limit ?? 8}`, { method: "GET", signal: opts.signal });

/** POST /api/digest — weekly digests (saved to 90_Digests unless save: false). */
export const generateDigest = (req: Partial<DigestRequest> = {}) =>
  post<DigestResponse>("/api/digest", req);
