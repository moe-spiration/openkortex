"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ContextMenu, SelectionBar, bulkActions, isContextMenuKey, menuFor, targetsOf, useContextMenu, type ActionId } from "@kortex/ui";
import { todayIso } from "@/lib/date/today";
import { useNotes } from "@/lib/notes/store";
import { parseRemindAction, remindSection } from "@/lib/reminder-menu";
import { ITEM_DRAG_TYPE } from "@/lib/shell/favorites-core";
import { useShell } from "@/lib/shell/store";
import type { ViewEntry } from "./entries";
import { useItemActions } from "./useItemActions";
import { useListSelection } from "./useListSelection";
import { t } from "@/i18n";

/*
 * What every collection view shares (Spaces, Objekte, Vault): open in the drawer, multi-select with the selection
 * bar, right-click / Shift+F10 menu, Alt+Enter split. Kept from the pre-Tactile SpaceView, only moved into one hook.
 */
export function useCollection(entries: readonly ViewEntry[], opts: { archived?: boolean } = {}) {
  const archived = opts.archived === true;
  const router = useRouter();
  const { openNote, drawer, showToast } = useShell();
  const { items, setReminder } = useNotes();
  const act = useItemActions(entries, { refresh: () => router.refresh() });
  const rows = act.visible;
  const order = useMemo(() => rows.map((r) => r.id), [rows]);
  const sel = useListSelection(order, { onDelete: (ids) => void act.run("delete", ids) });
  const cm = useContextMenu<string>();
  const [bar, setBar] = useState<{ at: { x: number; y: number }; level: "folders" | "tags" } | null>(null);
  const menuIds = cm.menu ? targetsOf(sel.state, cm.menu.target) : [];
  const barIds = [...sel.selected];
  const sharedTags = (ids: string[]) => (ids.length ? act.tagsOf(ids[0]!).filter((t) => ids.every((id) => act.tagsOf(id).includes(t))) : []);

  // G4: archived items are not in the workspace (the drawer cannot load them): offer to bring them back instead.
  const open = (e: ViewEntry) =>
    archived
      ? showToast(t("“{title}” is archived. Restore it first to open it.", { title: e.title }), { label: t("Restore"), run: () => void act.run("unarchive", [e.id]) })
      : openNote(e.openId);
  const isActive = (e: ViewEntry) => drawer.id !== null && drawer.id === e.openId;

  /** Click, context menu and keyboard props of one row / card. */
  const rowProps = (n: ViewEntry) => {
    const b = cm.bind(n.id);
    return {
      // A2: drag an entry onto the sidebar favourites to pin it.
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.setData(ITEM_DRAG_TYPE, n.id);
        e.dataTransfer.setData("text/plain", n.title);
        e.dataTransfer.effectAllowed = "copyLink";
      },
      onClick: (e: MouseEvent) => {
        if (!sel.onRowClick(n.id, e)) open(n);
      },
      onContextMenu: (e: MouseEvent) => {
        sel.focusRow(n.id);
        b.onContextMenu(e);
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (isContextMenuKey(e)) sel.focusRow(n.id);
        else if (e.key === "Enter" && e.altKey) {
          e.preventDefault();
          void act.run("open-split", [n.id]);
          return;
        }
        b.onKeyDown(e);
      },
    };
  };

  const selectionBar =
    sel.count > 0 ? (
      <div className="kc-section">
        <SelectionBar
          count={sel.count}
          total={rows.length}
          actions={bulkActions("item", sel.count, { archived })}
          onAction={(id, r) => {
            if (id === "move" || id === "tags") setBar({ at: { x: r.left, y: r.bottom + 6 }, level: id === "move" ? "folders" : "tags" });
            else void act.run(id, barIds);
          }}
          onSelectAll={sel.all}
          onClear={sel.clear}
        />
      </div>
    ) : null;

  const menus = (
    <>
      <ContextMenu
        at={cm.menu?.at ?? null}
        label={t("Entry")}
        sections={[
          ...menuFor({ kind: "item", count: menuIds.length, favorite: act.favoriteOf(menuIds[0] ?? ""), archived }),
          ...(archived || !menuIds.some((id) => items[id]) ? [] : [remindSection(menuIds.some((id) => !!items[id]?.remindAt), new Date(), todayIso())]),
        ]}
        folders={act.folders}
        tags={act.knownTags}
        activeTags={sharedTags(menuIds)}
        onAction={(id: ActionId, arg?: string) => {
          const at = parseRemindAction(id);
          if (at === undefined) void act.run(id, menuIds, arg);
          else for (const target of menuIds) setReminder(target, at);
        }}
        onClose={cm.close}
      />
      <ContextMenu
        at={bar?.at ?? null}
        initialLevel={bar?.level}
        label={t("Selection")}
        sections={[]}
        folders={act.folders}
        tags={act.knownTags}
        activeTags={sharedTags(barIds)}
        onAction={(id: ActionId, arg?: string) => void act.run(id, barIds, arg)}
        onClose={() => setBar(null)}
      />
    </>
  );

  return { rows, sel, open, isActive, rowProps, selectionBar, menus, drawerOpen: drawer.id !== null };
}
