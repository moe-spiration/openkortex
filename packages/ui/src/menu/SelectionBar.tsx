"use client";

import { t, tx } from "@kortex/i18n";
import type { ActionId, MenuAction } from "./model";
import { menuIcon } from "./ContextMenu";

/*
 * Bulk bar above a list (feedback round 2, #4): "n ausgewählt", the bulk actions, "Auswahl aufheben".
 * Move and Tags open the context menu's sub-lists at the button, so `onAction` also gets the button's rectangle.
 */

export interface SelectionBarProps {
  count: number;
  total: number;
  actions: readonly MenuAction[];
  onAction: (id: ActionId, anchor: DOMRect) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function SelectionBar({ count, total, actions, onAction, onSelectAll, onClear }: SelectionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={t("Selection")}
      className="kxh-wrap"
      style={{
        position: "sticky",
        top: 8,
        zIndex: 20,
        gap: 8,
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: "var(--radius-2xl)",
        background: "var(--bg-floating-glass)",
        WebkitBackdropFilter: "blur(16px)",
        backdropFilter: "blur(16px)",
        boxShadow: "var(--shadow-floating)",
      }}
    >
      <strong className="kx-num" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", padding: "0 6px" }} aria-live="polite">
        {t("{count} selected", { count })}
      </strong>
      {count < total && (
        <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={onSelectAll}>
          {t("Select all {total}", { total })}
          <span className="kx-kbd">{tx("key", "Ctrl A")}</span>
        </button>
      )}
      <span style={{ flex: 1 }} />
      {actions.map((a) => {
        const Icon = menuIcon(a.icon);
        return (
          <button key={a.id} type="button" className={`kx-btn kx-btn--sm ${a.danger ? "kx-btn--danger" : "kx-btn--secondary"}`} onClick={(e) => onAction(a.id, e.currentTarget.getBoundingClientRect())}>
            <Icon size={14} aria-hidden />
            {a.label.replace(/ …$/, "")}
          </button>
        );
      })}
      <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={onClear}>
        {t("Clear selection")}
        <span className="kx-kbd">Esc</span>
      </button>
    </div>
  );
}
