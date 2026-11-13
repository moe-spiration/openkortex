import { generateText, Output } from "ai";
import { z } from "zod";
import { errorMessage } from "../errors";
import { byLocale, ph, type ContentPhraseKey } from "../i18n";
import type { ModelRouter } from "../router/model-router";
import type {
  ExtractedPayload,
  IngestionAdapter,
  RawIngestInput,
  StructuralChunk,
  SummaryLevel,
} from "./base-adapter";
import { modelFor } from "../router/model-router";

// Normalizes AI conversations into one clean Markdown dialog:
//  - the browser extension's export (`### User` / `### Assistant` sections)
//  - official exports: ChatGPT `conversations.json` (mapping tree), Claude export (`chat_messages`)
//  - agent memories from 40_AI_Memories (Markdown with optional YAML frontmatter, no dialog)

const ID = "ai-chat";

export type ChatRole = "user" | "assistant";
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export type ChatFormat = "extension_md" | "chatgpt_json" | "claude_json" | "agent_memory";

export interface ParsedChat {
  format: ChatFormat;
  title?: string;
  platform: "chatgpt" | "claude" | "agent" | "unknown";
  createdAt?: string;
  turns: ChatTurn[];
  /** Body for agent memories (no dialog). */
  body?: string;
  frontmatter: Record<string, string>;
  /** Extra conversations in a multi-conversation export that were not imported. */
  skippedConversations: number;
}

export interface AiChatAdapterOptions {
  /** Fast model writes the key takeaways. Without it the dialog is still cleaned and stored. */
  models?: ModelRouter;
}

const ROLE_HEADING =
  /^#{2,4}\s*(user|assistant|you|du|ich|chatgpt|claude|human|ai|gpt-?[\w.]*)\s*:?\s*$/i;

const roleOf = (label: string): ChatRole =>
  /^(user|you|du|ich|human)$/i.test(label) ? "user" : "assistant";

/** UI chrome that sneaks into copied chats. */
const CHROME_LINES = [
  /^(copy code|code kopieren|kopieren|copy|copied!?|kopiert!?)$/i,
  /^(regenerate|neu generieren|edit|bearbeiten|share|teilen)$/i,
  /^chatgpt can make mistakes.*$/i,
  /^chatgpt kann fehler machen.*$/i,
  /^claude can make mistakes.*$/i,
  /^\d+\s*\/\s*\d+$/, // "2 / 3" answer pager
];

export function cleanMessage(md: string): string {
  let inFence = false;
  const lines: string[] = [];
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && CHROME_LINES.some((re) => re.test(line.trim()))) continue;
    lines.push(line.replace(/[ \t]+$/, ""));
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Minimal YAML frontmatter reader (flat `key: value` pairs; lists are kept as raw text). */
export function splitFrontmatter(text: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: text };
  const frontmatter: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv?.[1]) frontmatter[kv[1]] = (kv[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body: text.slice(m[0].length) };
}

function parseMarkdownDialog(body: string): { title?: string; turns: ChatTurn[] } {
  const turns: ChatTurn[] = [];
  let title: string | undefined;
  let current: ChatTurn | undefined;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = !inFence ? line.match(ROLE_HEADING) : null;
    if (heading?.[1]) {
      if (current) turns.push(current);
      current = { role: roleOf(heading[1]), content: "" };
      continue;
    }
    if (!current) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1?.[1] && !title) title = h1[1].trim();
      continue;
    }
    current.content += `${line}\n`;
  }
  if (current) turns.push(current);
  return { title, turns };
}

interface ChatGptNode {
  parent?: string | null;
  message?: {
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
    create_time?: number | null;
    metadata?: { is_visually_hidden_from_conversation?: boolean };
  } | null;
}
interface ChatGptConversation {
  title?: string;
  create_time?: number;
  current_node?: string;
  mapping?: Record<string, ChatGptNode>;
}

