// System prompt for the Autonomous Organizer (spec 04, section 5.1), extended with
// the existing domain objects so entities can be linked to them.
// Placeholders: {{EXISTING_CLUSTERS}}, {{EXISTING_TAGS}}, {{EXISTING_OBJECTS}},
// {{MANUAL_PLACEMENT}}, {{DEFAULT_LANGUAGE}}, {{SUMMARY_RULE}}, {{KEY_POINTS_COUNT}}.
// With a routing guide (agents.md, feedback G6b) a short "Vault routing guide" block goes in
// before the closing line; without one the prompt is unchanged.

import { typeSuggestionGuide } from "@kortex/db";
import { byLocale } from "../i18n";
import type { SummaryLevel } from "../adapters/base-adapter";

export const ORGANIZER_SYSTEM_PROMPT = `You are the autonomous knowledge architect of Kortex, an AI-native Second Brain.

Analyze the incoming content and return a strict JSON object matching the Zod EnrichmentSchema:

1. "title": A clear, concise, high-signal title (max 80 chars, in the language of the content, default {{DEFAULT_LANGUAGE}}).

2. "summary": {{SUMMARY_RULE}} Write it in the language of the content, default {{DEFAULT_LANGUAGE}}.

3. "cluster_name": Assign to the best fitting existing cluster from {{EXISTING_CLUSTERS}}, or propose a clean new cluster name only if none fits.

4. "suggested_folder_path": Choose the appropriate default vault folder ("10_Notes", "20_Meetings", "30_Clippings", "40_AI_Memories", "50_Recipes", "60_Documents", "70_Objects/...", "90_Digests") unless manual placement is active. Manual placement active: {{MANUAL_PLACEMENT}}. If it is active, return null for "suggested_folder_path" and "cluster_name".

5. "tags": Array of 2 to 5 hierarchical lowercase tags (e.g., "automotive/transformation", "ai/mcp", "rezepte/low-carb", "fitness/hyrox") that describe THIS content's main topics. Reuse a tag from {{EXISTING_TAGS}} only when it genuinely describes this content (same topic, not just a loose association) to prevent taxonomy sprawl; otherwise create a new, specific tag. Always return at least 2 tags.

6. "entities": Array of key named entities (people, companies, frameworks, products, books) mentioned in the text for the Knowledge Graph. Each entity: { "name": string, "type": "person" | "project" | "organization" | "concept" | "tool" | "asset" | "goal" | "other" }. When an entity matches one of the existing objects below, use exactly that object's title as "name" so it can be linked as a [[Wiki-Link]].
Existing objects (type: title): {{EXISTING_OBJECTS}}

7. "action_items": Array of concrete tasks or follow-ups detected in the content. Each item:

   { "title": string, "description": string | null, "assignee": string, "priority": "low"|"medium"|"high"|"urgent", "due_date": ISO-8601 string or null, "source_timestamp_sec": number or null, "project": string | null, "timeframe": "today"|"this_week"|"later"|"YYYY-MM-DD"|null, "context": string | null }.
   Use "Me" as assignee when the task is for the owner of this Second Brain. Return an empty array when there are no real tasks; never invent tasks.
   "project": the exact title of an existing project or goal object listed under "Existing objects" that the task belongs to, otherwise null; never invent a project. "timeframe": when the task should happen if the content says so ("today", "this_week", "later" or a concrete ISO day), otherwise null. "context": one short sentence in the language of the content on why the task exists or where it comes from, otherwise null.

8. "placement_confidence": A number from 0 to 1: how sure you are that "suggested_folder_path", "tags" and the item type fit this content. Use 0.7 or more only when the content clearly belongs there; use less when the topic is ambiguous, the content is very short, or you had to guess. Return null when manual placement is active.

9. "key_points": For content type "article", "pdf" or "epub": {{KEY_POINTS_COUNT}} short key points (one sentence each: the most important facts, arguments or takeaways), in the language of the content, default {{DEFAULT_LANGUAGE}}. For every other content type return an empty array.

10. "suggested_type": Only when the content type is "note", "article" or "bookmark" and it clearly IS one of these items, else null: {{TYPE_GUIDE}}. If you tagged the content with a type word (e.g. "buch", "film"), the type must agree with the tag. A page that merely discusses the topic (a review essay, a news article) stays null. "type_confidence": a number from 0 to 1 for "suggested_type" alone (independent of the folder, which may not exist yet); below 0.7 the suggestion is ignored. Return null when "suggested_type" is null.

11. "mentions": Only for content type "video" or "podcast": books and tools the speakers explicitly recommend or discuss at length (max 8): { "name": exact title or product name, "kind": "book" | "tool" }. For a tool that matches an existing object above use exactly that object's title. Otherwise an empty array.

Return only the JSON object.`;

/** Default output language of a German account (the original); `defaultOutputLanguage()` follows the user. */
export const DEFAULT_OUTPUT_LANGUAGE = "German";

/** Language the organizer writes in when the content itself does not decide: the user's language. */
export const defaultOutputLanguage = (): string => byLocale({ en: "English", de: DEFAULT_OUTPUT_LANGUAGE });

