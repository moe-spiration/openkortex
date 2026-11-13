"use client";

import { intlLocale, t, tx } from "@/i18n";
import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ChevronRight } from "lucide-react";
import { useNotes } from "@/lib/notes/store";
import { VAULT_TREE } from "@/lib/workspace-data";
import { NIco, type NoteIconName } from "./icons";

/*
 * "Mehr" in the note head (Feinschliff Live: Verschieben, Archivieren, Löschen). It also holds the view switches the
 * slim head no longer shows as buttons: half width (drawer), Markdown-Quelle and the cover.
 * base-ui Menu: arrow keys, typeahead, Escape and outside click; "Verschieben nach" is a real submenu (→ opens it).
 */

export interface SheetMenuProps {
  /** Drawer only: the 50/50 switch. */
  half: boolean | null;
  src: boolean;
  hasCover: boolean;
  currentFolder: string;
  onHalf: () => void;
  onSrc: () => void;
  onCover: () => void;
  onMove: (folder: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");

function Item({ icon, label, onClick, danger, checked, className }: { icon: NoteIconName; label: string; onClick: () => void; danger?: boolean; checked?: boolean; className?: string }) {
  const cls = "kx-menu-item" + (danger ? " kx-menu-item--danger" : "") + (className ? ` ${className}` : "");
  if (checked !== undefined)
    return (
      <Menu.CheckboxItem className={cls} checked={checked} onCheckedChange={onClick} closeOnClick>
        <NIco name={icon} size={14} />
        <span>{label}</span>
        <Menu.CheckboxItemIndicator className="kx-menu-check">
          <NIco name="check" size={14} />
        </Menu.CheckboxItemIndicator>
      </Menu.CheckboxItem>
    );
  return (
    <Menu.Item className={cls} onClick={onClick}>
      <NIco name={icon} size={14} />
      <span>{label}</span>
    </Menu.Item>
  );
}

export function SheetMenu(p: SheetMenuProps) {
  const [open, setOpen] = useState(false);
  const { items } = useNotes();

  // Vault folders plus the folders the loaded items live in; the current one is left out. Only built while open.
  const folders = useMemo(
    () =>
      open
        ? [...new Set([...VAULT_TREE.map((f) => f.path), ...Object.values(items).map((i) => dirOf(i.path))])]
            .filter((f) => f && f !== p.currentFolder)
            .sort((a, b) => a.localeCompare(b, intlLocale()))
        : [],
    [open, items, p.currentFolder],
  );

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger className={"tc-ibtn" + (open ? " is-on" : "")} aria-label={t("More")} data-tip={open ? undefined : t("Move, archive, delete")}>
        <NIco name="ellipsis" size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} style={{ zIndex: 70 }}>
          <Menu.Popup className="kx-menu kx-pop fs-menu" aria-label={t("More")} style={{ width: 248 }}>
            {p.half !== null && <Item icon="columns-2" label={t("Half width")} onClick={p.onHalf} checked={p.half} className="kx-dr-tgl" />}
            <Item icon="file-code" label={t("View Markdown source")} onClick={p.onSrc} checked={p.src} />
            <Item icon="image" label={p.hasCover ? t("Change cover") : t("Add cover")} onClick={p.onCover} />
            <Menu.Separator className="fs-menu-sep" />
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className="kx-menu-item">
                <NIco name="folder-input" size={14} />
                <span>{t("Move to…")}</span>
                <ChevronRight size={14} className="kx-menu-check" aria-hidden />
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner side="left" align="start" sideOffset={4} style={{ zIndex: 71 }}>
                  <Menu.Popup className="kx-menu kx-pop fs-menu" aria-label={t("Move to")} style={{ width: 260, maxHeight: 320 }}>
                    {folders.length === 0 && <div className="kx-menu-label">{t("No folders available")}</div>}
                    {folders.map((f) => (
                      <Menu.Item key={f} className="kx-menu-item" onClick={() => p.onMove(f)}>
                        <NIco name="folder" size={14} />
                        <span className="kx-mono fs-menu-path">{f}</span>
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
            <Item icon="archive" label={tx("verb", "Archive")} onClick={p.onArchive} />
            <Item icon="trash-2" label={t("Delete")} onClick={p.onDelete} danger />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
