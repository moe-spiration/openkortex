// ALL site-specific DOM knowledge lives in this file. ChatGPT and Claude change their markup
// regularly; when an export breaks, this is the only module to touch (plus its fixture in test/).
// Each platform lists fallbacks in priority order and the code tolerates every one of them missing.
import type { ChatPlatform } from "../api";

export type ChatRole = "user" | "assistant";

export interface PlatformSpec {
  id: ChatPlatform;
  label: string;
  hosts: readonly string[];
  /** Every message element (user + assistant). Nested matches are collapsed to the outermost. */
  message: string;
  roleOf(el: Element): ChatRole | null;
  /** Element whose HTML is the message content. */
  bodyOf(el: Element): Element;
  /** Parent that receives the per-answer "Save to Kortex" button. */
  actionHost(el: Element): Element;
  /** Never exported (UI chrome inside a message). */
  exclude: string;
  /** Conversation title without the site suffix; null when the page only has the generic one. */
  titleOf(doc: Document): string | null;
  /** Present while a reply is still being generated: answers are only offered once it is gone. */
  streaming: string;
  /** The ever-present chat scroll area, observed for new messages. Falls back to <main>/<body>. */
  root: string;
}

const stripSuffix = (title: string, ...names: string[]) => {
  let t = title.trim();
  for (const n of names) t = t.replace(new RegExp(`\\s*[-–—|·]\\s*${n}$`, "i"), "").replace(new RegExp(`^${n}\\s*[-–—|·]\\s*`, "i"), "");
  return t.trim();
};

const nonGeneric = (title: string, ...generic: string[]) =>
  title && !generic.some((g) => g.toLowerCase() === title.toLowerCase()) ? title : null;

export const CHATGPT: PlatformSpec = {
  id: "chatgpt",
  label: "ChatGPT",
  hosts: ["chatgpt.com", "chat.openai.com"],
  message: "[data-message-author-role]",
  roleOf: (el) => {
    const r = el.getAttribute("data-message-author-role");
    return r === "user" || r === "assistant" ? r : null;
  },
  bodyOf: (el) => el.querySelector(".markdown, .whitespace-pre-wrap") ?? el,
  actionHost: (el) => el.closest('article, [data-testid^="conversation-turn"]') ?? el.parentElement ?? el,
  exclude: "button, [data-testid*='copy'], .sr-only, [data-kortex-ui]",
  titleOf: (doc) => nonGeneric(stripSuffix(doc.title, "ChatGPT"), "ChatGPT", "New chat", "Neuer Chat"),
  streaming: "button[data-testid=\"stop-button\"], button[aria-label=\"Stop streaming\"]",
  root: "main",
};

export const CLAUDE: PlatformSpec = {
  id: "claude",
  label: "Claude",
  hosts: ["claude.ai"],
  message:
    '[data-testid="user-message"], .font-user-message, [data-testid="assistant-message"], .font-claude-response, .font-claude-message',
  roleOf: (el) =>
    el.matches('[data-testid="user-message"], .font-user-message')
      ? "user"
      : el.matches('[data-testid="assistant-message"], .font-claude-response, .font-claude-message')
        ? "assistant"
        : null,
  bodyOf: (el) => el.querySelector(".standard-markdown, .grid-cols-1") ?? el,
  actionHost: (el) => el.parentElement ?? el,
  exclude: "button, [data-testid='action-bar'], .sr-only, [data-kortex-ui]",
  titleOf: (doc) => nonGeneric(stripSuffix(doc.title, "Claude"), "Claude", "New chat", "Neuer Chat"),
  streaming: "[data-is-streaming=\"true\"]",
  root: "main",
};

export const PLATFORMS: readonly PlatformSpec[] = [CHATGPT, CLAUDE];

export function detectPlatform(hostname: string): PlatformSpec | null {
  const h = hostname.toLowerCase();
  return PLATFORMS.find((p) => p.hosts.some((host) => h === host || h.endsWith(`.${host}`))) ?? null;
}
