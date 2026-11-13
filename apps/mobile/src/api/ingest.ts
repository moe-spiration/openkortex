// Typed client for `POST {baseUrl}/api/ingest`, compatible with the contract in
// apps/web/src/server/ingest/contract.ts and apps/extension/src/lib/api.ts (`web_clip`) plus the
// `note` kind and multipart `file` upload that the server offers for mobile / desktop capture.
//
//   Auth      Authorization: Bearer <Kortex API token>
//   Request   IngestRequest (JSON, discriminated on `kind`) or a multipart file upload
//   Response  IngestResponse (discriminated on `ok`)
//
// Mock mode is the default: nothing leaves the phone until a Kortex instance is configured.

import { localeHeader, t } from "../i18n";
import { fetchWithForm } from "./formFetch";

export const INGEST_PATH = "/api/ingest";
export const CLIENT_NAME = "kortex-mobile";
export const INBOX_FOLDER = "00_Inbox";

export type KnowledgeItemType = "note" | "article" | "image" | "voice" | "pdf" | "epub" | "video" | "social" | "bookmark";
export type ItemStatus = "inbox" | "processing" | "processed" | "error" | "archived";

export interface ClientInfo {
  name: typeof CLIENT_NAME;
  version: string;
}

interface IngestBase {
  client: ClientInfo;
  /** ISO 8601 capture time (the phone's clock). */
  captured_at: string;
}

/** A shared link. The server fetches the page and runs the AI pipeline. */
export interface WebClipRequest extends IngestBase {
  kind: "web_clip";
  url: string;
  title: string;
  description?: string | null;
  image_url?: string | null;
  site_name?: string | null;
  note?: string | null;
  folder_path?: string | null;
  tags?: string[];
  type_hint?: KnowledgeItemType;
}

/** A thought or shared text without a link. */
export interface NoteRequest extends IngestBase {
  kind: "note";
  content_md: string;
  title?: string;
  folder_path?: string | null;
  tags?: string[];
  type_hint?: KnowledgeItemType;
}

export type IngestRequest = WebClipRequest | NoteRequest;

/** A shared / captured file (PDF, EPUB, image). Sent as multipart/form-data. */
export interface FileUpload {
  /** `file://` or `content://` URI on the device. */
  uri: string;
  name: string;
  mimeType: string;
}

export interface FileIngestOptions {
  folder_path?: string | null;
  tags?: string[];
  title?: string;
  note?: string;
}

export type IngestKind = IngestRequest["kind"] | "file";

export interface IngestSuccess {
  ok: true;
  kind: IngestKind;
  item_id: string;
  type: KnowledgeItemType;
  status: ItemStatus;
  folder_path: string;
  auto_routed: boolean;
  duplicate: boolean;
  suggested_tags?: string[];
  queued?: boolean;
}

export type IngestErrorCode = "not_configured" | "unauthorized" | "invalid_request" | "rate_limited" | "server_error" | "network";

export interface IngestFailure {
  ok: false;
  error: { code: IngestErrorCode; message: string };
}

export type IngestResponse = IngestSuccess | IngestFailure;

export const isRetryable = (r: IngestFailure) => r.error.code === "network" || r.error.code === "server_error" || r.error.code === "rate_limited";

export interface IngestSettings {
  mockMode: boolean;
  /** e.g. https://kortex.example.com */
  baseUrl: string;
  token: string;
}

// --- construction & validation ------------------------------------------------------------------

export const clientInfo = (version: string): ClientInfo => ({ name: CLIENT_NAME, version });

const isString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const isHttpUrl = (v: unknown): v is string => {
  if (!isString(v)) return false;
  try {
    return /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
};

/** Returns an error message, or null when the request is well-formed. */
export function validateIngestRequest(req: unknown): string | null {
  if (typeof req !== "object" || req === null) return "request must be an object";
  const r = req as Record<string, unknown>;
  switch (r.kind) {
    case "web_clip":
      if (!isHttpUrl(r.url)) return "url must be an http(s) URL";
      return isString(r.title) ? null : "title is required";
    case "note":
      return isString(r.content_md) ? null : "content_md is required";
    default:
      return "unknown kind";
  }
}

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

export interface SharedContent {
  /** Shared text (may contain a link). */
  text?: string | null;
  /** Shared link when the sending app marks it as such. */
  webUrl?: string | null;
  /** Page title when the sender provides one (browsers do). */
  title?: string | null;
}

/** The search query of a Google search URL (google.com, google.de, …), else null. */
export function googleQuery(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname) || u.pathname !== "/search") return null;
    return u.searchParams.get("q")?.trim() || null;
  } catch {
    return null;
  }
}

