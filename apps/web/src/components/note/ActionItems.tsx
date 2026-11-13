"use client";

import { t } from "@/i18n";
import { memo } from "react";
import { useNotes } from "@/lib/notes/store";
import type { ActionItem } from "@/lib/workspace-data";
import { NIco } from "./icons";

/*
 * Feinschliff Live: "Action Items" of the open note under its text, a checklist over the real action_items rows
 * (toggleAction writes through the notes store). The same check button serves the backlinks' open items.
 */

export function CheckButton({ text, done, onToggle }: { text: string; done: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} className="fs-chk" onClick={onToggle}>
      <span className={"fs-box" + (done ? " is-on" : "")} aria-hidden>
        {done && <NIco name="check" size={11} strokeWidth={3} />}
      </span>
      <span className="fs-chk-t">{text}</span>
    </button>
  );
}

export const ActionItems = memo(function ActionItems({ id, items }: { id: string; items: readonly ActionItem[] }) {
  const { toggleAction } = useNotes();
  if (!items.length) return null;
  return (
    <section className="fs-ed-todos" aria-label={t("Action items")}>
      <h2 className="fs-h2">{t("Action items")}</h2>
      <div>
        {items.map((a) => (
          <CheckButton key={a.id} text={a.timestamp ? `${a.text} (${a.timestamp})` : a.text} done={a.done} onToggle={() => toggleAction(id, a.id)} />
        ))}
      </div>
    </section>
  );
});