function parseChatGpt(conv: ChatGptConversation): {
  title?: string;
  createdAt?: string;
  turns: ChatTurn[];
} {
  const mapping = conv.mapping ?? {};
  // The active branch: walk from the current node up to the root.
  const path: ChatGptNode[] = [];
  let id = conv.current_node ?? Object.keys(mapping).at(-1);
  const seen = new Set<string>();
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id);
    path.unshift(mapping[id] as ChatGptNode);
    id = mapping[id]?.parent ?? undefined;
  }
  const turns: ChatTurn[] = [];
  for (const node of path) {
    const msg = node.message;
    const role = msg?.author?.role;
    if (
      !msg ||
      (role !== "user" && role !== "assistant") ||
      msg.metadata?.is_visually_hidden_from_conversation
    )
      continue;
    if (
      msg.content?.content_type &&
      !["text", "multimodal_text"].includes(msg.content.content_type)
    )
      continue;
    const text = (msg.content?.parts ?? [])
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
    if (text) turns.push({ role, content: text });
  }
  return {
    title: conv.title,
    createdAt: conv.create_time ? new Date(conv.create_time * 1000).toISOString() : undefined,
    turns,
  };
}

interface ClaudeConversation {
  name?: string;
  created_at?: string;
  chat_messages?: Array<{
    sender?: string;
    text?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

function parseClaude(conv: ClaudeConversation): {
  title?: string;
  createdAt?: string;
  turns: ChatTurn[];
} {
  const turns: ChatTurn[] = [];
  for (const m of conv.chat_messages ?? []) {
    const role: ChatRole | undefined =
      m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : undefined;
    if (!role) continue;
    const text = (
      m.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n") ||
      m.text ||
      ""
    ).trim();
    if (text) turns.push({ role, content: text });
  }
  return { title: conv.name, createdAt: conv.created_at, turns };
}

const isChatGpt = (v: unknown): v is ChatGptConversation =>
  typeof v === "object" && v !== null && "mapping" in v;
const isClaude = (v: unknown): v is ClaudeConversation =>
  typeof v === "object" && v !== null && "chat_messages" in v;

/** Merges consecutive turns of the same role and drops exact repeats (re-rendered answers). */
function tidyTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    // A memory note separates exchanges with "---"; it belongs to no message.
    const content = cleanMessage(t.content.replace(/\n\s*-{3,}\s*$/, ""));
    if (!content) continue;
    const prev = out.at(-1);
    if (prev && prev.role === t.role) {
      if (prev.content !== content) prev.content = `${prev.content}\n\n${content}`;
    } else {
      out.push({ role: t.role, content });
    }
  }
  return out;
}

export function parseChat(raw: string): ParsedChat {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(data) ? data : [data];
      const first = list[0];
      if (isChatGpt(first) || isClaude(first)) {
        const parsed = isChatGpt(first) ? parseChatGpt(first) : parseClaude(first);
        return {
          format: isChatGpt(first) ? "chatgpt_json" : "claude_json",
          platform: isChatGpt(first) ? "chatgpt" : "claude",
          title: parsed.title,
          createdAt: parsed.createdAt,
          turns: tidyTurns(parsed.turns),
          frontmatter: {},
          skippedConversations: list.length - 1,
        };
      }
    } catch {
      /* not JSON: fall through to Markdown */
    }
  }
  const { frontmatter, body } = splitFrontmatter(raw.replace(/\r\n/g, "\n"));
  const { title, turns } = parseMarkdownDialog(body);
  const platform = /chatgpt|openai/i.test(frontmatter.source_platform ?? frontmatter.platform ?? "")
    ? "chatgpt"
    : /claude|anthropic/i.test(frontmatter.source_platform ?? frontmatter.platform ?? "")
      ? "claude"
      : "unknown";
  const tidy = tidyTurns(turns);
  if (tidy.length > 0) {
    return {
      format: "extension_md",
      platform,
      title: frontmatter.title ?? title,
      createdAt: frontmatter.created_at,
      turns: tidy,
      frontmatter,
      skippedConversations: 0,
    };
  }
  return {
    format: "agent_memory",
    platform: platform === "unknown" ? "agent" : platform,
    title: frontmatter.title ?? title,
    createdAt: frontmatter.created_at,
    turns: [],
    body: cleanMessage(body),
    frontmatter,
    skippedConversations: 0,
  };
}

