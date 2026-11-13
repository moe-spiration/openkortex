"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Command } from "cmdk";
import { Kbd } from "@kortex/ui";

/*
 * Body of the filter popover (CollectionHead.FilterPopover): a cmdk list, so arrow keys move, Enter picks and typing
 * filters. Loaded on first open (next/dynamic), so collection pages do not ship cmdk in their first load.
 */

export interface FilterListItem {
  key: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  checked?: boolean;
}

export default function FilterList({
  items,
  search,
  label,
  emptyText,
  onPick,
}: {
  items: FilterListItem[];
  search?: string;
  label: string;
  emptyText: string;
  onPick: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = q ? items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase().replace(/^#/, ""))) : items;
  return (
    <Command shouldFilter={false} loop label={label}>
      {search ? (
        <label className="kc-pop-q">
          <Search aria-hidden />
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder={search} aria-label={search} />
        </label>
      ) : (
        // cmdk reads the keys from its input; without a search field it is visually hidden but holds the focus.
        <Command.Input autoFocus className="kx-sr-only" aria-label={label} readOnly />
      )}
      <Command.List>
        {shown.map((i) => (
          <Command.Item key={i.key} value={i.key} aria-checked={!!i.checked} className="kc-pop-item" onSelect={() => onPick(i.key)}>
            {i.icon}
            <span>{i.label}</span>
            {i.count !== undefined && <Kbd size="sm">{i.count}</Kbd>}
          </Command.Item>
        ))}
        {shown.length === 0 && <div className="kc-pop-empty">{emptyText}</div>}
      </Command.List>
    </Command>
  );
}
