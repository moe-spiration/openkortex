/*
 * Agent copilot on the phone (docs/agent-copilot.md): the same /api/chat agent as the web Orbit-Bar.
 * Shapes mirror apps/web/src/server/chat/agent.ts; pure, so vitest covers it.
 */

export const AUTONOMY = ["read", "ask", "self"] as const;
export type Autonomy = (typeof AUTONOMY)[number];

export const SKILLS = ["briefing", "research", "tidy", "draft", "week", "dossier"] as const;
export type Skill = (typeof SKILLS)[number];

/** Slash words per skill, English and German like the web commands (orbit.ts). */
const SKILL_WORDS: Record<Skill, string[]> = {
  briefing: ["briefing"],
  research: ["research", "recherche"],
  tidy: ["tidy", "aufräumen", "aufraeumen"],
  draft: ["draft", "entwurf"],
  week: ["week", "woche"],
  dossier: ["dossier", "akte"],
};

/** "/akte Jonas Weber" → skill dossier. The text is sent as typed (the web sends "/cmd arg" too). */
export function skillOf(text: string): Skill | undefined {
  const m = /^\/(\S+)/.exec(text.trim());
  if (!m) return undefined;
  const word = m[1]!.toLowerCase();
  return SKILLS.find((s) => SKILL_WORDS[s].includes(word));
}

/** An action the agent proposes or made; passed back to the server unchanged. */
export type AgentAction = { kind: "note_create" | "note_edit" | "dossier_update" | "task_create" } & Record<string, unknown>;
export type AgentUndo = { kind: "note_create" | "note_edit" | "task_create" } & Record<string, unknown>;

export interface AgentStep {
  kind: "search" | "read" | "write";
  label: string;
  count?: number;
}
export interface AgentProposal {
  actions: AgentAction[];
  labels: string[];
}
export interface AgentResult {
  ok: boolean;
  label: string;
  item_id?: string;
  error?: string;
  undo?: AgentUndo;
}

/** What can be taken back from a list of results. */
export const undoOf = (results: readonly AgentResult[]): AgentUndo[] => results.filter((r) => r.ok && r.undo).map((r) => r.undo!);

/** Short line for one step: "Gesucht: Hyrox · 4". */
export const stepLine = (s: AgentStep) => (s.count !== undefined ? `${s.label} · ${s.count}` : s.label);
