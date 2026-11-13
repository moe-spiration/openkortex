import { fieldLabel, statusLabel, typeLabel } from "@kortex/db/type-registry";
import { t } from "../i18n";

/*
 * Copilot status action (POST /api/chat/action, action "status"): "/status Dune gelesen, 9 von 10" updates
 * metadata.status / rating / feedback of an existing entry. The phone asks first (save: false), shows what
 * would change and saves on "Übernehmen" (save: true with the found item_id).
 */

/** The instruction behind `/status …` (also "Status: …"), else null. */
export function statusCommand(text: string): string | null {
  const m = /^\s*(?:\/status\b|status:)\s*([\s\S]*)$/i.exec(text);
  if (!m) return null;
  const rest = m[1]!.trim();
  return rest || null;
}

export interface StatusResult {
  item_id: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
  saved: boolean;
}

/** "Dune (Buch): Status Gelesen · Bewertung 9/10 · Feedback „stark“". */
export function statusSummary(r: StatusResult): string {
  const parts = Object.entries(r.metadata).map(([k, v]) => {
    if (k === "status" && typeof v === "string") return t("Status {status}", { status: statusLabel(v) });
    if (k === "rating" && typeof v === "number") return t("Rating {n}/10", { n: v });
    if (k === "feedback") return t("Feedback “{text}”", { text: String(v) });
    return `${fieldLabel(k)} ${String(v)}`;
  });
  const head = `${r.title} (${typeLabel(r.type)})`;
  const changes = parts.join(" · ");
  return r.saved ? t("Saved: {head}: {changes}", { head, changes }) : t("{head}: {changes}. Apply?", { head, changes });
}
