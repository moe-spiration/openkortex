// "Ask about this page" in the side panel: POST {baseUrl}/api/chat (the Hybrid-RAG copilot) with the page as
// context. The answer streams as the AI SDK UI message stream (SSE `data: {json}` lines); the parser is the same
// one the Android app uses (apps/mobile/src/api/chatStream.ts), trimmed to text, citations and errors.
//
// Auth: the personal token needs the scope "ask" (optional when the token is created). A capture-only token gets
// 403, which is answered with a hint instead of a generic error. The server's CORS allows only
// authorization/content-type from extension origins, so no custom headers are sent.
import { getLocale, t } from "../i18n";
import { isMockMode, type ExtensionSettings } from "./settings";

export const CHAT_PATH = "/api/chat";

export interface AskCitation {
  n: number;
  item_id: string;
  title: string;
}

export interface AskAnswer {
  text: string;
  citations: AskCitation[];
  error: string | null;
}

type Part = { type?: string; delta?: string; errorText?: string; data?: { citations?: AskCitation[] } };

export function createAskStreamParser() {
  let buf = "";
  let text = "";
  let citations: AskCitation[] = [];
  let error: string | null = null;
  const line = (l: string) => {
    const m = /^data:\s?(.*)$/.exec(l);
    if (!m || !m[1] || m[1] === "[DONE]") return;
    let part: Part;
    try {
      part = JSON.parse(m[1]) as Part;
    } catch {
      return;
    }
    if (part.type === "text-start") {
      if (text.trim() && !text.endsWith("\n\n")) text = `${text.trimEnd()}\n\n`;
    } else if (part.type === "text-delta" && typeof part.delta === "string") text += part.delta;
    else if (part.type === "data-citations" && Array.isArray(part.data?.citations))
      citations = part.data.citations.map(({ n, item_id, title }) => ({ n, item_id, title }));
    else if (part.type === "error") error = part.errorText ?? t("Error while answering");
  };
  return {
    push(chunk: string): AskAnswer {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      lines.forEach(line);
      return { text, citations, error };
    },
    end(): AskAnswer {
      if (buf) line(buf);
      buf = "";
      return { text: text.trim(), citations, error };
    },
  };
}

/** Only the sources the answer cites ([n]); all of them when it cites none. */
export function citedSources(answer: AskAnswer): AskCitation[] {
  const used = new Set([...answer.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return used.size ? answer.citations.filter((c) => used.has(c.n)) : answer.citations;
}

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PageContext {
  url: string;
  title: string;
  /** Readable text of the page (excerpt), sent with the first question. */
  text?: string;
  /** Selected text the question is about. */
  quote?: string;
  /** The saved item of the page (a UUID from the server): the copilot reads it as "this note". */
  itemId?: string | null;
}

export type AskScope = "page" | "library";

const PAGE_TEXT_MAX = 24_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The request body: with scope "page" and a saved item, mode "note" on that item; otherwise mode "brain" with the
 * page (title, address, selection, text excerpt) in front of the first question, so the answer can use it.
 */
export function buildAskBody(history: AskTurn[], question: string, page: PageContext | null, scope: AskScope) {
  const saved = scope === "page" && page?.itemId && UUID.test(page.itemId) ? page.itemId : null;
  const turns = [...history];
  let q = question.trim();
  if (scope === "page" && page && history.length === 0) {
    const context = [
      t("About the page “{title}” ({url}).", { title: page.title, url: page.url }),
      page.quote ? t("Selected passage: “{quote}”", { quote: page.quote.slice(0, 2000) }) : "",
      !saved && page.text ? `${t("Page text (excerpt):")}\n${page.text.slice(0, PAGE_TEXT_MAX)}` : "",
    ].filter(Boolean);
    q = `${context.join("\n\n")}\n\n${t("Question:")} ${q}`;
  }
  return {
    messages: [...turns, { role: "user" as const, content: q }],
    mode: saved ? ("note" as const) : ("brain" as const),
    ...(saved ? { item_id: saved } : {}),
  };
}

export type AskFailure = { code: "setup_required" | "forbidden" | "unauthorized" | "network" | "server_error"; message: string };

export interface AskDeps {
  settings: ExtensionSettings;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onUpdate?: (answer: AskAnswer) => void;
}

export async function askKortex(body: ReturnType<typeof buildAskBody>, deps: AskDeps): Promise<{ ok: true; answer: AskAnswer } | { ok: false; error: AskFailure }> {
  const s = deps.settings;
  if (isMockMode(s) || !s.token.trim() || !/^https?:\/\//.test(s.baseUrl)) {
    return { ok: false, error: { code: "setup_required", message: t("Asking needs a connected Kortex (options, connection).") } };
  }
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = new URL(CHAT_PATH, s.baseUrl.endsWith("/") ? s.baseUrl : `${s.baseUrl}/`);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token.trim()}`, "Accept-Language": getLocale() },
      body: JSON.stringify(body),
      credentials: "omit",
      signal: deps.signal,
    });
  } catch {
    return { ok: false, error: { code: "network", message: t("Kortex is unreachable") } };
  }
  if (res.status === 403) {
    return { ok: false, error: { code: "forbidden", message: t("This API token may not ask. Create a token with “Ask” access in Kortex and paste it in the options.") } };
  }
  if (res.status === 401) return { ok: false, error: { code: "unauthorized", message: t("The API token was not accepted.") } };
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, error: { code: "server_error", message: b?.error?.message ?? t("Unexpected answer (HTTP {status})", { status: res.status }) } };
  }
  const parser = createAskStreamParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      deps.onUpdate?.(parser.push(decoder.decode(value, { stream: true })));
    }
  } catch {
    if (deps.signal?.aborted) return { ok: true, answer: parser.end() };
    return { ok: false, error: { code: "network", message: t("The answer was cut off.") } };
  }
  const answer = parser.end();
  deps.onUpdate?.(answer);
  return { ok: true, answer };
}
