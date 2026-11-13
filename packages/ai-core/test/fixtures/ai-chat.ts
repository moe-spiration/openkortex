// Chat exports: the extension's Markdown, ChatGPT conversations.json, Claude export, an agent memory.

export const extensionChat = `### User

Warum greift meine RLS-Policy nicht, obwohl ich eingeloggt bin?

### Assistant

Weil der **Service-Role-Key** RLS umgeht. Nutze im Client den Anon-Key:

\`\`\`ts
// Copy code
const supabase = createClient(url, anonKey);
\`\`\`

Copy code

ChatGPT can make mistakes. Check important info.

### User

Und auf dem Server?

### Assistant

Dort den Service-Role-Key nur mit expliziten \`user_id\`-Filtern verwenden.
`;

/** ChatGPT export with a regenerated answer (two branches); current_node picks the active one. */
export const chatgptExport = [
  {
    title: "RLS Debugging",
    create_time: 1761040800,
    current_node: "a2",
    mapping: {
      root: { parent: null, message: null },
      sys: {
        parent: "root",
        message: {
          author: { role: "system" },
          content: { content_type: "text", parts: [""] },
          metadata: { is_visually_hidden_from_conversation: true },
        },
      },
      u1: {
        parent: "sys",
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Warum greift RLS nicht?"] },
        },
      },
      a1old: {
        parent: "u1",
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Alte Antwort (verworfen)."] },
        },
      },
      a1: {
        parent: "u1",
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Der Service-Role-Key umgeht RLS."] },
        },
      },
      tool: {
        parent: "a1",
        message: {
          author: { role: "tool" },
          content: { content_type: "code", parts: ["print(1)"] },
        },
      },
      u2: {
        parent: "tool",
        message: { author: { role: "user" }, content: { content_type: "text", parts: ["Danke!"] } },
      },
      a2: {
        parent: "u2",
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Gern."] },
        },
      },
    },
  },
  { title: "Zweite Konversation", mapping: {} },
];

export const claudeExport = {
  uuid: "c1",
  name: "Hybrid Search mit RRF",
  created_at: "2026-10-20T09:00:00.000Z",
  chat_messages: [
    {
      sender: "human",
      text: "Wie kombiniere ich FTS und Vektoren?",
      content: [{ type: "text", text: "Wie kombiniere ich FTS und Vektoren?" }],
    },
    {
      sender: "assistant",
      text: "",
      content: [{ type: "text", text: "Mit Reciprocal Rank Fusion (k = 60)." }],
    },
  ],
};

export const agentMemory = `---
type: "ai_chat"
title: "Kortex ai-core Session"
agent_name: "Claude Code"
created_at: "2026-10-23"
cluster: "AI & Engineering"
---
# Kortex ai-core Session

*Agent: Claude Code · 2026-10-23*

Pluggable Ingestion gebaut, 110 Tests grün.

## Decisions

- data_collection: 'deny' per fetch-Wrapper erzwungen
`;
