// Prompt-Saver: eigene Prompts als Item `type: "prompt"` (Registry: 40_AI_Memories/Prompts) ablegen
// und `{{variablen}}` darin erkennen bzw. ausfüllen.
import { clientInfo, type NoteRequest } from "./api";
import { EXTENSION_VERSION, newIdempotencyKey } from "./requests";

export const PROMPT_FOLDER = "40_AI_Memories/Prompts";
const VAR_RE = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;

/** Eindeutige Variablennamen in Reihenfolge des ersten Auftretens. */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) seen.add(m[1]!);
  return [...seen].slice(0, 50);
}

/** Ersetzt jede `{{name}}` durch den Wert; fehlende/leere Werte bleiben als Platzhalter stehen. */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (whole, name: string) => (values[name]?.trim() ? values[name]! : whole));
}

export function promptTitle(text: string, max = 70): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const clean = line.replace(/^[#>*\-\s]+/, "").replace(/[`*_[\]]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "Prompt";
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function buildPrompt(text: string, now = new Date(), title?: string): NoteRequest {
  const body = text.trim();
  const variables = extractVariables(body);
  return {
    kind: "note",
    client: clientInfo(EXTENSION_VERSION),
    captured_at: now.toISOString(),
    idempotency_key: newIdempotencyKey(),
    title: title?.trim() || promptTitle(body),
    content_md: body,
    folder_path: PROMPT_FOLDER,
    type_hint: "prompt",
    tags: ["ai/prompt"],
    metadata: variables.length ? { variables } : {},
  };
}