/** True when the text is a chat export the adapter understands (used by canHandle). */
export function looksLikeChat(text: string): boolean {
  const head = text.trimStart().slice(0, 5000);
  if (/^[[{]/.test(head)) return /"mapping"\s*:|"chat_messages"\s*:/.test(head);
  const lines = head.split("\n");
  return (
    lines.some((l) => /^#{2,4}\s*(user|you|human)\s*:?\s*$/i.test(l)) &&
    lines.some((l) => /^#{2,4}\s*(assistant|chatgpt|claude)\s*:?\s*$/i.test(l))
  );
}

export const ChatTakeawaysSchema = z.object({
  title: z.string(),
  /** 1-2 sentences: what the conversation was about and what came out of it. */
  summary: z.string().optional(),
  takeaways: z.array(z.string()),
  /** Decisions that were made (empty when none). */
  decisions: z.array(z.string()).optional(),
  open_questions: z.array(z.string()),
});

const TAKEAWAYS_PROMPT_DE = `Du archivierst eine KI-Konversation oder eine Agent-Session im Second Brain Kortex.
Liefere ein JSON-Objekt:
- "title": prägnanter Titel (max. 80 Zeichen) für das eigentliche Thema.
- "summary": 1-2 Sätze: worum es ging und was dabei herauskam.
- "takeaways": 3-7 Key Takeaways: Erkenntnisse, Lösungen, wiederverwendbare Muster (je ein Satz, konkret, mit Namen von Tools/Befehlen).
- "decisions": getroffene Entscheidungen, je ein Satz (leer, wenn keine).
- "open_questions": offen gebliebene Fragen oder nächste Schritte, je als kurze Aufgabe formuliert (leer, wenn keine).
Sprache der Konversation, Standard Deutsch. Erfinde nichts, wiederhole nichts zwischen den Listen.`;

const TAKEAWAYS_PROMPT_EN = `You archive an AI conversation or an agent session in the Second Brain Kortex.
Deliver a JSON object:
- "title": concise title (max. 80 characters) for the actual topic.
- "summary": 1-2 sentences: what it was about and what came out of it.
- "takeaways": 3-7 key takeaways: insights, solutions, reusable patterns (one sentence each, concrete, with the names of tools/commands).
- "decisions": decisions that were made, one sentence each (empty when none).
- "open_questions": questions left open or next steps, each phrased as a short task (empty when none).
Language of the conversation, default English. Invent nothing, repeat nothing between the lists.`;

/** "detailed" (clipper setting, feedback C1): longer summary, more takeaways. */
export const takeawaysPrompt = (level: SummaryLevel = "concise"): string => {
  const detailed = level === "detailed";
  return byLocale({
    en: detailed
      ? TAKEAWAYS_PROMPT_EN.replace("1-2 sentences: what", "4-6 sentences: what").replace(
          "3-7 key takeaways",
          "6-10 key takeaways",
        )
      : TAKEAWAYS_PROMPT_EN,
    de: detailed
      ? TAKEAWAYS_PROMPT_DE.replace("1-2 Sätze: worum", "4-6 Sätze: worum").replace(
          "3-7 Key Takeaways",
          "6-10 Key Takeaways",
        )
      : TAKEAWAYS_PROMPT_DE,
  });
};

/** One line, cut at a word boundary. */
const shorten = (text: string, max: number): string => {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

const PLATFORM_LABEL: Record<ParsedChat["platform"], string | { phrase: ContentPhraseKey }> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  agent: { phrase: "agentMemory" },
  unknown: { phrase: "aiChat" },
};
const platformLabel = (platform: ParsedChat["platform"]): string => {
  const label = PLATFORM_LABEL[platform];
  return typeof label === "string" ? label : ph(label.phrase);
};

/** Name of the answering side in the dialog; all of them still parse back as `assistant`. */
const ASSISTANT_LABEL: Record<ParsedChat["platform"], string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  agent: "Assistant",
  unknown: "Assistant",
};

/**
 * Shifts the headings of embedded Markdown (an answer's "## Schritt 1", a memory's "## Decisions")
 * so the highest one lands on `minLevel` and the memory keeps one clean outline. Code fences are
 * left alone; levels stop at 6.
 */
export function demoteHeadings(md: string, minLevel: number): string {
  const lines = md.split("\n");
  let inFence = false;
  let top = 7;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence ? line.match(/^(#{1,6})\s/) : null;
    if (h?.[1]) top = Math.min(top, h[1].length);
  }
  const shift = top > 6 ? 0 : Math.max(0, minLevel - top);
  if (shift === 0) return md;
  inFence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/^(#{1,6})(\s)/, (_, h: string, s: string) =>
        `${"#".repeat(Math.min(6, h.length + shift))}${s}`,
      );
    })
    .join("\n");
}

type ChatSynthesis = z.infer<typeof ChatTakeawaysSchema>;

const list = (items: readonly string[] | undefined, prefix = "- "): string[] =>
  (items ?? []).map((i) => i.trim()).filter(Boolean).map((i) => `${prefix}${i}`);

/**
 * The AI-memory layout (feedback G3): title, summary, one facts line, the synthesis (takeaways,
 * decisions, open points as tasks), a question index, then the dialog in question/answer blocks.
 * Role headings stay `### Du` (English: `### You`) / `### ChatGPT|Claude|Assistant`, so the note
 * parses back as a chat (ROLE_HEADING accepts both languages).
 */
export function renderMemoryMarkdown(p: {
  chat: ParsedChat;
  title: string;
  synthesis: ChatSynthesis | null;
}): string {
  const { chat, synthesis } = p;
  const md: string[] = [`# ${p.title}`, ""];
  const summary = synthesis?.summary?.trim();
  if (summary) md.push(`> ${summary.replace(/\s*\n+\s*/g, " ")}`, "");

  const questions = chat.turns.filter((t) => t.role === "user");
  const agent = chat.frontmatter.agent_name ?? chat.frontmatter.agent;
  const facts = [
    `**${ph("source")}:** ${platformLabel(chat.platform)}`,
    agent ? `**Agent:** ${agent}` : null,
    chat.createdAt ? `**${ph("date")}:** ${chat.createdAt.slice(0, 10)}` : null,
    chat.turns.length
      ? `**${ph("chatLength")}:** ${chat.turns.length} ${ph("messages")}, ${questions.length} ${ph(questions.length === 1 ? "question" : "questions")}`
      : null,
  ].filter(Boolean);
  md.push(facts.join(" · "), "");

  const takeaways = list(synthesis?.takeaways);
  const decisions = list(synthesis?.decisions);
  const open = list(synthesis?.open_questions, "- [ ] ");
  if (takeaways.length) md.push(`## ${ph("keyTakeaways")}`, "", ...takeaways, "");
  if (decisions.length) md.push(`## ${ph("decisions")}`, "", ...decisions, "");
  if (open.length) md.push(`## ${ph("openPoints")}`, "", ...open, "");

  if (chat.format === "agent_memory") {
    // The memory's own H1 is replaced by ours; its sections sit below "## Inhalt".
    const body = (chat.body ?? "").replace(/^#\s+.+\n+/, "").trim();
    if (body) md.push(`## ${ph("content")}`, "", demoteHeadings(body, 3));
  } else {
    if (questions.length > 1) {
      md.push(
        `## ${ph("questionsOverview")}`,
        "",
        ...questions.map((q, i) => `${i + 1}. ${shorten(q.content, 110)}`),
        "",
      );
    }
    const blocks = chat.turns.map(
      (t) =>
        `### ${t.role === "user" ? ph("you") : ASSISTANT_LABEL[chat.platform]}\n\n${demoteHeadings(t.content, 4)}`,
    );
    // A rule before every question after the first separates the exchanges.
    const dialog = blocks
      .map((b, i) => (i > 0 && chat.turns[i]?.role === "user" ? `---\n\n${b}` : b))
      .join("\n\n");
    md.push(`## ${ph("dialog")}`, "", dialog);
  }
  return md
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createAiChatAdapter(options: AiChatAdapterOptions = {}): IngestionAdapter {
  return {
    id: ID,
    canHandle: (input: RawIngestInput) =>
      !input.url &&
      !input.fileBuffer &&
      !!input.rawText?.trim() &&
      (input.typeHint === "ai_chat" || looksLikeChat(input.rawText)),

    async extract(input: RawIngestInput): Promise<ExtractedPayload> {
      const chat = parseChat(input.rawText as string);
      const warnings: string[] = [];
      if (chat.skippedConversations > 0) {
        warnings.push(
          `export contains ${chat.skippedConversations + 1} conversations; only the first was imported`,
        );
      }
      const dialog = chat.turns
        .map((t) => `### ${t.role === "user" ? "User" : "Assistant"}\n\n${t.content}`)
        .join("\n\n");
      const source = chat.format === "agent_memory" ? (chat.body ?? "") : dialog;

      let synthesis: z.infer<typeof ChatTakeawaysSchema> | null = null;
      if (options.models && source.trim()) {
        try {
          const { output } = await generateText({
            model: modelFor(options.models, "summarize"),
            system: takeawaysPrompt(input.summaryLevel),
            prompt: source.slice(0, 60_000),
            output: Output.object({ schema: ChatTakeawaysSchema, name: "chat_takeaways" }),
            temperature: 0.2,
          });
          synthesis = output;
        } catch (err) {
          warnings.push(`takeaways failed: ${errorMessage(err)}`);
        }
      }

      const title =
        chat.title?.trim() ||
        synthesis?.title.trim() ||
        chat.turns[0]?.content.split("\n", 1)[0]?.slice(0, 80) ||
        ph("aiChat");
      const userTurns = chat.turns.filter((t) => t.role === "user").length;
      const contentMd = renderMemoryMarkdown({ chat, title, synthesis });

      // One chunk per question/answer pair keeps answers next to the question for RAG.
      const structuralChunks: StructuralChunk[] = [];
      if (synthesis?.takeaways.length)
        structuralChunks.push({ heading: ph("keyTakeaways"), text: synthesis.takeaways.join("\n") });
      let n = 0;
      for (let i = 0; i < chat.turns.length; i++) {
        const t = chat.turns[i] as ChatTurn;
        if (t.role !== "user") continue;
        const answer =
          chat.turns[i + 1]?.role === "assistant" ? chat.turns[i + 1]?.content : undefined;
        structuralChunks.push({
          heading: `${ph("questionN")} ${++n}: ${shorten(t.content, 60)}`,
          text: `User: ${t.content}${answer ? `\n\nAssistant: ${answer}` : ""}`,
        });
      }

      return {
        type: "ai_chat",
        sourcePlatform: chat.platform === "unknown" ? "ai_chat" : chat.platform,
        titleHint: title,
        contentMd,
        structuralChunks: structuralChunks.length ? structuralChunks : undefined,
        metadata: {
          chat_format: chat.format,
          platform: chat.platform,
          message_count: chat.turns.length,
          user_turns: userTurns,
          assistant_turns: chat.turns.length - userTurns,
          created_at: chat.createdAt ?? null,
          summary: synthesis?.summary?.trim() || null,
          takeaways: synthesis?.takeaways ?? [],
          decisions: synthesis?.decisions ?? [],
          open_questions: synthesis?.open_questions ?? [],
          agent_name: chat.frontmatter.agent_name ?? chat.frontmatter.agent ?? null,
          warnings: warnings.length ? warnings : undefined,
        },
      };
    },
  };
}
