import { detectIntent } from "@kortex/db/orbit";
import { t } from "@/i18n";
import type { DIconId } from "@/components/icons";

/*
 * Alt+Space launcher logic (pure, tested in test/launcher.test.ts). One overlay, the first character
 * picks the mode:
 *   >text  prompt catalog (type `prompt`, 40_AI_Memories/Prompts): fill {{variables}}, paste into the previous app
 *   ?text  vault search (GET /api/search): Enter opens the item
 *   text   capture (Notiz / Inbox / Aufgabe) or "Fragen" (short copilot answer)
 */

export type LauncherMode = "capture" | "prompt" | "find";

export interface LauncherInput {
  mode: LauncherMode;
  /** Text after the prefix, trimmed (capture: the whole text, untrimmed at the end). */
  query: string;
}

export function parseLauncherInput(text: string): LauncherInput {
  const lead = text.trimStart();
  if (lead.startsWith(">")) return { mode: "prompt", query: lead.slice(1).trim() };
  if (lead.startsWith("?")) return { mode: "find", query: lead.slice(1).trim() };
  return { mode: "capture", query: text };
}

/**
 * Festhalten/Fragen follows the text like the web Orbit-Bar (detectIntent from @kortex/db): a question
 * selects "Fragen" (row `ask`), anything else goes back to the last capture target. Rows after `ask`
 * (search, prompts, selection) and an empty field keep the selection. Not called once the user picked
 * the mode (segment, Tab, chip, arrow keys).
 */
export function autoSelect(text: string, sel: number, lastTarget: number, ask: number): number {
  if (sel > ask) return sel;
  const intent = detectIntent(text);
  if (!intent) return sel;
  if (intent.mode === "ask") return ask;
  return sel === ask ? lastTarget : sel;
}

/** Same placeholder syntax as the extension's prompt saver (apps/extension/src/lib/prompts.ts). */
const VAR_RE = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;

/** Unique variable names in order of first appearance. */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) seen.add(m[1]!);
  return [...seen].slice(0, 50);
}

/** Replaces every `{{name}}` with its value; empty values keep the placeholder. */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (whole, name: string) =>
    values[name]?.trim() ? values[name]! : whole,
  );
}

/** Variables still without a value. */
export const missingVariables = (vars: readonly string[], values: Record<string, string>) =>
  vars.filter((v) => !values[v]?.trim());

/** One hit of GET /api/search (apps/web/src/server/search/handler.ts). */
export interface SearchHit {
  item_id: string;
  title: string;
  type: string;
  folder_path: string | null;
  source_url: string | null;
  tags: string[];
  snippet: string;
  page_or_timestamp: string | null;
  score: number | null;
  content_md?: string;
}

export interface SearchResponse {
  ok: true;
  query: string;
  mode: "hybrid" | "text" | "recent";
  results: SearchHit[];
}

/** A prompt of the catalog, ready to fill. */
export interface LauncherPrompt {
  id: string;
  title: string;
  text: string;
  variables: string[];
}

/** Prompt items carry their Markdown in content_md; the title stays as the catalog shows it. */
export function toPrompt(hit: SearchHit): LauncherPrompt {
  const text = (hit.content_md ?? hit.snippet).trim();
  return { id: hit.item_id, title: hit.title, text, variables: extractVariables(text) };
}

/** Lucide-line glyph per item type (desktop icon set), file as the fallback. */
export function typeIcon(type: string): DIconId {
  switch (type) {
    case "meeting":
      return "cal";
    case "ai_chat":
    case "prompt":
      return "sparkles";
    case "task":
      return "task";
    case "voice_memo":
    case "podcast":
      return "mic";
    case "bookmark":
    case "article":
    case "youtube":
      return "up-right";
    default:
      return "file";
  }
}

/** Title of a selection capture: "Selection from <window>". */
export function selectionTitle(source: string | null | undefined): string | undefined {
  const s = source?.trim();
  return s ? t("Selection from {source}", { source: s }).slice(0, 200) : undefined;
}

/** Single line preview of a long text (prompt preview, answers). */
export function oneLine(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Debounce for search-as-you-type (ms): one request per typing pause. */
export const SEARCH_DEBOUNCE_MS = 220;
