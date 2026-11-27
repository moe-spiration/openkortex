"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import dynamic from "next/dynamic";
import { t } from "@/i18n";
import { useLook } from "@/components/theme/look";
import { LocationBar } from "@/components/shell/Bars";

const loadFilterList = () => import("./FilterList");
const preloadFilterList = () => void loadFilterList().catch(() => {});
const FilterList = dynamic(loadFilterList, { ssr: false, loading: () => <div className="kc-pop-empty">…</div> });

/*
 * Compact page head of the collections (dummy `.ph`): breadcrumb, title 24/500, statistic line with counters, and
 * the controls on the right. Plus the filter popover with inline search (dummy hashtag menu).
 * Ruhe: the head is the shell's LocationBar (icon, crumbs, `aside` as actions); title, counters and help line go,
 * the view bar carries the counts.
 */

export interface Crumb {
  label: string;
  href?: string;
}

export interface Stat {
  value: number | string;
  label: string;
}

export function CollectionHead({
  icon,
  crumbs,
  title,
  stats,
  help,
  aside,
}: {
  icon?: ReactNode;
  crumbs: Crumb[];
  title: ReactNode;
  stats?: Stat[];
  /** Plain line when there are no counters. */
  help?: ReactNode;
  aside?: ReactNode;
}) {
  const look = useLook();
  if (look === "ruhe") {
    return <LocationBar icon={icon as ReactElement | undefined} crumbs={crumbs} actions={aside} />;
  }
  return (
    <div className="kc-head kx-pagetitle has-crumbs">
      <div className="kc-head-main">
        <nav className="kc-crumb" aria-label={t("Path")}>
          {icon}
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <ChevronRight className="kc-sep" aria-hidden />}
                {c.href && !last ? (
                  <Link href={c.href}>{c.label}</Link>
                ) : (
                  <span className={last ? "is-last kc-clamp1" : "kc-clamp1"} aria-current={last ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
        <h1 className="kc-h1">{title}</h1>
        {stats && stats.length > 0 ? (
          <div className="kc-stats">
            {stats.map((s, i) => (
              <span key={s.label} style={{ display: "contents" }}>
                {i > 0 && <span className="kc-dot" aria-hidden />}
                <span>
                  <b>{s.value}</b> {s.label}
                </span>
              </span>
            ))}
          </div>
        ) : help ? (
          <div className="kc-stats">{help}</div>
        ) : null}
      </div>
      {aside}
    </div>
  );
}

/** Fills the `{name}` placeholders of an already translated text with React nodes (bold counters in a sentence). */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? <Fragment key={i}>{nodes[name]}</Fragment> : part;
  });
}

/** Closes on a pointer down outside `ref` and on Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open, close]);
  return ref;
}

export interface PopItem {
  key: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  checked?: boolean;
}

/**
 * Chip with a popover list; `search` adds the inline filter field (hashtags, objects).
 * base-ui Popover (placement, focus, Escape, outside click) with a cmdk list inside (FilterList, loaded on first
 * open and preloaded on hover): arrow keys move, Enter picks, typing filters.
 */
export function FilterPopover({
  label,
  icon,
  items,
  onPick,
  search,
  active,
  emptyText = t("Nothing found"),
}: {
  label: ReactNode;
  icon?: ReactNode;
  items: PopItem[];
  onPick: (key: string) => void;
  search?: string;
  active?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={"kc-chip" + (active ? " is-on" : "")} onPointerEnter={preloadFilterList} onFocus={preloadFilterList}>
        {icon}
        {label}
        <ChevronDown aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={8} style={{ zIndex: 70 }}>
          <Popover.Popup className="kc-pop kx-popover kx-pop-anchored">
            <FilterList
              items={items}
              search={search}
              label={typeof label === "string" ? label : t("Filter")}
              emptyText={emptyText}
              onPick={(k) => {
                onPick(k);
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
