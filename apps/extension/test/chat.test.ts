// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractAnswer, extractChat, findMessageElements } from "../src/lib/chat/extract";
import { CHATGPT, CLAUDE, detectPlatform } from "../src/lib/chat/selectors";

const load = (name: string) => {
  document.documentElement.innerHTML = readFileSync(resolve(process.cwd(), "test/fixtures", name), "utf8");
  return document;
};

describe("detectPlatform", () => {
  it("maps hosts to platforms", () => {
    expect(detectPlatform("chatgpt.com")).toBe(CHATGPT);
    expect(detectPlatform("chat.openai.com")).toBe(CHATGPT);
    expect(detectPlatform("claude.ai")).toBe(CLAUDE);
    expect(detectPlatform("www.claude.ai")).toBe(CLAUDE);
    expect(detectPlatform("example.com")).toBeNull();
    expect(detectPlatform("notclaude.ai")).toBeNull();
  });
});

describe("ChatGPT fixture", () => {
  it("finds messages with roles in order", () => {
    const doc = load("chatgpt.html");
    expect(findMessageElements(doc, CHATGPT).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("exports a clean transcript", () => {
    const chat = extractChat(load("chatgpt.html"), CHATGPT);
    expect(chat.title).toBe("RAG und Chunking");
    expect(chat.messages).toHaveLength(4);
    expect(chat.content_md).toBe(
      [
        "### User",
        "",
        "Wie chunke ich lange PDFs für ein RAG-System, ohne Kontext zu verlieren?",
        "",
        "### Assistant",
        "",
        "##### Contextual Retrieval",
        "",
        "Nutze **Contextual Retrieval**: Stelle jedem Chunk einen kurzen Kontext voran.",
        "",
        "- Kombiniere mit `BM25`",
        "- Nutze einen Reranker",
        "",
        "```python",
        "def chunk(doc):",
        '    return doc.split("\\n\\n")',
        "```",
        "",
        "Siehe [das Paper](https://example.com/paper) und die Formel $x^2$.",
        "",
        "| Größe | Overlap |",
        "| --- | --- |",
        "| 300 | 10 % |",
        "",
        "### User",
        "",
        "Und wie wähle ich die Chunk-Größe?",
        "",
        "### Assistant",
        "",
        "Starte bei 300 bis 500 Tokens mit etwa 10 Prozent Overlap.",
      ].join("\n"),
    );
    expect(chat.content_md).not.toMatch(/Copy/);
  });

  it("exports a single answer together with its question", () => {
    const doc = load("chatgpt.html");
    const answers = findMessageElements(doc, CHATGPT).filter((m) => m.role === "assistant");
    const one = extractAnswer(doc, CHATGPT, answers[1]!.el)!;
    expect(one.title).toBe("Und wie wähle ich die Chunk-Größe?");
    expect(one.content_md).toBe(
      "### User\n\nUnd wie wähle ich die Chunk-Größe?\n\n### Assistant\n\nStarte bei 300 bis 500 Tokens mit etwa 10 Prozent Overlap.",
    );
    expect(one.messages).toHaveLength(2);
  });

  it("returns null for an element that is not an answer", () => {
    const doc = load("chatgpt.html");
    expect(extractAnswer(doc, CHATGPT, doc.body)).toBeNull();
    const user = findMessageElements(doc, CHATGPT)[0]!;
    expect(extractAnswer(doc, CHATGPT, user.el)).toBeNull();
  });
});

describe("Claude fixture", () => {
  it("finds messages, collapsing nested matches", () => {
    const doc = load("claude.html");
    expect(findMessageElements(doc, CLAUDE).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("exports a clean transcript without the action bar", () => {
    const chat = extractChat(load("claude.html"), CLAUDE);
    expect(chat.title).toBe("RAG und Chunking");
    expect(chat.content_md).toBe(
      [
        "### User",
        "",
        "Wie chunke ich lange PDFs für ein RAG-System?",
        "",
        "### Assistant",
        "",
        "Nutze *Contextual Retrieval* und respektiere **Kapitelgrenzen**.",
        "",
        "1. Chunks bilden",
        "2. Kontext voranstellen",
        "",
        "```ts",
        "const n: number = 3;",
        "console.log(n);",
        "```",
        "",
        "#### Fazit",
        "",
        "Messen statt raten.",
        "",
        "### User",
        "",
        "Danke!",
        "",
        "### Assistant",
        "",
        "Gern geschehen.",
      ].join("\n"),
    );
    expect(chat.content_md).not.toMatch(/Retry|Copy/);
  });

  it("falls back to the first question when the page title is generic", () => {
    const doc = load("claude.html");
    doc.title = "Claude";
    expect(extractChat(doc, CLAUDE).title).toBe("Wie chunke ich lange PDFs für ein RAG-System?");
  });

  it("copes with an empty page", () => {
    document.documentElement.innerHTML = "<head><title>Claude</title></head><body></body>";
    const chat = extractChat(document, CLAUDE);
    expect(chat.messages).toEqual([]);
    expect(chat.content_md).toBe("");
    expect(chat.title).toBe("Claude Chat");
  });
});
