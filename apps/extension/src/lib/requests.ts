import { AI_MEMORIES_FOLDER, clientInfo, type AiChatRequest, type ChatPlatform, type HighlightLocator, type HighlightRequest, type WebClipRequest } from "./api";
import type { PageMeta } from "./page-meta";
import type { ExtensionSettings, SummaryLevel } from "./settings";
import { detectKind, tagOptions } from "./suggest";

/** The manifest is the single source of the version; tests and the preview server have no extension runtime. */
export const EXTENSION_VERSION: string = (globalThis as { chrome?: typeof chrome }).chrome?.runtime?.getManifest?.().version ?? "0.0.0";

/** One key per capture: the outbox re-sends the stored request, so every retry carries the same key. */
export const newIdempotencyKey = () => crypto.randomUUID();

const stamp = (now: Date) => ({
  client: clientInfo(EXTENSION_VERSION),
  captured_at: now.toISOString(),
  idempotency_key: newIdempotencyKey(),
});

export interface ClipChoice {
  /** null = zero-setup auto-routing */
  folder: string | null;
  tags: string[];
  note: string;
  /** The cover the user kept: a URL, null for none; undefined = the page's first candidate. */
  image?: string | null;
  /** Detail of the auto-summary (C1); omitted = server default. */
  summaryLevel?: SummaryLevel;
}

/**
 * What the clipper form would send untouched (C2 Autosave): the default route, the pre-selected
 * hashtags, no note, the page's first cover and the saved summary level.
 */
export function defaultClipChoice(
  page: PageMeta,
  settings: Pick<ExtensionSettings, "clipFolders" | "defaultTags" | "defaultRoute" | "summaryLevel">,
  suggestions?: string[],
): ClipChoice {
  const manual = settings.defaultRoute === "manual" && settings.clipFolders.length > 0;
  return {
    folder: manual ? (settings.clipFolders[0] ?? null) : null,
    tags: tagOptions(page, settings.defaultTags, suggestions).filter((o) => o.on).map((o) => o.tag),
    note: "",
    summaryLevel: settings.summaryLevel,
  };
}

export function buildWebClip(page: PageMeta, choice: ClipChoice, now = new Date()): WebClipRequest {
  const note = choice.note.trim();
  return {
    ...stamp(now),
    kind: "web_clip",
    url: page.url,
    title: page.title,
    description: page.description,
    image_url: choice.image === undefined ? page.image_url : choice.image,
    site_name: page.site_name,
    note: note || null,
    folder_path: choice.folder,
    tags: choice.tags,
    type_hint: detectKind(page.url).type,
    ...(page.transcript ? { transcript: page.transcript } : {}),
    ...(page.media ? { media: page.media } : {}),
    ...(choice.summaryLevel ? { summary_level: choice.summaryLevel } : {}),
  };
}

export function buildHighlight(
  page: { url: string; title: string },
  quote: string,
  locator: HighlightLocator,
  now = new Date(),
): HighlightRequest {
  return { ...stamp(now), kind: "highlight", url: page.url, page_title: page.title, quote_text: quote, locator, color: "yellow" };
}

export function buildAiChat(
  input: { platform: ChatPlatform; scope: "chat" | "answer"; url: string; title: string; content_md: string; message_count: number },
  now = new Date(),
  summaryLevel?: SummaryLevel,
): AiChatRequest {
  return {
    ...stamp(now),
    kind: "ai_chat",
    ...input,
    ...(summaryLevel ? { summary_level: summaryLevel } : {}),
    folder_path: AI_MEMORIES_FOLDER,
    tags: ["ai/agent-memory", `ai/${input.platform}`],
  };
}
