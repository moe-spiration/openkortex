import { t } from "@/i18n";
import { typeStatuses } from "@kortex/db";
import type { ChatActionRequest } from "@/server/chat/action";

/*
 * The AI actions on a note (UI spec 2026-10-25 W7/W8): one list for the Peek header's "KI" menu and the
 * editor's floating toolbar on a selection, so both call the same actions. Text actions run through
 * POST /api/chat/action under their own names; "Frage dazu stellen" opens the copilot instead.
 * "continue" answers with the new paragraphs only, the caller appends them.
 */

export type AiActionId = "rewrite" | "shorten" | "continue" | "summarize" | "ask" | "status";

/** Icon ids of `components/shell/icons` (kept as strings here so this module stays UI-free). */
export interface AiActionDef {
  id: AiActionId;
  label: string;
  icon: "pencil" | "minimize" | "plus" | "list" | "message" | "check";
  hint: string;
}

/**
 * "Status aktualisieren" (POST /api/chat/action `status`, saved): the model reads status, rating and feedback from
 * the note and sets metadata.status from the type's registry enum. Only for types with a status lifecycle.
 */
export const STATUS_ACTION: AiActionDef = {
  id: "status",
  get label() {
    return t("Update status");
  },
  icon: "check",
  get hint() {
    return t("AI reads status, rating and feedback from the note and fills them in");
  },
};

/** The KI menu of an item: the shared actions, plus "Status aktualisieren" when its registry type has a status enum. */
export function aiActionsFor(dbType: string | undefined): readonly AiActionDef[] {
  return dbType && typeStatuses(dbType).length ? [...AI_ACTIONS, STATUS_ACTION] : AI_ACTIONS;
}

/** Actions that answer with Markdown (text actions, the summary, and the editor's "Eigene Anweisung"). */
export type AiAnswerActionId = Exclude<AiActionId, "ask" | "status"> | "custom";

export const AI_ACTIONS: readonly AiActionDef[] = [
  { id: "rewrite", get label() { return t("Rewrite"); }, icon: "pencil", get hint() { return t("Clearer and more precise, same meaning"); } },
  { id: "shorten", get label() { return t("Shorten"); }, icon: "minimize", get hint() { return t("Condense to the key messages"); } },
  { id: "continue", get label() { return t("Continue"); }, icon: "plus", get hint() { return t("Continue the text in a meaningful way"); } },
  { id: "summarize", get label() { return t("Summarize"); }, icon: "list", get hint() { return t("Short version as summary"); } },
  { id: "ask", get label() { return t("Ask a question about it"); }, icon: "message", get hint() { return t("Ask in the copilot"); } },
];

/** Actions that return new Markdown for the text (applied after a preview). */
export type AiTextActionId = Exclude<AiActionId, "ask" | "summarize" | "status">;

export const isTextAction = (id: AiActionId): id is AiTextActionId => id === "rewrite" || id === "shorten" || id === "continue";

/**
 * The /api/chat/action request for an action, on the whole note (`itemId`) or on a given text
 * (`contentMd`, e.g. a selection). `null` for "ask", which has no request.
 */
export function aiActionRequest(
  id: AiActionId | "custom",
  target: { itemId?: string; contentMd?: string; instruction?: string },
): (Partial<ChatActionRequest> & Pick<ChatActionRequest, "action">) | null {
  if (id === "ask") return null;
  const base = {
    ...(target.itemId ? { item_id: target.itemId } : {}),
    ...(target.contentMd ? { content_md: target.contentMd } : {}),
    ...(target.instruction?.trim() ? { instruction: target.instruction.trim() } : {}),
  };
  // The status update is applied on the server (metadata merge), so it is always saved.
  return { action: id, ...base, ...(id === "status" ? { save: true } : {}) };
}

/** Mock mode: a visible, deterministic stand-in for the model's answer (same shape as the server's). */
export function mockAiResult(id: AiAnswerActionId, md: string, summary?: string, instruction?: string): string {
  const text = md.trim();
  if (id === "custom") return mockCustom(text, instruction ?? "");
  if (id === "summarize") return summary?.trim() || firstSentences(text, 2) || t("Not enough content for a summary yet.");
  if (id === "shorten") {
    const paras = text.split(/\n{2,}/).filter((p) => p.trim() && !/^#/.test(p.trim()));
    // One paragraph (e.g. a selection): keep the first half of its sentences.
    if (paras.length === 1) {
      const sentences = paras[0]!.match(SENTENCE) ?? [paras[0]!];
      return sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2))).map((s) => s.trim()).join(" ");
    }
    return paras.slice(0, Math.max(1, Math.ceil(paras.length / 2))).join("\n\n");
  }
  if (id === "continue") return t("Next we clarify the open points and record the decision in this note.");
  return text;
}

/** A sentence ends at . ! or ? followed by whitespace or the end (so ".conflict.md" stays whole). */
const SENTENCE = /[^]*?[.!?](?=\s|$)/g;

function firstSentences(text: string, n: number): string {
  const plain = text.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim();
  const parts = plain.match(SENTENCE) ?? (plain ? [plain] : []);
  return parts.slice(0, n).map((s) => s.trim()).join(" ");
}

/** Mock "Eigene Anweisung": understands „Ersetze X durch Y“ and "Replace X with Y" (so the flow is testable without a model), else unchanged. */
function mockCustom(text: string, instruction: string): string {
  const m = /(?:ersetze|replace)\s+[„“"']?(.+?)[“”"']?\s+(?:durch|mit|with|by)\s+[„“"']?(.+?)[“”"']?\s*$/i.exec(instruction.trim());
  return m ? text.split(m[1]!).join(m[2]!) : text;
}
