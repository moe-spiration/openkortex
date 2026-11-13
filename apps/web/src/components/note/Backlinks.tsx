"use client";

import { t } from "@/i18n";
import { memo, useRef } from "react";
import { groupBacklinks, sameBacklinkGroups, type BacklinkGroups } from "@/lib/notes/backlinks";
import { useNotes } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { CheckButton } from "./ActionItems";
import { TypeIcon } from "./icons";

/*
 * Smart Object footer (Feinschliff Live): "Verweise und Backlinks · N" as small cards (type glyph and title) in a grid,
 * linked meetings first, then mentions and documents (both link directions). Open action items of the linking notes
 * stay below as a checklist.
 */

/** The footer's groups for `item`; the same object while they hold the same items (typing in the note itself). */
export function useBacklinkGroups(item: Parameters<typeof groupBacklinks>[0], items: Parameters<typeof groupBacklinks>[1]): BacklinkGroups {
  const next = groupBacklinks(item, items);
  const ref = useRef(next);
  if (!sameBacklinkGroups(ref.current, next)) ref.current = next;
  return ref.current;
}

/** memo: the sheet hands in stable groups (useBacklinkGroups), so a keystroke in the note does not re-render it. */
export const Backlinks = memo(function Backlinks({ groups: g }: { groups: BacklinkGroups }) {
  const { toggleAction } = useNotes();
  const { openNote } = useShell();
  const cards = [...g.meetings, ...g.mentions];
  const empty = !cards.length && !g.actions.length;
  return (
    <footer className="fs-ed-links" aria-label={t("References and backlinks")}>
      <div className="fs-lbl">
        {t("References and backlinks")}
        {cards.length > 0 && <span className="kx-num"> · {cards.length}</span>}
      </div>
      {empty ? (
        <span className="kx-help">{t("No references yet. Link with [[ in the text.")}</span>
      ) : (
        <>
          {cards.length > 0 && (
            <div className="fs-bl-grid">
              {cards.map((m) => (
                <button key={m.id} type="button" className="fs-bl" onClick={() => openNote(m.id)} title={m.path}>
                  <TypeIcon type={m.type} size={14} />
                  <span className="fs-bl-t">{m.title}</span>
                </button>
              ))}
            </div>
          )}
          {g.actions.length > 0 && (
            <div className="fs-bl-acts" role="group" aria-label={t("Open action items from linked notes")}>
              <div className="fs-lbl">{t("Open action items")}</div>
              {g.actions.map(({ item: src, action }) => (
                <div key={action.id} className="fs-chk-row">
                  <CheckButton text={action.text} done={action.done} onToggle={() => toggleAction(src.id, action.id)} />
                  <button type="button" className="fs-chk-src" onClick={() => openNote(src.id)} title={t("Open {name}", { name: src.title })}>
                    {src.title}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </footer>
  );
});
