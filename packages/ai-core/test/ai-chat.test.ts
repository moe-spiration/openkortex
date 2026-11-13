import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../src/adapters";
import {
  cleanMessage,
  createAiChatAdapter,
  demoteHeadings,
  looksLikeChat,
  parseChat,
  splitFrontmatter,
} from "../src/adapters/ai-chat.adapter";
import { createMemoryStorageGateway } from "../src/storage";
import { failingModel, mockModel, staticRouter, USER_ID } from "./helpers";
import { agentMemory, chatgptExport, claudeExport, extensionChat } from "./fixtures/ai-chat";

const takeaways = {
  title: "Supabase RLS & Service-Role",
  summary: "Warum RLS mit dem Service-Role-Key nicht greift und welcher Key wohin gehört.",
  takeaways: ["Der Service-Role-Key umgeht RLS.", "Im Client den Anon-Key nutzen."],
  decisions: ["Server-Queries filtern immer explizit nach user_id."],
  open_questions: ["RLS automatisiert testen"],
};

describe("parseChat", () => {
  it("reads the extension's ### User / ### Assistant Markdown and strips UI chrome", () => {
    const chat = parseChat(extensionChat);
    expect(chat.format).toBe("extension_md");
    expect(chat.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const answer = chat.turns[1]?.content ?? "";
    expect(answer.split("\n").filter((l) => l.trim() === "Copy code")).toEqual([]);
    expect(answer).not.toContain("ChatGPT can make mistakes");
    // Inside code fences nothing is removed.
    expect(answer).toContain(
      "```ts\n// Copy code\nconst supabase = createClient(url, anonKey);\n```",
    );
  });

  it("follows the active branch of a ChatGPT export and skips system/tool messages", () => {
    const chat = parseChat(JSON.stringify(chatgptExport));
    expect(chat).toMatchObject({
      format: "chatgpt_json",
      platform: "chatgpt",
      title: "RLS Debugging",
      skippedConversations: 1,
    });
    expect(chat.createdAt).toBe("2025-10-21T10:00:00.000Z");
    expect(chat.turns).toEqual([
      { role: "user", content: "Warum greift RLS nicht?" },
      { role: "assistant", content: "Der Service-Role-Key umgeht RLS." },
      { role: "user", content: "Danke!" },
      { role: "assistant", content: "Gern." },
    ]);
  });

  it("reads a Claude export", () => {
    const chat = parseChat(JSON.stringify(claudeExport));
    expect(chat).toMatchObject({
      format: "claude_json",
      platform: "claude",
      title: "Hybrid Search mit RRF",
    });
    expect(chat.turns.map((t) => t.content)).toEqual([
      "Wie kombiniere ich FTS und Vektoren?",
      "Mit Reciprocal Rank Fusion (k = 60).",
    ]);
  });

  it("treats Markdown without a dialog as an agent memory and reads its frontmatter", () => {
    const chat = parseChat(agentMemory);
    expect(chat).toMatchObject({
      format: "agent_memory",
      platform: "agent",
      title: "Kortex ai-core Session",
      turns: [],
    });
    expect(chat.frontmatter.agent_name).toBe("Claude Code");
    expect(chat.body).toContain("## Decisions");
    expect(splitFrontmatter("kein frontmatter").frontmatter).toEqual({});
  });

  it("detects chats for canHandle and cleans messages", () => {
    expect(looksLikeChat(extensionChat)).toBe(true);
    expect(looksLikeChat(JSON.stringify(claudeExport))).toBe(true);
    expect(looksLikeChat("### User\nnur eine Seite")).toBe(false);
    expect(looksLikeChat("# Notiz\nText")).toBe(false);
    expect(cleanMessage("Antwort\n\n\n\nKopieren\n2 / 3\nEnde")).toBe("Antwort\n\nEnde");
  });
});

describe("ai-chat adapter", () => {
  it("builds a clean dialog with key takeaways and one chunk per question", async () => {
    const fast = mockModel(takeaways);
    const adapter = createAiChatAdapter({ models: staticRouter({ fast }) });
    const input = { userId: USER_ID, rawText: extensionChat, typeHint: "ai_chat" as const };
    expect(adapter.canHandle(input)).toBe(true);
    const out = await adapter.extract(input);

    expect(out.type).toBe("ai_chat");
    expect(out.titleHint).toBe("Supabase RLS & Service-Role");
    expect(out.contentMd).toBe(
      [
        "# Supabase RLS & Service-Role",
        "",
        "> Warum RLS mit dem Service-Role-Key nicht greift und welcher Key wohin gehört.",
        "",
        "**Quelle:** KI-Chat · **Umfang:** 4 Nachrichten, 2 Fragen",
        "",
        "## Key Takeaways",
        "",
        "- Der Service-Role-Key umgeht RLS.",
        "- Im Client den Anon-Key nutzen.",
        "",
        "## Entscheidungen",
        "",
        "- Server-Queries filtern immer explizit nach user_id.",
        "",
        "## Offene Punkte",
        "",
        "- [ ] RLS automatisiert testen",
        "",
        "## Fragen im Überblick",
        "",
        "1. Warum greift meine RLS-Policy nicht, obwohl ich eingeloggt bin?",
        "2. Und auf dem Server?",
        "",
        "## Dialog",
        "",
        "### Du",
        "",
        "Warum greift meine RLS-Policy nicht, obwohl ich eingeloggt bin?",
        "",
        "### Assistant",
        "",
        "Weil der **Service-Role-Key** RLS umgeht. Nutze im Client den Anon-Key:",
        "",
        "```ts",
        "// Copy code",
        "const supabase = createClient(url, anonKey);",
        "```",
        "",
        "---",
        "",
        "### Du",
        "",
        "Und auf dem Server?",
        "",
        "### Assistant",
        "",
        "Dort den Service-Role-Key nur mit expliziten `user_id`-Filtern verwenden.",
      ].join("\n"),
    );
    expect(out.structuralChunks?.map((c) => c.heading)).toEqual([
      "Key Takeaways",
      "Frage 1: Warum greift meine RLS-Policy nicht, obwohl ich eingeloggt…",
      "Frage 2: Und auf dem Server?",
    ]);
    expect(out.structuralChunks?.[2]?.text).toBe(
      "User: Und auf dem Server?\n\nAssistant: Dort den Service-Role-Key nur mit expliziten `user_id`-Filtern verwenden.",
    );
    expect(out.metadata).toMatchObject({
      chat_format: "extension_md",
      message_count: 4,
      user_turns: 2,
      assistant_turns: 2,
      summary: takeaways.summary,
      takeaways: takeaways.takeaways,
      decisions: takeaways.decisions,
    });
  });

  it("keeps an agent memory's body, adds takeaways, and survives a failing model", async () => {
    const ok = await createAiChatAdapter({
      models: staticRouter({ fast: mockModel(takeaways) }),
    }).extract({ userId: USER_ID, rawText: agentMemory, typeHint: "ai_chat" });
    expect(ok.titleHint).toBe("Kortex ai-core Session");
    expect(ok.sourcePlatform).toBe("agent");
    expect(ok.contentMd).toContain("## Key Takeaways");
    expect(ok.contentMd).toContain(
      "**Quelle:** Agent-Memory · **Agent:** Claude Code · **Datum:** 2026-10-23",
    );
    // The memory body sits under "## Inhalt", its own sections one level down.
    expect(ok.contentMd).toContain("## Inhalt\n\n*Agent: Claude Code · 2026-10-23*");
    expect(ok.contentMd).toContain("### Decisions");
    expect(ok.contentMd.match(/^# /gm)).toHaveLength(1);
    expect(ok.metadata.agent_name).toBe("Claude Code");

    const broken = await createAiChatAdapter({
      models: staticRouter({ fast: failingModel() }),
    }).extract({ userId: USER_ID, rawText: JSON.stringify(chatgptExport) });
    expect(broken.titleHint).toBe("RLS Debugging");
    expect(broken.contentMd).toContain("## Dialog");
    expect(broken.metadata.warnings).toEqual([
      expect.stringContaining("2 conversations"),
      expect.stringContaining("takeaways failed"),
    ]);
  });

  it("wins over the text-note adapter in the default registry", () => {
    const registry = createDefaultRegistry({
      storage: createMemoryStorageGateway(),
      models: staticRouter({}),
    });
    expect(registry.resolve({ userId: USER_ID, rawText: extensionChat })?.id).toBe("ai-chat");
    expect(registry.resolve({ userId: USER_ID, rawText: "Notiz", typeHint: "ai_chat" })?.id).toBe(
      "ai-chat",
    );
    expect(registry.resolve({ userId: USER_ID, rawText: "Nur eine Notiz" })?.id).toBe("text-note");
  });
});

describe("AI memory layout (feedback G3)", () => {
  it("nests headings of answers below the role heading and leaves code alone", () => {
    expect(demoteHeadings("## Schritt 1\n\n```md\n# kein Heading\n```\n### Detail", 4)).toBe(
      "#### Schritt 1\n\n```md\n# kein Heading\n```\n##### Detail",
    );
    expect(demoteHeadings("Nur Text", 4)).toBe("Nur Text");
    expect(demoteHeadings("#### Schon tief", 4)).toBe("#### Schon tief");
  });

  it("parses a stored memory note back into the same dialog", async () => {
    const out = await createAiChatAdapter().extract({
      userId: USER_ID,
      rawText: JSON.stringify(claudeExport),
    });
    expect(out.contentMd).toContain("### Claude");
    const again = parseChat(out.contentMd);
    expect(again.format).toBe("extension_md");
    expect(again.turns).toEqual(parseChat(JSON.stringify(claudeExport)).turns);
  });
});