/** Turns a shared link or text into an ingest request (link -> web_clip, plain text -> note). */
export function requestFromShare(shared: SharedContent, version: string, now: Date = new Date()): IngestRequest | null {
  const base = { client: clientInfo(version), captured_at: now.toISOString() };
  const text = shared.text?.trim() ?? "";
  const url = shared.webUrl && isHttpUrl(shared.webUrl) ? shared.webUrl : URL_RE.exec(text)?.[0];
  if (url) {
    // A Google search result page is no article (the server only gets a bot/consent page):
    // keep the query as a note with the link instead.
    const query = googleQuery(url);
    if (query) {
      return { ...base, kind: "note", title: t("Google search: {query}", { query }).slice(0, 120), content_md: `${t("Google search: **{query}**", { query })}\n\n${url}` };
    }
    const withoutUrl = text.replace(url, "").trim();
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep the raw string */
    }
    return {
      ...base,
      kind: "web_clip",
      url,
      title: shared.title?.trim() || withoutUrl.split("\n")[0]?.slice(0, 120) || host,
      note: withoutUrl && withoutUrl !== shared.title ? withoutUrl : null,
      site_name: host,
    };
  }
  if (!text) return null;
  return { ...base, kind: "note", content_md: text, title: shared.title?.trim() || text.split("\n")[0]!.slice(0, 80) };
}

// --- client -------------------------------------------------------------------------------------

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";

/** Deterministic stand-in for the server (mock mode). */
export function mockIngest(req: IngestRequest | { kind: "file"; name: string }, now: Date = new Date()): IngestSuccess {
  const seed = req.kind === "web_clip" ? req.url : req.kind === "note" ? req.content_md : req.name;
  const type: KnowledgeItemType = req.kind === "web_clip" ? "bookmark" : req.kind === "note" ? "note" : /pdf$/i.test(req.name) ? "pdf" : /epub$/i.test(req.name) ? "epub" : "image";
  return {
    ok: true,
    kind: req.kind,
    item_id: `mock-${slug(seed)}-${now.getTime().toString(36)}`,
    type: req.kind === "web_clip" && req.type_hint ? req.type_hint : type,
    status: "inbox",
    folder_path: (req.kind !== "file" && req.folder_path) || INBOX_FOLDER,
    auto_routed: req.kind === "file" || !req.folder_path,
    duplicate: false,
    queued: true,
  };
}

export interface ApiDeps {
  getSettings: () => IngestSettings | Promise<IngestSettings>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  /**
   * Turns a device file into a FormData part. Expo replaces the global fetch, which only takes
   * Blob-like parts (an expo-file-system File), not React Native's { uri, name, type } objects.
   */
  filePart?: (file: FileUpload) => Blob;
}

export interface ApiClient {
  ingest(req: IngestRequest): Promise<IngestResponse>;
  ingestFile(file: FileUpload, options?: FileIngestOptions): Promise<IngestResponse>;
}

const fail = (code: IngestErrorCode, message: string): IngestFailure => ({ ok: false, error: { code, message } });

function codeForStatus(status: number): IngestErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "invalid_request";
}

const isSuccess = (b: unknown): b is IngestSuccess =>
  typeof b === "object" && b !== null && (b as IngestSuccess).ok === true && isString((b as IngestSuccess).item_id);
const isFailure = (b: unknown): b is IngestFailure =>
  typeof b === "object" && b !== null && (b as IngestFailure).ok === false && isString((b as IngestFailure).error?.code);

export function createApiClient(deps: ApiDeps): ApiClient {
  const fetchImpl = deps.fetchImpl ?? ((url: Parameters<typeof fetch>[0], init?: RequestInit) => fetchWithForm(String(url), init));
  const now = deps.now ?? (() => new Date());

  async function send(build: (settings: IngestSettings) => { body: BodyInit; headers: Record<string, string> }): Promise<IngestResponse> {
    const settings = await deps.getSettings();
    if (!isHttpUrl(settings.baseUrl) || !settings.token) return fail("not_configured", t("Kortex URL and API token are missing."));
    const url = new URL(INGEST_PATH, settings.baseUrl.endsWith("/") ? settings.baseUrl : `${settings.baseUrl}/`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 20_000);
    try {
      const { body, headers } = build(settings);
      const res = await fetchImpl(url.toString(), {
        method: "POST",
        headers: { ...headers, ...localeHeader(), Authorization: `Bearer ${settings.token}` },
        body,
        signal: ctrl.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      if (res.ok && isSuccess(json)) return json;
      if (!res.ok && isFailure(json)) return json;
      return fail(codeForStatus(res.status), t("Unexpected response (HTTP {status})", { status: res.status }));
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return fail("network", aborted ? t("Timed out") : t("Kortex is not reachable"));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async ingest(req) {
      const invalid = validateIngestRequest(req);
      if (invalid) return fail("invalid_request", invalid);
      const settings = await deps.getSettings();
      if (settings.mockMode) return mockIngest(req, now());
      return send(() => ({ body: JSON.stringify(req), headers: { "Content-Type": "application/json" } }));
    },

    async ingestFile(file, options = {}) {
      if (!isString(file.uri) || !isString(file.name)) return fail("invalid_request", "file uri and name are required");
      const settings = await deps.getSettings();
      if (settings.mockMode) return mockIngest({ kind: "file", name: file.name }, now());
      return send(() => {
        const form = new FormData();
        // React Native's FormData takes { uri, name, type } in place of a Blob.
        const part = deps.filePart ? deps.filePart(file) : ({ uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
        form.append("file", part, file.name);
        if (options.folder_path) form.append("folder_path", options.folder_path);
        if (options.title) form.append("title", options.title);
        if (options.note) form.append("note", options.note);
        options.tags?.forEach((tag) => form.append("tags", tag));
        // No Content-Type: fetch adds the multipart boundary itself.
        return { body: form, headers: {} };
      });
    },
  };
}
