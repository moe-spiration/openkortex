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
  week: ["week", "woche", "wochenrückblick", "wochenrueckblick"],
  dossier: ["dossier", "akte"],
};

const findSkill = (word: string) => SKILLS.find((s) => SKILL_WORDS[s].includes(word.toLowerCase()));

/**
 * "/akte Jonas Weber" → skill dossier. The text is sent as typed (the web sends "/cmd arg" too).
 * Spoken, there is no slash: a skill word at the start counts when a short link word follows
 * ("Briefing für Jonas", "Recherche zu Hyrox", "Akte von Jonas") or when it stands alone ("Wochenrückblick").
 */
export function skillOf(text: string): Skill | undefined {
  const v = text.trim();
  const slash = /^\/(\S+)/.exec(v);
  if (slash) return findSkill(slash[1]!);
  const spoken = /^([\p{L}]+)[.,:!?]*(?:\s+(zu|zum|zur|für|fuer|über|ueber|von|mit|an|for|on|about|with|to)\b|\s*$)/iu.exec(v);
  return spoken ? findSkill(spoken[1]!) : undefined;
}

/** Fillers a transcript may start with ("Hey Kortex,", "Ähm, okay"). */
const SPOKEN_FILLER = /^(?:(?:hey|hallo|hi|okay|ok|also|ähm|äh|ehm|hmm?)(?=[\s,.!])[\s,.!]*)*(?:kortex[,.!:]\s*)?/i;
/** A spoken slash: "Slash Briefing …", "Schrägstrich Akte …". */
const SPOKEN_SLASH = /^(?:slash|schrägstrich|schraegstrich)\s+(\S+?)[.,:;!?]*(?=\s|$)/i;

/**
 * A transcript as a question for the agent: one line, no leading fillers, a spoken slash command
 * as the real one ("Slash Briefing Jonas" → "/briefing Jonas"). Everything else stays as spoken.
 */
export function cleanSpoken(text: string): string {
  let v = text.replace(/\s+/g, " ").trim();
  const rest = v.replace(SPOKEN_FILLER, "");
  if (rest.trim()) v = rest.trim();
  const slash = SPOKEN_SLASH.exec(v);
  if (slash) v = `/${slash[1]!.toLowerCase()}${v.slice(slash[0].length)}`;
  return v.charAt(0).toUpperCase() + v.slice(1);
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
