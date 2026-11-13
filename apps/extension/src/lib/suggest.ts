// Local, offline hints for the clipper: which hashtags to propose and where zero-setup routing
// would put the page. The server stays authoritative; these are only pre-selections.
import type { KnowledgeItemType } from "@kortex/db";
import { t } from "../i18n";

const TAG_RULES: readonly [RegExp, string][] = [
  [/\b(mcp|model context protocol)\b/i, "ai/mcp"],
  [/\b(rag|retrieval|embedding|vector|chunk\w*)\b/i, "ai/rag"],
  [/\b(agent\w*|llm|gpt|claude|gemini|prompt\w*|openai|anthropic|machine learning|ai)\b/i, "ai/agents"],
  [/\b(strategy|strategie|mba|leadership|führung|business model)\b/i, "strategy/mba"],
  [/\b(automotive|oem|fahrzeug|sdv|vehicle)\b/i, "automotive/it"],
  [/\b(cloud|kubernetes|aws|azure|devops)\b/i, "cloud/infra"],
  [/\b(hyrox|fitness|training|workout|mobility)\b/i, "fitness/hyrox"],
  [/\b(rezept\w*|recipe\w*|high.protein|low.carb)\b/i, "rezepte/low-carb"],
  [/\b(real.estate|immobilie\w*|invest\w*|etf|aktien)\b/i, "finance/invest"],
];

export interface SuggestInput {
  title: string;
  description?: string | null;
  keywords?: readonly string[];
  domain?: string;
}

/** Up to `max` distinct hashtags (without #), most specific rule order first. */
export function suggestTags(input: SuggestInput, max = 3): string[] {
  const hay = [input.title, input.description ?? "", ...(input.keywords ?? []), input.domain ?? ""].join(" \n ");
  const out: string[] = [];
  for (const [re, tag] of TAG_RULES) {
    if (re.test(hay) && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

export interface PageKind {
  type: KnowledgeItemType;
  /** Human label of the space the AI organizer would use ("dem Space Artikel und Web"). */
  space: string;
}

export function detectKind(url: string): PageKind {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep empty */
  }
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(host)) return { type: "video", space: t("Videos and media") };
  if (/(^|\.)(open\.spotify\.com|podcasts\.apple\.com)$/.test(host)) return { type: "podcast", space: t("Podcasts") };
  if (/(^|\.)(instagram\.com|x\.com|twitter\.com|linkedin\.com|tiktok\.com)$/.test(host)) return { type: "social", space: t("Social") };
  if (/\.pdf($|\?)/i.test(url)) return { type: "pdf", space: t("Documents") };
  return { type: "article", space: t("Articles and web") };
}

export function normalizeUserTag(input: string): string | null {
  const t = input.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/^\/+|\/+$/g, "");
  return /^[\p{L}\p{N}_\-/]{1,64}$/u.test(t) ? t : null;
}

/**
 * The clipper's hashtag pre-selection: the user's default tags (on), then the suggestions, of
 * which the first two come pre-selected. Shared by the form and Autosave so both send the same.
 */
export function tagOptions(
  page: { title: string; description?: string | null; keywords?: readonly string[]; domain?: string },
  defaultTags: readonly string[],
  suggestions?: readonly string[],
): { tag: string; on: boolean }[] {
  const suggested = suggestions ?? suggestTags({ title: page.title, description: page.description, keywords: page.keywords, domain: page.domain });
  const defaults = defaultTags.filter((t) => !suggested.includes(t));
  return [...defaults.map((tag) => ({ tag, on: true })), ...suggested.map((tag, i) => ({ tag, on: i < 2 }))];
}
