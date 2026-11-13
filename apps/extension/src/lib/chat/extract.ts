import { htmlToMarkdown } from "../markdown";
import type { ChatRole, PlatformSpec } from "./selectors";

export interface ChatMessage {
  role: ChatRole;
  /** The message element in the live page (used to place the per-answer button). */
  el: Element;
  markdown: string;
}

export const ROLE_HEADING: Record<ChatRole, string> = { user: "### User", assistant: "### Assistant" };

/** Message elements in document order, nested matches collapsed to the outermost, roles resolved. */
export function findMessageElements(root: ParentNode, spec: PlatformSpec): { el: Element; role: ChatRole }[] {
  const all = [...root.querySelectorAll(spec.message)];
  const outer = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  const result: { el: Element; role: ChatRole }[] = [];
  for (const el of outer) {
    const role = spec.roleOf(el);
    if (role) result.push({ el, role });
  }
  return result;
}

/** Message body as Markdown with UI chrome removed and headings pushed below `### Role`. */
export function messageMarkdown(el: Element, spec: PlatformSpec): string {
  const clone = spec.bodyOf(el).cloneNode(true) as Element;
  for (const junk of clone.querySelectorAll(spec.exclude)) junk.remove();
  return htmlToMarkdown(clone.innerHTML, { headingOffset: 3 });
}

export function extractMessages(root: ParentNode, spec: PlatformSpec): ChatMessage[] {
  return findMessageElements(root, spec)
    .map(({ el, role }) => ({ el, role, markdown: messageMarkdown(el, spec) }))
    .filter((m) => m.markdown.length > 0);
}

export function toTranscript(messages: readonly Pick<ChatMessage, "role" | "markdown">[]): string {
  return messages.map((m) => `${ROLE_HEADING[m.role]}\n\n${m.markdown}`).join("\n\n");
}

const firstLine = (md: string, max = 70) => {
  const line = md.split("\n").find((l) => l.trim()) ?? "";
  const clean = line.replace(/^[#>*\-\s]+/, "").replace(/[`*_[\]]/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

export interface ExtractedChat {
  title: string;
  messages: ChatMessage[];
  content_md: string;
}

export function extractChat(doc: Document, spec: PlatformSpec): ExtractedChat {
  const messages = extractMessages(doc, spec);
  const firstUser = messages.find((m) => m.role === "user");
  const title = spec.titleOf(doc) ?? (firstUser ? firstLine(firstUser.markdown) : `${spec.label} Chat`);
  return { title: title || `${spec.label} Chat`, messages, content_md: toTranscript(messages) };
}

/** One assistant answer plus the question that led to it. Null when `answerEl` is not a known answer. */
export function extractAnswer(doc: Document, spec: PlatformSpec, answerEl: Element): ExtractedChat | null {
  const messages = extractMessages(doc, spec);
  const idx = messages.findIndex((m) => m.el === answerEl && m.role === "assistant");
  if (idx < 0) return null;
  const answer = messages[idx]!;
  const question = messages.slice(0, idx).reverse().find((m) => m.role === "user");
  const pair = question ? [question, answer] : [answer];
  return {
    title: question ? firstLine(question.markdown) : firstLine(answer.markdown),
    messages: pair,
    content_md: toTranscript(pair),
  };
}

/** One of the user's own messages on its own (prompt saver). Null when `el` is not a known user message. */
export function extractPrompt(doc: Document, spec: PlatformSpec, userEl: Element): { title: string; text: string } | null {
  const msg = extractMessages(doc, spec).find((m) => m.el === userEl && m.role === "user");
  return msg ? { title: firstLine(msg.markdown), text: msg.markdown } : null;
}
