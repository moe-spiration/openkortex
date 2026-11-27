// Typed contract for `POST {baseUrl}/api/ingest` plus the client that speaks it.
//
// The extension never talks to Supabase: everything funnels through the Kortex web app's ingest
// route, which owns auth, dedup, routing and the AI pipeline. Types are aligned with @kortex/db
// (KnowledgeItemType / ItemStatus / item_highlights.locator) so the route handler can reuse them.
//
//   Auth      Authorization: Bearer <Kortex API token>   (set on the options page)
//   Request   IngestRequest   (discriminated on `kind`)
//   Response  IngestResponse  (discriminated on `ok`); HTTP 200 for success, 4xx/5xx with `ok:false`
import type { ItemHighlight, ItemStatus, KnowledgeItemType } from "@kortex/db";
import { getLocale, t } from "../i18n";
import { isMockMode, type ExtensionSettings, type SummaryLevel } from "./settings";

export const INGEST_PATH = "/api/ingest";
export const CLIENT_NAME = "kortex-extension";
export const AI_MEMORIES_FOLDER = "40_AI_Memories";

export interface ClientInfo {
  name: typeof CLIENT_NAME;
  version: string;
}

interface IngestBase {
  client: ClientInfo;
  /** ISO 8601 capture time (the client clock, not the server's). */
  captured_at: string;
  /**
   * Generated once per capture and reused by every retry. The server answers a repeated key with the
   * original item (`replayed: true`) instead of writing again. Honoured for web_clip, highlight, ai_chat.
   */
  idempotency_key?: string;
}

/** How detailed the server's auto-summary should be (C1). Omitted = server default (`concise`). */
interface SummaryOptions {
  summary_level?: SummaryLevel;
}

/** One caption line: `start`/`dur` in seconds. */
export interface TranscriptSegment {
  start: number;
  dur?: number;
  text: string;
}

/**
 * Text of a video/podcast read on the page (YouTube captions today). The server uses it instead of
 * fetching audio; `text` is capped at 400,000 characters (`TRANSCRIPT_MAX_CHARS`).
 */
export interface Transcript {
  text: string;
  /** BCP-47 code of the caption track ("de", "en"). */
  lang?: string;
  source: "youtube-captions" | "page" | "user";
  segments?: TranscriptSegment[];
}

/** What the page is, when it is a playable thing. */
export interface MediaInfo {
  kind: "video" | "podcast" | "audio";
  provider?: "youtube" | "spotify" | "apple" | "other";
  duration_sec?: number;
  /** Channel / show / author. */
  channel?: string;
  /** ISO 8601 date or date-time. */
  published_at?: string;
}

/** 1-click web clip. The server fetches/reads the URL (Jina/Firecrawl) and runs the AI pipeline. */
export interface WebClipRequest extends IngestBase, SummaryOptions {
  kind: "web_clip";
  url: string;
  title: string;
  description?: string | null;
  /** Cover: absolute http(s) URL only, chosen by the site extractors (video thumbnail, product photo, og:image). */
  image_url?: string | null;
  site_name?: string | null;
  /** The user's own note ("Warum ist das relevant?"); stored above the clipped content. */
  note?: string | null;
  /**
   * Explicit target folder (becomes `is_manual_placement = true`). Omitted/null = zero-setup
   * auto-routing: the item lands in `00_Inbox` and the AI organizer files it.
   */
  folder_path?: string | null;
  /** Hashtags without the leading `#`, hierarchical with `/` (e.g. `ai/mcp`). */
  tags?: string[];
  type_hint?: KnowledgeItemType;
  /** Caption/transcript text found on the page (YouTube); lets the server skip audio transcription. */
  transcript?: Transcript | null;
  /** Duration, channel and provider of a video/podcast page. */
  media?: MediaInfo | null;
}

/** Where a highlight sits in the page; stored as-is in `item_highlights.locator`. */
export interface HighlightLocator {
  v: 1;
  /** W3C-style text quote selector: robust against small page changes. */
  quote: { exact: string; prefix: string; suffix: string };
  /** Character offsets inside `document.body.textContent` at capture time. */
  position: { start: number; end: number };
  /** DOM range at capture time (XPath of the text nodes + offsets). */
  range: { startXPath: string; startOffset: number; endXPath: string; endOffset: number };
}

