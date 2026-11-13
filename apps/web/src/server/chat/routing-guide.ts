import { byLocale } from "@kortex/i18n";
import { renderAgentsGuide } from "@kortex/mcp-server/agents-guide";

/**
 * G6b: routing context for the copilot. When a question is about where something lives or where
 * to file it, the system prompt gets the relevant part of the agents guide (vault folders,
 * routing rules, domain objects), so the copilot names the real folder or object type instead of
 * guessing. Only these sections, only for such questions, rendered once per server process.
 */

/** Guide sections the copilot needs for "where is X" / "where do I put Y". */
export const ROUTING_SECTIONS = ["Vault structure", "Routing rules", "Domain objects"] as const;

const ROUTING_QUESTION = new RegExp(
  [
    // German: wo ist / wo finde / wo liegt / wo landet / wohin / wo soll|kann|muss ich
    String.raw`\bwo\s+(ist|sind|finde|liegt|liegen|landet|landen|steht|stehen|speicher|leg|soll|kann|muss|gehört|gehören)`,
    String.raw`\bwohin\b`,
    String.raw`\b(ablegen|ablage|abgelegt|einordnen|einsortieren|einräumen|zuordnen)\b`,
    String.raw`\b(lege|speichere|sortiere)\s+ich\b`,
    String.raw`\b(ordner|unterordner|ordnerstruktur|vault|objekttyp|objekt-typ)\b`,
    // English
    String.raw`\bwhere\s+(is|are|do|does|should|can|would|to)\b`,
    String.raw`\b(which|what)\s+folder\b`,
    String.raw`\b(file|store|save|put)\s+(it|this|that|them|a|an|my)\b`,
    String.raw`\b(folders?|object\s+type)\b`,
  ].join("|"),
  "iu",
);

/** True when the question is about where things live or how to file them. */
export function isRoutingQuestion(text: string): boolean {
  return ROUTING_QUESTION.test(text);
}

/** Picks the `## <title>` sections (title prefix match) out of a Markdown document. */
export function pickSections(markdown: string, titles: readonly string[]): string {
  const parts = markdown.split(/^(?=## )/m);
  return parts
    .filter((p) => titles.some((t) => p.startsWith(`## ${t}`)))
    .map((p) => p.trim())
    .join("\n\n");
}

let cached: string | null = null;

/** The routing excerpt of the agents guide (rendered once; it only depends on code constants). */
export function routingGuide(): string {
  cached ??= pickSections(renderAgentsGuide({ heading: false }), ROUTING_SECTIONS);
  return cached;
}

/** Prompt block appended for routing questions. */
export function routingContext(): string {
  return byLocale({
    en: `Filing knowledge (the real structure of the vault). For questions like "where is X" or "how do I file Y" you may use it in addition to the sources, without [n]:
- Name the concrete folder path (e.g. \`70_Objects/People\`) and, where it fits, the object type (e.g. \`person\`). Do not guess folders that are not listed here; the user's subfolders are allowed.
- If a source below contains the element in question, name its folder from the source list.
- Tool names such as \`brain_save_item\` are for external agents; explain filing to the user in terms of folders and object types. Unsure: into the Inbox, the AI organizer sorts it.

${routingGuide()}`,
    de: `Ablage-Wissen (die echte Struktur des Vaults). Für Fragen wie „wo ist X“ oder „wie lege ich Y ab“ darfst du es zusätzlich zu den Quellen nutzen, ohne [n]:
- Nenne den konkreten Ordnerpfad (z. B. \`70_Objects/People\`) und, wo es passt, den Objekttyp (z. B. \`person\`). Rate keine Ordner, die hier nicht stehen; Unterordner des Nutzers sind erlaubt.
- Wenn eine Quelle unten das gesuchte Element enthält, nenne ihren Ordner aus der Quellenliste.
- Tool-Namen wie \`brain_save_item\` gelten für externe Agenten; erkläre dem Nutzer die Ablage in Ordnern und Objekttypen. Unsicher: in die Inbox, der KI-Organizer sortiert ein.

${routingGuide()}`,
  });
}
