import { t } from "../i18n";
import type { AgentProposal, AgentResult, AgentStep } from "../lib/agent";

/*
 * Parser for the AI SDK UI message stream that POST /api/chat returns (SSE: `data: {json}` lines).
 * Incremental: the app feeds network chunks (expo/fetch streams) and renders the answer so far.
 */

export interface ChatCitation {
  n: number;
  item_id: string;
  title: string;
}

export interface ChatAnswer {
  text: string;
  citations: ChatCitation[];
  error: string | null;
  /** Agent: the visible steps (data-step), in order. */
  steps: AgentStep[];
  /** Agent "ask": changes waiting for confirmation (data-proposal, the latest one wins). */
  proposal: AgentProposal | null;
  /** Agent "self": changes already made (data-done). */
  done: AgentResult[];
}

type Part = {
  type?: string;
  delta?: string;
  errorText?: string;
  data?: { citations?: ChatCitation[]; kind?: AgentStep["kind"]; label?: string; count?: number; actions?: AgentProposal["actions"]; labels?: string[]; results?: AgentResult[] };
};

export function createChatStreamParser() {
  let buf = "";
  let text = "";
  let citations: ChatCitation[] = [];
  let error: string | null = null;
  const steps: AgentStep[] = [];
  let proposal: AgentProposal | null = null;
  let done: AgentResult[] = [];

  const line = (l: string) => {
    const m = /^data:\s?(.*)$/.exec(l);
    if (!m || !m[1] || m[1] === "[DONE]") return;
    let part: Part;
    try {
      part = JSON.parse(m[1]) as Part;
    } catch {
      return;
    }
    if (part.type === "text-delta" && typeof part.delta === "string") text += part.delta;
    else if (part.type === "data-citations" && Array.isArray(part.data?.citations))
      citations = part.data.citations.map(({ n, item_id, title }) => ({ n, item_id, title }));
    else if (part.type === "data-step" && typeof part.data?.label === "string")
      steps.push({ kind: part.data.kind ?? "search", label: part.data.label, ...(typeof part.data.count === "number" ? { count: part.data.count } : {}) });
    else if (part.type === "data-proposal" && Array.isArray(part.data?.actions) && part.data.actions.length)
      proposal = { actions: part.data.actions, labels: Array.isArray(part.data.labels) ? part.data.labels : [] };
    else if (part.type === "data-done" && Array.isArray(part.data?.results)) done = part.data.results;
    else if (part.type === "error") error = part.errorText ?? t("Error while answering");
  };

  return {
    /** Adds a chunk (may end mid-line) and returns the answer so far. */
    push(chunk: string): ChatAnswer {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      lines.forEach(line);
      return { text, citations, error, steps: [...steps], proposal, done };
    },
    end(): ChatAnswer {
      if (buf) line(buf);
      buf = "";
      return { text: text.trim(), citations, error, steps: [...steps], proposal, done };
    },
  };
}

export function parseChatStream(raw: string): ChatAnswer {
  const p = createChatStreamParser();
  p.push(raw);
  return p.end();
}

/** Only the sources the answer actually cites ([n]); all of them when it cites none. */
export function citedSources(answer: ChatAnswer): ChatCitation[] {
  const used = new Set([...answer.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return used.size ? answer.citations.filter((c) => used.has(c.n)) : answer.citations;
}