/** Inline highlight. The server upserts a bookmark item for `url` if none exists, then attaches it. */
export interface HighlightRequest extends IngestBase {
  kind: "highlight";
  url: string;
  page_title: string;
  /** -> item_highlights.quote_text / note_text / color / locator */
  quote_text: string;
  note_text?: string | null;
  color?: string;
  locator: HighlightLocator;
}

export type ChatPlatform = "chatgpt" | "claude";

/** A whole chat or a single answer, already converted to clean Markdown. Stored as type `ai_chat`. */
export interface AiChatRequest extends IngestBase, SummaryOptions {
  kind: "ai_chat";
  platform: ChatPlatform;
  scope: "chat" | "answer";
  url: string;
  title: string;
  /** `### User` / `### Assistant` sections, code blocks kept. */
  content_md: string;
  message_count: number;
  /** Always `40_AI_Memories`; the server derives `YYYY-MM-DD_topic-slug.md`. */
  folder_path: typeof AI_MEMORIES_FOLDER;
  tags?: string[];
}

/**
 * Free-standing Markdown capture without a page URL (server kind `note`): prompts and tab sessions.
 * `type_hint` + `folder_path` file it as the registry type. `metadata` (variables, tabs) is what the
 * type's schema expects; the server drops unknown keys until `note` accepts it (docs/extension-prompts-tabs.md).
 */
export interface NoteRequest extends IngestBase {
  kind: "note";
  title: string;
  content_md: string;
  folder_path?: string | null;
  tags?: string[];
  type_hint?: KnowledgeItemType;
  metadata?: Record<string, unknown>;
}

export type IngestRequest = WebClipRequest | HighlightRequest | AiChatRequest | NoteRequest;
export type IngestKind = IngestRequest["kind"];

export interface IngestSuccess {
  ok: true;
  /** `file` = a multipart upload (screenshot), see `uploadFile`. */
  kind: IngestKind | "file";
  /** knowledge_items.id (for highlights: the page item the highlight belongs to). */
  item_id: string;
  /** Only for kind `highlight` (item_highlights.id). */
  highlight_id?: ItemHighlight["id"];
  type: KnowledgeItemType;
  status: ItemStatus;
  folder_path: string;
  /** True when the AI organizer will place the item (no explicit folder was given). */
  auto_routed: boolean;
  /** True when the URL/content already existed and was merged instead of duplicated. */
  duplicate: boolean;
  /** True when the idempotency key was seen before: nothing was written again. */
  replayed?: boolean;
  /** Vault file name (`YYYY-MM-DD_topic-slug.md`) for ai_chat items. */
  file?: string;
  /** Hashtags the server would suggest next time (optional). */
  suggested_tags?: string[];
  /** True while the AI pipeline still runs after this response (poll `status` for the result). */
  queued?: boolean;
}

/** Result of `GET /api/ingest?item_id=…`: where the item is in the pipeline and where it ended up. */
export interface ItemStatusInfo {
  item_id: string;
  status: ItemStatus;
  type: KnowledgeItemType;
  title: string;
  folder_path: string;
  error?: string;
}

/** Result of `GET /api/ingest` (connection test). */
export interface PingInfo {
  user_id: string;
  /** Name of the personal token that authenticated (shown as "Verbunden mit Token …"). */
  token_name?: string;
}

export type IngestErrorCode =
  /** The server is up but lacks configuration (HTTP 503): retried from the outbox. */
  | "not_configured"
  /** Extension-only: URL/token are not set in the options yet (never sent by the server). */
  | "setup_required"
  | "unauthorized"
  | "invalid_request"
  | "rate_limited"
  | "server_error"
  | "network";

export interface IngestFailure {
  ok: false;
  /** `details` is the server's zod issue list for `invalid_request` (`[{ path: ["title"], … }]`). */
  error: { code: IngestErrorCode; message: string; details?: unknown };
}

export type IngestResponse = IngestSuccess | IngestFailure;

/** Transient failures worth retrying from the outbox; everything else is final. */
export const isRetryable = (r: IngestFailure) =>
  r.error.code === "network" ||
  r.error.code === "server_error" ||
  r.error.code === "rate_limited" ||
  r.error.code === "not_configured";

// --- request construction & validation ---------------------------------------------------------

