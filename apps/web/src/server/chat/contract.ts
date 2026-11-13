import { z } from "zod";

// POST /api/chat — streaming Hybrid-RAG copilot.

/** Plain `{ role, content }` messages, or AI SDK UI messages (`useChat`) with `parts`. */
const TextMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(50_000),
});
const UiMessage = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).max(200),
});

export const CONTEXT_MODES = ["note", "folder", "brain"] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

export const ChatRequestSchema = z
  .object({
    messages: z
      .array(z.union([TextMessage, UiMessage]))
      .min(1)
      .max(100),
    /** note = current note/document, folder = folder or cluster, brain = whole Second Brain. */
    mode: z.enum(CONTEXT_MODES).default("brain"),
    /** The open note: the context of mode "note", and the default target of the copilot's edit tools. */
    item_id: z.uuid().optional(),
    folder_path: z.string().trim().min(1).max(300).optional(),
    cluster: z.string().trim().min(1).max(200).optional(),
    /**
     * Model switch from the copilot header: an exact model id from GET /api/models (optionally
     * "provider:model"). Default: the user's chat_reasoning route (ADR-06).
     */
    model: z.string().trim().min(1).max(200).optional(),
    match_count: z.number().int().min(1).max(20).default(8),
    /** Short answer (at most three sentences, no headings), e.g. for the desktop launcher's "Fragen". */
    brief: z.boolean().optional(),
    /**
     * Agent copilot: the model works in steps (several vault searches, reading whole entries) and
     * may propose or make changes, depending on `autonomy`. Without it the answer is one retrieval pass.
     */
    agent: z.boolean().optional(),
    /** read = no changes, ask = changes are proposed and wait for confirmation, self = changes run at once. */
    autonomy: z.enum(["read", "ask", "self"]).default("ask"),
    /** A skill picked with a slash command (/briefing, /recherche …). */
    skill: z.enum(["briefing", "research", "tidy", "draft", "week", "dossier"]).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.mode === "note" && !r.item_id)
      ctx.addIssue({ code: "custom", path: ["item_id"], message: "required for mode 'note'" });
    if (r.mode === "folder" && !r.folder_path && !r.cluster) {
      ctx.addIssue({
        code: "custom",
        path: ["folder_path"],
        message: "folder_path or cluster is required for mode 'folder'",
      });
    }
  });
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Last 20 user/assistant turns as plain text. */
export function normalizeMessages(messages: ChatRequest["messages"]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const content =
      "content" in m
        ? m.content
        : m.parts
            .filter((p) => p.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("");
    if (content.trim()) out.push({ role: m.role, content });
  }
  return out.slice(-20);
}

/** One numbered source, sent to the client as a `data-citations` stream part. */
export interface Citation {
  /** The number the model cites as [n]. */
  n: number;
  item_id: string;
  title: string;
  type: string;
  /** "Page 12", "00:05:12" or an epubcfi; null when the whole item is the source. */
  page_or_timestamp: string | null;
  folder_path: string | null;
  source_url: string | null;
  snippet: string;
}

/** Payload of the `data-citations` part (first part of every chat stream). */
export interface CitationsData {
  mode: ContextMode;
  model: string;
  citations: Citation[];
}
