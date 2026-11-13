import { msg } from "@/i18n";
import type { IconId } from "@/components/shell/icons";
import type { CommandId } from "@/lib/shell/orbit";

/*
 * The agent's six skills as the pages show them (agent page tiles, Orbit-Bar skill menu): name, one line of
 * what it does, glyph and tint. Texts are English sources (`msg`), shown with `t(...)`. What a skill does on
 * the server is in server/chat/agent.ts (SKILL_PROMPTS).
 */

export type SkillId = "briefing" | "research" | "tidy" | "draft" | "week" | "dossier";

export interface AgentSkillInfo {
  id: SkillId;
  /** The slash command that starts it in the Orbit-Bar. */
  command: CommandId;
  icon: IconId;
  /** Tint of the glyph tile. */
  tint: string;
  label: string;
  help: string;
  /** Asked for when the skill needs a subject; skills without it start at once. */
  ask?: string;
  /** The request of a skill that needs no subject. */
  prompt?: string;
}

export const AGENT_SKILL_INFO: readonly AgentSkillInfo[] = [
  { id: "briefing", command: "briefing", icon: "o-person", tint: "#60A5FA", label: msg("Briefing"), help: msg("Prepares you for a conversation: dossier, meetings, open points."), ask: msg("Who or what is the briefing about?") },
  { id: "research", command: "recherche", icon: "globe", tint: "#F472B6", label: msg("Research"), help: msg("Searches your vault, compares and writes a report with sources."), ask: msg("Which topic should I research?") },
  { id: "tidy", command: "aufraeumen", icon: "inbox", tint: "#34D399", label: msg("Tidy up"), help: msg("Sorts inbox and filing, merges duplicates, adds tags."), prompt: msg("Sort my inbox and find duplicates.") },
  { id: "draft", command: "entwurf", icon: "mail", tint: "#A5B4FC", label: msg("Draft"), help: msg("Writes mails and texts in your tone, with the knowledge from your vault."), ask: msg("What should I draft?") },
  { id: "week", command: "woche", icon: "calendar", tint: "#2DD4BF", label: msg("Weekly review"), help: msg("Reads journal and new entries and drafts your review."), prompt: msg("Prepare my weekly review with the open loops.") },
  { id: "dossier", command: "akte", icon: "notebook", tint: "#FBBF24", label: msg("Maintain dossier"), help: msg("Brings the dossier of a person, company or project up to date."), ask: msg("Which dossier should I bring up to date?") },
];

export const skillOfCommand = (id: string): AgentSkillInfo | undefined => AGENT_SKILL_INFO.find((s) => s.command === id);
