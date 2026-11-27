"use client";

import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, Clock, Hash, LayoutGrid, List, ListFilter, Search, SlidersHorizontal, SquareCheckBig, Users } from "lucide-react";
import { DensitySwitch } from "@kortex/ui";
import { BarButton } from "@/components/shell/Bars";
import { SORT_LABEL, type SortKey } from "@/lib/data/collections";
import { gridBucket, groupRows, rowWhen } from "@/lib/data/library-groups";
import { tagTone } from "@/lib/workspace-data";
import { intlLocale, t } from "@/i18n";
import type { ViewEntry } from "./entries";
import { TypeGlyph } from "./EntryParts";
import type { useCollection } from "./useCollection";
import type { ViewMode } from "./useViewMode";

/*
 * Bibliothek in the Ruhe look (gap web-a §3/§4, mock `bibliothek`, `alleRaster`, `alleZeit`, `alleMonat`). SpaceView
 * keeps the state (filters, sort, view, selection, J/K) and renders these parts in Ruhe:
 *   - the view bar's right side: "Filter" and "Anzeige" popovers and the three view icons,
 *   - the grouped list: 36 px rows (type icon, title, grey subtitle, tag dot + name, time), group heads 34 px.
 * Vivid keeps its filter row and table.
 */

type Collection = ReturnType<typeof useCollection>;

