"use client";

import { msg, t } from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { OBJECT_TYPES, type ObjectType } from "@kortex/ui";
import { Ico } from "@/components/shell/icons";
import { DOMAIN_OBJECT_FOLDERS, DOMAIN_OBJECT_TYPES, isDomainObjectType } from "@/lib/objects/schema";
import { useNotes, type ObjectTarget } from "@/lib/notes/store";
import { useShell } from "@/lib/shell/store";
import { NOTE_TYPES, type KnowledgeItem } from "@/lib/workspace-data";
import { NIco, TypeIcon } from "./icons";

/*
 * The "Typ" property of the Smart Property Header (Tactile Craft v2, K2): the type once, as a quiet select
 * (dummy .typesel: type glyph, label, chevron), opening the "In Objekt umwandeln" menu: note plus the 7 domain
 * objects. Conversion is optimistic. No badge, avatar or pill repeats the type elsewhere in the header.
 */

const TARGETS: ObjectTarget[] = ["note", ...DOMAIN_OBJECT_TYPES];
const TYPE_LABEL: Record<ObjectTarget, string> = {
  note: msg("Note"),
  person: msg("Person"),
  project: msg("Project"),
  organization: msg("Organization"),
  concept: msg("Concept"),
  tool: msg("Tool"),
  asset: msg("Asset"),
  goal: msg("Goal"),
};

export function ObjectTypeMenu({ item, bare = false }: { item: KnowledgeItem; /** Without the type glyph (the note head shows it). */ bare?: boolean }) {
  const { convert } = useNotes();
  const { showToast } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current: ObjectTarget = isDomainObjectType(item.type) ? item.type : "note";
  // German type label; plain items keep their content type (Meeting, Artikel ...) on the neutral note badge.
  const label = NOTE_TYPES[item.type].label;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const pick = (to: ObjectTarget) => {
    setOpen(false);
    if (to === current) return;
    convert(item.id, to);
    showToast(to === "note" ? t("A note again") : t("Turned into {type} · Suggestion: {folder}", { type: t(TYPE_LABEL[to]), folder: DOMAIN_OBJECT_FOLDERS[to] }));
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className={bare ? "kx-typesel fs-typesel" : "kx-typesel"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Type: {type}. Turn into object", { type: label })}
        title={t("Turn into object")}
        onClick={() => setOpen((v) => !v)}
      >
        {!bare && <TypeIcon type={item.type} size={13} />}
        {label}
        <NIco name="chevron-down" size={12} />
      </button>
      {open && (
        <div className="kx-menu kx-in" role="menu" aria-label={t("Turn into object")} style={{ position: "absolute", left: 0, top: 32, zIndex: 20, width: 260 }}>
          <div className="kx-menu-label">{t("Turn into object")}</div>
          {TARGETS.map((target) => {
            const on = target === current;
            const cfg = OBJECT_TYPES[target as ObjectType];
            return (
              <button
                key={target}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={"kxb kx-menu-item" + (on ? " is-selected" : "")}
                style={{ width: "100%" }}
                onClick={() => pick(target)}
              >
                <cfg.Icon aria-hidden className="kx-ico" />
                <span>{t(TYPE_LABEL[target])}</span>
                <span className="kx-hint">{target === "note" ? "" : DOMAIN_OBJECT_FOLDERS[target].replace("70_Objects/", "")}</span>
                {on && <Ico name="check" size="sm" style={{ color: "var(--accent-ai)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