/** Summary length per level (feedback C1). "concise" is the original TL;DR wording. */
export const SUMMARY_RULES: Record<SummaryLevel, { summary: string; keyPoints: string }> = {
  concise: {
    summary:
      "A 2-3 sentence executive summary (TL;DR) capturing the core insight, decision, or utility.",
    keyPoints: "3 to 7",
  },
  detailed: {
    summary:
      "A detailed summary of 5-8 sentences (one or two short paragraphs, plain text): the main argument or story, the most important facts, figures and examples, and the conclusion or practical use.",
    keyPoints: "6 to 10",
  },
};

export interface OrganizerPromptVars {
  existingClusters: readonly string[];
  existingTags: readonly string[];
  existingObjects: ReadonlyArray<{ type: string; title: string }>;
  manualPlacement: boolean;
  defaultLanguage?: string;
  /** Default "concise". */
  summaryLevel?: SummaryLevel;
  /** Routing part of agents.md (see `routingGuideFromAgentsGuide`). Omitted: no guide block. */
  routingGuide?: string;
}

/** Upper bound for the guide block, so it never crowds out the content. */
export const MAX_ROUTING_GUIDE_CHARS = 6_000;

/** `## ` sections of agents.md the organizer needs: where things live and the routing rules. */
export const ROUTING_GUIDE_SECTIONS = ["Vault structure", "Routing rules", "Domain objects"];

/**
 * Cuts the routing sections (ROUTING_GUIDE_SECTIONS, matched by heading prefix) out of the full
 * agents guide (`renderAgentsGuide()` in @kortex/mcp-server). The organizer prompt then carries
 * folders, routing rules and object folders, but not tools, frontmatter or access paths.
 * Returns "" when none of the sections is found.
 */
export function routingGuideFromAgentsGuide(guideMd: string): string {
  return guideMd
    .split(/^(?=## )/m)
    .filter((s) => ROUTING_GUIDE_SECTIONS.some((h) => s.startsWith(`## ${h}`)))
    .map((s) => s.trim())
    .join("\n\n")
    .slice(0, MAX_ROUTING_GUIDE_CHARS)
    .trim();
}

const ROUTING_GUIDE_INTRO = `Vault routing guide (the rules external agents follow too, from agents.md). Use it for "suggested_folder_path" and "tags": pick the folder whose description fits the content, file domain objects (person, project, organization, concept, tool, asset, goal) in their "70_Objects/<Type>" folder, and never move manually placed items. Lines about MCP tools are for external agents; only the folder and tag rules apply to you.`;

const renderRoutingGuide = (guide: string | undefined): string => {
  const g = guide?.trim().slice(0, MAX_ROUTING_GUIDE_CHARS).trim();
  return g ? `${ROUTING_GUIDE_INTRO}\n<routing_guide>\n${g}\n</routing_guide>\n\n` : "";
};

const list = (values: readonly string[], max: number): string =>
  values.length === 0 ? "[] (none yet)" : JSON.stringify(values.slice(0, max));

export function renderOrganizerPrompt(vars: OrganizerPromptVars): string {
  const objects =
    vars.existingObjects.length === 0
      ? "(none yet)"
      : vars.existingObjects
          .slice(0, 300)
          .map((o) => `${o.type}: ${o.title}`)
          .join("; ");
  return ORGANIZER_SYSTEM_PROMPT.replaceAll(
    "{{EXISTING_CLUSTERS}}",
    list(vars.existingClusters, 100),
  )
    .replaceAll("{{EXISTING_TAGS}}", list(vars.existingTags, 300))
    .replaceAll("{{EXISTING_OBJECTS}}", objects)
    .replaceAll("{{TYPE_GUIDE}}", typeSuggestionGuide())
    .replaceAll("{{MANUAL_PLACEMENT}}", vars.manualPlacement ? "yes" : "no")
    .replaceAll("{{SUMMARY_RULE}}", SUMMARY_RULES[vars.summaryLevel ?? "concise"].summary)
    .replaceAll("{{KEY_POINTS_COUNT}}", SUMMARY_RULES[vars.summaryLevel ?? "concise"].keyPoints)
    .replaceAll("{{DEFAULT_LANGUAGE}}", vars.defaultLanguage ?? defaultOutputLanguage())
    .replace(
      "Return only the JSON object.",
      () => `${renderRoutingGuide(vars.routingGuide)}Return only the JSON object.`,
    );
}

export const renderOrganizerUserMessage = (p: {
  type: string;
  sourcePlatform: string;
  titleHint?: string;
  sourceUrl?: string;
  outline?: readonly string[];
  content: string;
  truncated: boolean;
}): string =>
  [
    `Content type: ${p.type}`,
    `Source: ${p.sourcePlatform}${p.sourceUrl ? ` (${p.sourceUrl})` : ""}`,
    p.titleHint ? `Title hint: ${p.titleHint}` : null,
    p.outline && p.outline.length > 0 ? `Outline:\n- ${p.outline.join("\n- ")}` : null,
    `Content${p.truncated ? " (truncated)" : ""}:`,
    "<content>",
    p.content,
    "</content>",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