export const clientInfo = (version: string): ClientInfo => ({ name: CLIENT_NAME, version });

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isHttpUrl = (v: unknown): v is string => {
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
  if (r.kind === "note") return isString(r.title) && isString(r.content_md) ? null : "title and content_md are required";
  if (!isHttpUrl(r.url)) return "url must be an http(s) URL";
  switch (r.kind) {
    case "web_clip":
      return isString(r.title) ? null : "title is required";
    case "highlight": {
      if (!isString(r.quote_text)) return "quote_text is required";
      const loc = r.locator as Partial<HighlightLocator> | undefined;
      return loc?.v === 1 && loc.quote && loc.range && loc.position ? null : "locator is invalid";
    }
    case "ai_chat":
      if (r.platform !== "chatgpt" && r.platform !== "claude") return "unknown platform";
      if (r.scope !== "chat" && r.scope !== "answer") return "unknown scope";
      if (!isString(r.content_md)) return "content_md is required";
      return r.folder_path === AI_MEMORIES_FOLDER ? null : `folder_path must be ${AI_MEMORIES_FOLDER}`;
    default:
      return "unknown kind";
  }
}

// --- client -----------------------------------------------------------------------------------

export interface MockInboxEntry {
  at: string;
  request: IngestRequest;
  response: IngestSuccess;
}

export interface ApiDeps {
  getSettings: () => Promise<ExtensionSettings>;
  fetchImpl?: typeof fetch;
  /** Records mock-mode captures so the options page can show them. */
  recordMock?: (entry: MockInboxEntry) => Promise<void>;
  now?: () => Date;
  timeoutMs?: number;
}

const fail = (code: IngestErrorCode, message: string): IngestFailure => ({
  ok: false,
  error: { code, message },
});

export const slugify = (input: string) =>
  input
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "untitled";

/** Same convention as the MCP server / playbook 5.3: `YYYY-MM-DD_topic-slug.md`. */
export const memoryFileName = (title: string, at: Date) =>
  `${at.toISOString().slice(0, 10)}_${slugify(title)}.md`;

const KIND_TYPE: Record<IngestKind, KnowledgeItemType> = {
  web_clip: "bookmark",
  highlight: "bookmark",
  ai_chat: "ai_chat",
  note: "note",
};

/** Deterministic stand-in for the server, used in mock mode (default) and in previews. */
export function mockIngest(req: IngestRequest, now: Date = new Date()): IngestSuccess {
  const base = {
    ok: true as const,
    kind: req.kind,
    item_id: `mock-${slugify(req.kind === "ai_chat" || req.kind === "note" ? req.title : req.url)}-${now.getTime().toString(36)}`,
    status: "inbox" as ItemStatus,
    duplicate: false,
  };
  switch (req.kind) {
    case "web_clip": {
      const auto = !req.folder_path;
      return {
        ...base,
        type: req.type_hint ?? KIND_TYPE.web_clip,
        folder_path: req.folder_path ?? "00_Inbox",
        auto_routed: auto,
        suggested_tags: req.tags,
      };
    }
    case "highlight":
      return {
        ...base,
        type: KIND_TYPE.highlight,
        folder_path: "00_Inbox",
        auto_routed: true,
        highlight_id: `mock-hl-${now.getTime().toString(36)}`,
      };
    case "note":
      return {
        ...base,
        type: req.type_hint ?? KIND_TYPE.note,
        folder_path: req.folder_path ?? "00_Inbox",
        auto_routed: !req.folder_path,
        suggested_tags: req.tags,
      };
    case "ai_chat":
      return {
        ...base,
        type: "ai_chat",
        folder_path: AI_MEMORIES_FOLDER,
        auto_routed: false,
        file: memoryFileName(req.title, now),
      };
  }
}

export type ApiResult<T> = { ok: true; data: T } | IngestFailure;

export interface ApiClient {
  ingest(req: IngestRequest): Promise<IngestResponse>;
  /** "Verbindung testen": proves URL and token against the server (never mocked). */
  ping(): Promise<ApiResult<PingInfo>>;
  /** Pipeline state of a captured item; mock captures answer from the mock. */
  status(itemId: string): Promise<ApiResult<ItemStatusInfo>>;
  /**
   * The newest items of one type from `GET /api/search?type=` (empty query = recent listing, with `content_md`).
   * Needs the token scope `search`. Mock mode and missing setup answer `setup_required` (the caller stays local).
   */
  listItems(type: "prompt" | "session", limit?: number): Promise<ApiResult<SearchHit[]>>;
  /** Hybrid search `GET /api/search?q=` (side panel "Related in Kortex"); needs the scope `search`, like listItems. */
  searchItems(query: string, limit?: number): Promise<ApiResult<SearchHit[]>>;
  /** Snooze a saved clip: sets `remind_at` of the item (null clears it). Mock mode answers locally. */
  remind(itemId: string, remindAt: string | null): Promise<ApiResult<{ remind_at: string | null }>>;
  /** Removes a saved highlight (the page item stays). Mock mode answers locally. */
  deleteHighlight(highlightId: string): Promise<ApiResult<{ deleted: true }>>;
  /**
   * Uploads a file (the popup's screenshot) as multipart/form-data to `POST /api/ingest` (`file` plus optional
   * `title`, `note`, `folder_path`, `tags`); the server stores it and runs vision OCR. Not queued: a failure is
   * reported to the caller. Mock mode answers locally.
   */
  uploadFile(file: Blob, name: string, fields: FileUploadFields): Promise<IngestResponse>;
}