/** A popover anchored to a bar button (Filter, Anzeige). */
export function BarPopover({
  trigger,
  label,
  children,
  width = 300,
  open: openProp,
  onOpenChange,
}: {
  trigger: ReactElement<Record<string, unknown>>;
  label: string;
  children: ReactNode;
  width?: number;
  /** Controlled (the F key opens the filter); uncontrolled when left out. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = onOpenChange ?? setOwn;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={trigger} />
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={6} style={{ zIndex: 70 }}>
          <Popover.Popup className="kx-popover rz-lpop" aria-label={label} style={{ width } as CSSProperties}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Opt({ on, onClick, icon, children, count }: { on: boolean; onClick: () => void; icon?: ReactNode; children: ReactNode; count?: number }) {
  return (
    <button type="button" className="rz-lpop-opt" aria-pressed={on} onClick={onClick}>
      {icon}
      <span className="kx-truncate">{children}</span>
      {count !== undefined && <span className="rz-lpop-n">{count}</span>}
      <Check aria-hidden className="rz-lpop-check" />
    </button>
  );
}

export interface FilterState {
  find: string;
  setFind: (v: string) => void;
  tag: string | null;
  setTag: (v: string | null) => void;
  obj: string | null;
  setObj: (v: string | null) => void;
  withTasks: boolean;
  setWithTasks: (v: boolean) => void;
  tagCounts: [string, number][];
  objCounts: [string, { title: string; n: number }][];
  anyWithTasks: boolean;
  reset: () => void;
  active: boolean;
  findRef: React.RefObject<HTMLInputElement | null>;
  drawerOpen: boolean;
  onEnter: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}

const TOP_TAGS = 8;
const TOP_OBJECTS = 6;

/** "Filter": search in this view (F), hashtags, objects, only with open tasks. */
export function FilterMenu({ f }: { f: FilterState }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const tags = f.tagCounts.filter(([x]) => !ql || x.toLowerCase().includes(ql)).slice(0, ql ? 30 : TOP_TAGS);
  const objs = f.objCounts.filter(([, o]) => !ql || o.title.toLowerCase().includes(ql)).slice(0, ql ? 20 : TOP_OBJECTS);
  return (
    <BarPopover
      label={t("Filter")}
      open={f.open}
      onOpenChange={f.setOpen}
      trigger={
        <BarButton icon={<ListFilter aria-hidden />} active={f.active}>
          {t("Filter")}
        </BarButton>
      }
    >
      <label className="rz-lpop-find">
        <Search aria-hidden />
        <input
          ref={f.findRef}
          type="search"
          value={f.find}
          placeholder={f.drawerOpen ? t("Search list  ·  J / K to step") : t("Search in this view")}
          aria-label={t("Search in this view")}
          onChange={(e) => f.setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              f.setOpen(false);
              f.onEnter();
            }
          }}
        />
        <kbd>F</kbd>
      </label>
      {(f.tagCounts.length > 6 || f.objCounts.length > 6) && (
        <input className="rz-lpop-sub" type="search" value={q} placeholder={t("Search hashtags and objects …")} aria-label={t("Search hashtags and objects …")} onChange={(e) => setQ(e.target.value)} />
      )}
      {tags.length > 0 && (
        <div className="rz-lpop-sec">
          <div className="rz-lpop-lab">Hashtags</div>
          {tags.map(([tag, n]) => (
            <Opt
              key={tag}
              on={f.tag === tag}
              count={n}
              icon={<i className="rz-ldot" style={{ background: `var(--tag-${tagTone(tag)}-dot)` }} aria-hidden />}
              onClick={() => f.setTag(f.tag === tag ? null : tag)}
            >
              {tag.replace(/^#/, "")}
            </Opt>
          ))}
        </div>
      )}
      {objs.length > 0 && (
        <div className="rz-lpop-sec">
          <div className="rz-lpop-lab">{t("Objects")}</div>
          {objs.map(([id, o]) => (
            <Opt key={id} on={f.obj === id} count={o.n} icon={<Users aria-hidden />} onClick={() => f.setObj(f.obj === id ? null : id)}>
              {o.title}
            </Opt>
          ))}
        </div>
      )}
      {f.anyWithTasks && (
        <div className="rz-lpop-sec">
          <Opt on={f.withTasks} icon={<SquareCheckBig aria-hidden />} onClick={() => f.setWithTasks(!f.withTasks)}>
            {t("Only entries with open tasks")}
          </Opt>
        </div>
      )}
      {f.active && (
        <div className="rz-lpop-foot">
          <button type="button" className="rz-lpop-reset" onClick={f.reset}>
            {t("Reset filters")}
          </button>
        </div>
      )}
    </BarPopover>
  );
}

const MODES: { id: ViewMode; label: string; key: string; Icon: typeof List }[] = [
  { id: "list", label: "List", key: "L", Icon: List },
  { id: "grid", label: "Grid", key: "G", Icon: LayoutGrid },
  { id: "timeline", label: "Timeline", key: "T", Icon: Clock },
];

/** "Anzeige": view, order, density and the two blocks above the entries (mixes, calendar). */
export function DisplayMenu({
  view,
  setView,
  sort,
  setSort,
  density,
  setDensity,
  mixes,
  showMixes,
  setShowMixes,
  showCalendar,
  setShowCalendar,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  density: Parameters<typeof DensitySwitch>[0]["value"];
  setDensity: (d: Parameters<typeof DensitySwitch>[0]["value"]) => void;
  /** The view offers Smart Mixes at all. */
  mixes: boolean;
  showMixes: boolean;
  setShowMixes: (v: boolean) => void;
  showCalendar: boolean;
  setShowCalendar: (v: boolean) => void;
}) {
  return (
    <BarPopover
      label={t("Display")}
      width={280}
      trigger={<BarButton icon={<SlidersHorizontal aria-hidden />}>{t("Display")}</BarButton>}
    >
      <div className="rz-lpop-sec">
        <div className="rz-lpop-lab">{t("View")}</div>
        <div className="rz-lpop-seg" role="radiogroup" aria-label={t("View")}>
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={view === m.id} onClick={() => setView(m.id)}>
              <m.Icon aria-hidden />
              {t(m.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="rz-lpop-sec">
        <div className="rz-lpop-lab">{t("Order")}</div>
        {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
          <Opt key={k} on={sort === k} onClick={() => setSort(k)}>
            {SORT_LABEL[k]}
          </Opt>
        ))}
      </div>
      <div className="rz-lpop-sec rz-lpop-row">
        <span className="rz-lpop-lab">{t("Density")}</span>
        <DensitySwitch value={density} onChange={setDensity} />
      </div>
      <div className="rz-lpop-sec">
        {mixes && (
          <Opt on={showMixes} onClick={() => setShowMixes(!showMixes)}>
            Smart Knowledge Mixes
          </Opt>
        )}
        <Opt on={showCalendar} onClick={() => setShowCalendar(!showCalendar)}>
          {t("Calendar")}
        </Opt>
      </div>
    </BarPopover>
  );
}

/** The three view icons at the right end of the view bar (L / G / T). */
export function ViewIcons({ view, setView }: { view: ViewMode; setView: (v: ViewMode) => void }) {
  return (
    <div className="rz-lview" role="tablist" aria-label={t("View")}>
      {MODES.map((m) => (
        <button key={m.id} type="button" role="tab" aria-selected={view === m.id} aria-label={t(m.label)} title={`${t(m.label)}  ${m.key}`} onClick={() => setView(m.id)}>
          <m.Icon aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** Active hashtag / object filter as an accent chip in the view bar ("Mix: Agent-Gedächtnis ×"). */
export function FilterChip({ icon, children, onClear, label }: { icon: ReactNode; children: ReactNode; onClear: () => void; label: string }) {
  return (
    <button type="button" className="rz-lchip" aria-label={label} onClick={onClear}>
      {icon}
      <span className="kx-truncate">{children}</span>
      <span aria-hidden className="rz-lchip-x">
        ×
      </span>
    </button>
  );
}

export const HashIcon = () => <Hash aria-hidden />;

function Row({ n, c, today, locale }: { n: ViewEntry; c: Collection; today: string; locale: string }) {
  const rp = c.rowProps(n);
  const sub = n.tldr || n.facts?.line || [n.typeLabel, n.domain].filter(Boolean).join(" · ");
  // Only the pipeline spins ("Wird verarbeitet …"); reading progress and "Neu" stay quiet.
  const running = n.status?.tone === "run" && n.status.label === t("Processing");
  const tag = n.tags[0]?.label;
  return (
    <div
      role="row"
      tabIndex={0}
      data-date={n.date}
      data-entry-id={n.id}
      className={"rz-lrow" + (c.isActive(n) ? " is-on" : "") + (c.sel.selected.has(n.id) ? " is-sel" : "")}
      draggable={rp.draggable}
      onDragStart={rp.onDragStart}
      onPointerEnter={rp.onPointerEnter}
      onClick={rp.onClick}
      onContextMenu={rp.onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.altKey) {
          e.preventDefault();
          c.open(n);
          return;
        }
        rp.onKeyDown(e);
      }}
    >
      <span role="gridcell" className="rz-lrow-i" title={n.typeLabel}>
        <TypeGlyph entry={n} size="sm" />
      </span>
      <span role="gridcell" className="rz-lrow-t">
        {n.title}
      </span>
      <span role="gridcell" className="rz-lrow-s">
        {running ? (
          <>
            <span className="kx-spinner" aria-hidden /> {n.status!.label}
          </>
        ) : (
          sub
        )}
      </span>
      <span role="gridcell" className="rz-lrow-r">
        {n.status?.tone === "crit" && <span className="rz-lrow-err">{n.status.label}</span>}
        {tag && (
          <span className="rz-lrow-tag" title={tag}>
            <i className="rz-ldot" style={{ background: `var(--tag-${tagTone(tag)}-dot)` }} aria-hidden />
            {tag.replace(/^#/, "").split("/").pop()}
          </span>
        )}
        <span className="rz-lrow-when kx-num">{rowWhen(n.date, n.time, today, locale)}</span>
      </span>
    </div>
  );
}

/** The grouped list (Heute 4 / Gestern 4 / Diese Woche 5 / Oktober …); a title sort shows one plain list. */
export function GroupedList({ rows, c, today, byDate, total }: { rows: ViewEntry[]; c: Collection; today: string; byDate: boolean; total: Map<string, number> }) {
  const locale = intlLocale();
  const groups = groupRows(rows, today, byDate);
  return (
    <div className="rz-llist" role="grid" aria-label={t("Entries")} data-view="list">
      {groups
        ? groups.map((g) => (
            <section key={g.key + g.items[0]!.id} role="rowgroup" aria-label={g.label}>
              <div className="rz-lghead" role="row">
                <span role="columnheader">{g.label}</span>
                <span className="rz-lghead-c kx-num">{total.get(g.key) ?? g.items.length}</span>
              </div>
              {g.items.map((n) => (
                <Row key={n.id} n={n} c={c} today={today} locale={locale} />
              ))}
            </section>
          ))
        : rows.map((n) => <Row key={n.id} n={n} c={c} today={today} locale={locale} />)}
    </div>
  );
}

/**
 * Grid in groups (mock `alleRaster`): "Heute und gestern 8" with the order on the right of the first head, then
 * "Diese Woche", then months. A title sort shows one plain grid.
 */
export function GroupedGrid({
  rows,
  today,
  byDate,
  total,
  order,
  card,
}: {
  rows: ViewEntry[];
  today: string;
  byDate: boolean;
  total: Map<string, number>;
  order: string;
  card: (n: ViewEntry) => ReactNode;
}) {
  const groups = groupRows(rows, today, byDate, gridBucket);
  if (!groups) return <div className="kc-grid" data-view="grid">{rows.map(card)}</div>;
  return (
    <div className="rz-lgrid" data-view="grid">
      {groups.map((g, i) => (
        <section key={g.key + g.items[0]!.id} aria-label={g.label}>
          <div className="rz-lghead is-grid">
            <span>{g.label}</span>
            <span className="rz-lghead-c kx-num">{total.get(g.key) ?? g.items.length}</span>
            {i === 0 && <span className="rz-lghead-o">{order}</span>}
          </div>
          <div className="kc-grid">{g.items.map(card)}</div>
        </section>
      ))}
    </div>
  );
}
