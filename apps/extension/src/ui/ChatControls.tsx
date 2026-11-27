import { AppMark, Button } from "@kortex/ui";
import { PRODUCT_NAME, t } from "../i18n";
import { AI_MEMORIES_FOLDER } from "../lib/api";
import { PROMPT_FOLDER } from "../lib/prompts";
import { StatusChip } from "./StatusChip";
import { Check, BookmarkPlus } from "lucide-react";
import { Mark } from "./ruhe/kit";

/**
 * Ruhe look: one quiet button next to the site's own actions (mark + label, hairline ring); saved = check and the
 * file in the tooltip.
 */
function RuheInj({ state, onSave, label, savedLabel, icon, float }: { state: SaveState; onSave: () => void; label: string; savedLabel: string; icon?: "prompt"; float?: boolean }) {
  const saved = state.status === "saved";
  return (
    <span className="rx">
      <button
        type="button"
        className={`rx-inj${float ? " rx-inj--float" : ""}`}
        data-state={saved ? "saved" : undefined}
        disabled={state.status === "saving"}
        onClick={saved ? undefined : onSave}
        title={state.status === "error" ? state.message : saved ? state.file : undefined}
      >
        {saved ? <Check size={13} aria-hidden /> : icon === "prompt" ? <BookmarkPlus size={12} aria-hidden /> : <Mark />}
        {saved ? savedLabel : state.status === "saving" ? t("Saving …") : label}
      </button>
    </span>
  );
}

export type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved"; file: string } | { status: "error"; message: string };

const SavedPill = ({ children }: { children: string }) => <StatusChip tone="ok">{children}</StatusChip>;

/** "Save Chat to Kortex" for the whole conversation (header of the chat page). */
export function SaveChatButton({ state, onSave, ruhe }: { state: SaveState; onSave: () => void; ruhe?: boolean }) {
  if (ruhe) return <RuheInj state={state} onSave={onSave} label={t("Save chat")} savedLabel={t("Chat saved")} float />;
  if (state.status === "saved") return <SavedPill>{t("Saved: {path}", { path: `${AI_MEMORIES_FOLDER}/${state.file}` })}</SavedPill>;
  return (
    <Button
      variant="secondary"
      className="min-h-9 rounded-lg"
      disabled={state.status === "saving"}
      onClick={onSave}
      title={state.status === "error" ? state.message : undefined}
    >
      <AppMark size={14} />
      {`Save Chat to ${PRODUCT_NAME}`}
      <span className="kx-t-meta text-muted">{AI_MEMORIES_FOLDER}</span>
    </Button>
  );
}

/** Small per-answer button next to the site's own "Copy". */
export function SaveAnswerButton({ state, onSave, ruhe }: { state: SaveState; onSave: () => void; ruhe?: boolean }) {
  if (ruhe) return <RuheInj state={state} onSave={onSave} label={t("Save answer")} savedLabel={t("Answer saved")} />;
  if (state.status === "saved") return <SavedPill>{`${AI_MEMORIES_FOLDER}/${state.file}`}</SavedPill>;
  return (
    <Button
      variant="secondary"
      size="sm"
      className="min-h-9 rounded-lg"
      disabled={state.status === "saving"}
      onClick={onSave}
      title={state.status === "error" ? state.message : undefined}
    >
      <AppMark size={14} />
      {`Save to ${PRODUCT_NAME}`}
    </Button>
  );
}

/** Per user message: saves the prompt alone as a `prompt` item. */
export function SavePromptButton({ state, onSave, ruhe }: { state: SaveState; onSave: () => void; ruhe?: boolean }) {
  if (ruhe) return <RuheInj state={state} onSave={onSave} label={t("As prompt")} savedLabel={t("Prompt saved")} icon="prompt" />;
  if (state.status === "saved") return <SavedPill>{`${PROMPT_FOLDER}/${state.file}`}</SavedPill>;
  return (
    <Button
      variant="secondary"
      size="sm"
      className="min-h-9 rounded-lg"
      disabled={state.status === "saving"}
      onClick={onSave}
      title={state.status === "error" ? state.message : undefined}
    >
      <AppMark size={14} />
      {t("Save as prompt")}
    </Button>
  );
}