export interface FileUploadFields {
  title?: string;
  note?: string;
  folder_path?: string | null;
  tags?: string[];
}

/** Images the ingest route takes as an upload (screenshots are PNG or JPEG). */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const SEARCH_PATH = "/api/search";
export const REMINDER_PATH = "/api/reminder";
export const HIGHLIGHT_PATH = "/api/highlight";

/** One row of the `/api/search` response (the fields the extension reads). */
export interface SearchHit {
  item_id: string;
  title: string;
  type: string;
  folder_path: string | null;
  source_url: string | null;
  tags: string[];
  content_md?: string;
}

const isSearchHit = (h: unknown): h is SearchHit =>
  typeof h === "object" && h !== null && isString((h as SearchHit).item_id) && isString((h as SearchHit).title) && isString((h as SearchHit).type);

export function createApiClient(deps: ApiDeps): ApiClient {
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? (() => new Date());

  /** One authenticated request to the Kortex ingest route; the body is parsed by the caller. */
  async function call(settings: ExtensionSettings, init: { method: "GET" | "POST"; query?: string; body?: unknown; path?: string; form?: FormData; timeoutMs?: number }) {
    const url = new URL(init.path ?? INGEST_PATH, settings.baseUrl.endsWith("/") ? settings.baseUrl : `${settings.baseUrl}/`);
    if (init.query) url.search = init.query;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? deps.timeoutMs ?? 15_000);
    try {
      const res = await fetchImpl(url, {
        method: init.method,
        headers: {
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${settings.token.trim()}`,
          // The language the server answers in. `X-Kortex-Locale` is not sent: the server's CORS preflight
          // for extension origins allows only `authorization, content-type` (apps/web/src/server/cors.ts), so a
          // custom header would fail every request made without host permission. Accept-Language is
          // CORS-safelisted and the server falls back to it (apps/web/src/i18n/server.ts).
          "Accept-Language": getLocale(),
        },
        // multipart: the browser sets the content type with the boundary itself
        body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
        signal: ctrl.signal,
        credentials: "omit",
      });
      return { res, body: (await res.json().catch(() => null)) as unknown };
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      return fail("network", aborted ? t("Timed out") : t("Kortex is unreachable"));
    } finally {
      clearTimeout(timer);
    }
  }

  const needsSetup = (s: ExtensionSettings) => !isHttpUrl(s.baseUrl) || !s.token.trim();
  const setupMessage = () => t("Kortex URL and API token are missing (options).");

  return {
    async ping() {
      const settings = await deps.getSettings();
      if (needsSetup(settings)) return fail("setup_required", setupMessage());
      const r = await call(settings, { method: "GET" });
      if ("ok" in r) return r;
      if (r.res.ok && (r.body as { ok?: unknown } | null)?.ok === true) {
        const b = r.body as { user_id?: string; token_name?: string };
        return { ok: true, data: { user_id: String(b.user_id ?? ""), token_name: b.token_name } };
      }
      if (isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },

    async status(itemId) {
      const settings = await deps.getSettings();
      if (isMockMode(settings)) {
        return { ok: true, data: { item_id: itemId, status: "inbox", type: "bookmark", title: "", folder_path: "00_Inbox" } };
      }
      if (needsSetup(settings)) return fail("setup_required", setupMessage());
      const r = await call(settings, { method: "GET", query: `item_id=${encodeURIComponent(itemId)}` });
      if ("ok" in r) return r;
      const item = (r.body as { item?: ItemStatusInfo } | null)?.item;
      if (r.res.ok && item) return { ok: true, data: item };
      if (isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },

    async remind(itemId, remindAt) {
      const settings = await deps.getSettings();
      if (isMockMode(settings)) return { ok: true, data: { remind_at: remindAt } };
      if (needsSetup(settings)) return fail("setup_required", setupMessage());
      const r = await call(settings, { method: "POST", path: REMINDER_PATH, body: { item_id: itemId, remind_at: remindAt } });
      if ("ok" in r) return r;
      if (r.res.ok && (r.body as { ok?: unknown } | null)?.ok === true) return { ok: true, data: { remind_at: remindAt } };
      if (isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },

    async deleteHighlight(highlightId) {
      const settings = await deps.getSettings();
      if (isMockMode(settings)) return { ok: true, data: { deleted: true } };
      if (needsSetup(settings)) return fail("setup_required", setupMessage());
      const r = await call(settings, { method: "POST", path: HIGHLIGHT_PATH, body: { highlight_id: highlightId, action: "delete" } });
      if ("ok" in r) return r;
      if (r.res.ok && (r.body as { ok?: unknown } | null)?.ok === true) return { ok: true, data: { deleted: true } };
      // already gone on the server counts as removed
      if (r.res.status === 404) return { ok: true, data: { deleted: true } };
      if (isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },

    async listItems(type, limit = 50) {
      const settings = await deps.getSettings();
      if (isMockMode(settings) || needsSetup(settings)) return fail("setup_required", setupMessage());
      const query = new URLSearchParams({ type, limit: String(limit), content: "1", semantic: "0" }).toString();
      const r = await call(settings, { method: "GET", path: SEARCH_PATH, query });
      if ("ok" in r) return r;
      const results = (r.body as { ok?: unknown; results?: unknown } | null)?.results;
      if (r.res.ok && Array.isArray(results)) return { ok: true, data: results.filter(isSearchHit).filter((h) => h.type === type) };
      if (r.res.status === 403) return fail("unauthorized", t("The API token lacks the “Search” access. Create a token with search in Kortex."));
      if (isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },

    async uploadFile(file, name, fields) {
      if (file.size > UPLOAD_MAX_BYTES) return fail("invalid_request", t("The file is larger than 50 MB."));
      const settings = await deps.getSettings();
      if (isMockMode(settings)) {
        const at = now();
        return {
          ok: true,
          kind: "file",
          item_id: `mock-${slugify(fields.title ?? name)}-${at.getTime().toString(36)}`,
          type: "image",
          status: "inbox",
          folder_path: fields.folder_path ?? "00_Inbox",
          auto_routed: !fields.folder_path,
          duplicate: false,
        };
      }
      if (needsSetup(settings)) return fail("setup_required", setupMessage());
      const form = new FormData();
      form.append("file", file, name);
      if (fields.title) form.append("title", fields.title);
      if (fields.note) form.append("note", fields.note);
      if (fields.folder_path) form.append("folder_path", fields.folder_path);
      if (fields.tags?.length) form.append("tags", fields.tags.join(","));
      const r = await call(settings, { method: "POST", form, timeoutMs: 60_000 });
      if ("ok" in r) return r;
      if (r.res.ok && isSuccess(r.body)) return r.body;
      if (!r.res.ok && isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },

    async searchItems(query, limit = 6) {
      const settings = await deps.getSettings();
      if (isMockMode(settings) || needsSetup(settings)) return fail("setup_required", setupMessage());
      const r = await call(settings, { method: "GET", path: SEARCH_PATH, query: new URLSearchParams({ q: query.slice(0, 200), limit: String(limit) }).toString() });
      if ("ok" in r) return r;
      const results = (r.body as { results?: unknown } | null)?.results;
      if (r.res.ok && Array.isArray(results)) return { ok: true, data: results.filter(isSearchHit) };
      if (r.res.status === 403) return fail("unauthorized", t("The API token lacks the “Search” access. Create a token with search in Kortex."));
      if (isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },

    async ingest(req) {
      const invalid = validateIngestRequest(req);
      if (invalid) return fail("invalid_request", invalid);

      const settings = await deps.getSettings();
      if (isMockMode(settings)) {
        const response = mockIngest(req, now());
        await deps.recordMock?.({ at: now().toISOString(), request: req, response });
        return response;
      }

      if (needsSetup(settings)) return fail("setup_required", setupMessage());
      const r = await call(settings, { method: "POST", body: req });
      if ("ok" in r) return r;
      if (r.res.ok && isSuccess(r.body)) return r.body;
      if (!r.res.ok && isFailure(r.body)) return r.body;
      return fail(codeForStatus(r.res.status), t("Unexpected answer (HTTP {status})", { status: r.res.status }));
    },
  };
}

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
