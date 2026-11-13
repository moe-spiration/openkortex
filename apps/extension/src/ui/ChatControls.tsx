import { AppMark, Button } from "@kortex/ui";
import { PRODUCT_NAME, t } from "../i18n";
import { AI_MEMORIES_FOLDER } from "../lib/api";
import { PROMPT_FOLDER } from "../lib/prompts";
import { StatusChip } from "./StatusChip";

export type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved"; file: string } | { status: "error"; message: string };

const SavedPill = ({ children }: { children: string }) => <StatusChip tone="ok">{children}</StatusChip>;

/** "Save Chat to Kortex" for the whole conversation (header of the chat page). */
export function SaveChatButton({ state, onSave }: { state: SaveState; onSave: () => void }) {
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
export function SaveAnswerButton({ state, onSave }: { state: SaveState; onSave: () => void }) {
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
export function SavePromptButton({ state, onSave }: { state: SaveState; onSave: () => void }) {
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
