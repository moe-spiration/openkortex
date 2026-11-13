"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { TableVirtuosoHandle, TableVirtuosoProps } from "react-virtuoso";
// Virtualisation loads only for long lists (VIRTUAL_MIN); short lists never pay for it.
const TableVirtuoso = dynamic(() => import("react-virtuoso").then((m) => m.TableVirtuoso), { ssr: false }) as unknown as <D, C>(
  p: TableVirtuosoProps<D, C> & { ref?: React.Ref<TableVirtuosoHandle> },
) => React.ReactElement;
import { ChevronsUpDown, Clock, Hash, Search, LayoutGrid, List, Shapes, SquareCheckBig, Users, X } from "lucide-react";
import { DensitySwitch, HScroll } from "@kortex/ui";
import { EmptyState } from "@/components/shell/Page";
import { isLiveData, MOCK_TODAY, TASKS } from "@/lib/workspace-data";
import { setActionItemDone } from "@/lib/api/actions";
import { useShell } from "@/lib/shell/store";
import { useDensity } from "@/lib/settings/store";
import { spaceHref } from "@/lib/shell/routes";
import { SORT_LABEL, matchesType, sortEntries, typeChips, type SortKey } from "@/lib/data/collections";
import { registryTypeOfShell } from "@/lib/spaces";
import { CollectionHead, FilterPopover, type Crumb, type Stat } from "./CollectionHead";
import { EntryCard } from "./EntryCard";
import { Avatars, Glyph, StatusPill, TagDot, ownImage } from "./EntryParts";
import { MixesRail } from "./MixesRail";
import { WeekCalendar } from "./WeekCalendar";
import { groupByDay, type ViewEntry } from "./entries";
import { useCollection } from "./useCollection";
import { useViewMode, type ViewMode } from "./useViewMode";
import { useIncremental } from "./useIncremental";
import { monthShort, weekdayShort } from "@/lib/date/words";
import { msg, t, tn } from "@/i18n";

/*
 * Shared multi-view body of /spaces/[space] and /vault/[...path] (Feinschliff Live, prototype SAMMLUNG): head with
 * breadcrumb, title, meta line ("18 Einträge · 6 heute · 16 offene Aufgaben") and the Liste / Raster / Zeitleiste
 * switch (L / G / T); filter buttons (Tags, Objekte, Mit Aufgaben, Typ) and the sort; Smart Knowledge Mixes as mini
 * tiles (a click filters by the mix); the calendar card (week / month, entries as coloured bullets, tasks with a real
 * checkbox); then the list with column header, the grid with covers or the timeline with the vertical accent line.
 * Multi-select, context menu and Alt+Enter split stay. Styles: fs-collections.css (scoped to [data-fs="collection"]).
 */

export interface SpaceFilter {
  label: string;
  cls: string;
  /** Link that removes the filter. */
  clearHref: string;
}

export interface SpaceViewProps {
  /** Persistence scope of the view choice. */
  scope: string;
  /** Density scope (plan 5.5: spaces:<key>); defaults to the view scope. */
  densityScope?: string;
  crumbs: Crumb[];
  title: ReactNode;
  help: string;
  /** Counters of the statistic line; computed from the entries when left out. */
  stats?: Stat[];
  entries: ViewEntry[];
  filters?: SpaceFilter[];
  resetHref: string;
  /** Extra block between the header and the entries (vault: subfolders). */
  before?: ReactNode;
  aside?: ReactNode;
  emptyText?: string;
  /** Headline of the empty state (default "Hier ist noch nichts"). */
  emptyTitle?: string;
  /** Buttons of the empty state; null hides them (default: reset filter + capture). */
  emptyActions?: ReactNode | null;
  /** G4: the entries are archived (Archiv view): menus offer "Zurückholen", a click explains instead of opening. */
  archived?: boolean;
  /** Smart Knowledge Mixes above the entries. */
  mixes?: boolean;
  /** Week calendar under the mixes (default on). */
  week?: boolean;
}

const MODES: { id: ViewMode; label: string; aria: string; key: string; Icon: typeof LayoutGrid }[] = [
  { id: "list", label: msg("List"), aria: "List View", key: "L", Icon: List },
  { id: "grid", label: msg("Grid"), aria: "Grid View", key: "G", Icon: LayoutGrid },
  { id: "timeline", label: msg("Timeline"), aria: "Timeline View", key: "T", Icon: Clock },
];

/** Registry type of an entry (filter chips match registry types). */
const entryType = (e: ViewEntry): string => e.dbType ?? registryTypeOfShell(e.kind);

const bare = (t: string) => t.replace(/^#/, "").toLowerCase();
/** A hashtag filter also matches its children (#ai matches #ai/mcp), like the Hashtags index and the mixes. */
const hasTag = (e: ViewEntry, tag: string) => e.tags.some((t) => bare(t.label) === bare(tag) || bare(t.label).startsWith(bare(tag) + "/"));
const openTasks = (e: ViewEntry) => (e.tasks ? e.tasks[1] - e.tasks[0] : 0);

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** "Today 09:12" / "Yesterday 21:30" / "Mon 16:00" / "Oct 20" for the Captured column and the card head. */
export function capturedLabel(date: string, time: string, today: string): string {
  if (date === today) return t("Today {time}", { time });
  const d = new Date(date + "T12:00:00Z");
  const days = Math.round((new Date(today + "T12:00:00Z").getTime() - d.getTime()) / 864e5);
  if (days === 1) return t("Yesterday {time}", { time });
  if (days > 1 && days < 7) return `${weekdayShort(d.getUTCDay())} ${time}`;
  return t("{month} {day}", { day: d.getUTCDate(), month: monthShort(d.getUTCMonth()) });
}

export function SpaceView(p: SpaceViewProps) {
  const router = useRouter();
  const { showToast, setCmode } = useShell();
  const [mode, setMode] = useViewMode(p.scope, "list");
  const view = mode ?? "list";
  const c = useCollection(p.entries, { archived: p.archived });
  const { density, setDensity } = useDensity(p.densityScope ?? p.scope, { drawerOpen: c.drawerOpen });
  const [type, setType] = useState("all");
  const [tag, setTag] = useState<string | null>(null);
  const [obj, setObj] = useState<string | null>(null);
  const [withTasks, setWithTasks] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  // Quick find over title, summary, tags and type: the fastest way through a long list (sticky while the editor is open).
  const [find, setFind] = useState("");
  const findRef = useRef<HTMLInputElement>(null);
  const virtuoso = useRef<TableVirtuosoHandle>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useEffect(() => setScroller(pageRef.current?.closest<HTMLElement>(".kx-scroll") ?? null), []);
  const today = MOCK_TODAY;

  // L / G / T switch the view.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const m = MODES.find((x) => x.key === e.key.toUpperCase());
      if (!m) return;
      e.preventDefault();
      setMode(m.id);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [setMode]);

  const all = c.rows;
  const chips = useMemo(() => typeChips(all.map(entryType)), [all]);
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) for (const t of e.tags) m.set(t.label, (m.get(t.label) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [all]);
  const objCounts = useMemo(() => {
    const m = new Map<string, { title: string; n: number }>();
    for (const e of all) for (const o of e.objects ?? []) m.set(o.id, { title: o.title, n: (m.get(o.id)?.n ?? 0) + 1 });
    return [...m].sort((a, b) => b[1].n - a[1].n || a[1].title.localeCompare(b[1].title));
  }, [all]);
  const anyWithTasks = useMemo(() => all.some((e) => openTasks(e) > 0), [all]);

  const list = useMemo(
    () =>
      sortEntries(
        all.filter(
          (e) =>
            matchesType(entryType(e), type) &&
            (!tag || hasTag(e, tag)) &&
            (!obj || (e.objects ?? []).some((o) => o.id === obj)) &&
            (!withTasks || openTasks(e) > 0) &&
            matchesFind(e, find),
        ),
        sort,
      ),
    [all, type, tag, obj, withTasks, sort, find],
  );

  const stats: Stat[] = useMemo(() => {
    if (p.stats) return p.stats;
    const fresh = all.filter((e) => e.date === today).length;
    const open = all.reduce((n, e) => n + openTasks(e), 0);
    const out: Stat[] = [{ value: all.length, label: tn(all.length, "entry", "entries") }];
    out.push({ value: fresh, label: t("today") });
    if (open) out.push({ value: open, label: tn(open, "open task", "open tasks") });
    return out;
  }, [p.stats, all, today]);

  const ids = useMemo(() => new Set(all.map((e) => e.id)), [all]);
  // Tasks of the calendar: every dated task on "Alle Einträge" (mixes), else the tasks of the listed entries.
  const plans = useMemo(
    () =>
      TASKS.filter((t) => t.due && (p.mixes || ids.has(t.sourceId))).map((t) => ({
        id: t.id,
        due: t.due,
        title: t.title,
        done: doneOverride[t.id] ?? t.done,
        sourceId: ids.has(t.sourceId) || p.mixes ? t.sourceId || undefined : undefined,
      })),
    [ids, p.mixes, doneOverride],
  );
  const live = isLiveData();
  // Optimistic: the checkbox flips at once; live mode persists it (and the checklist line in the source note).
  const toggleTask = useCallback(
    (id: string, done: boolean) => {
      setDoneOverride((d) => ({ ...d, [id]: done }));
      if (!live) return;
      void setActionItemDone(id, done).then((r) => {
        if (r.ok) return;
        setDoneOverride((d) => ({ ...d, [id]: !done }));
        showToast(t("Task not saved: {error}", { error: r.error }));
      });
    },
    [live, showToast],
  );
  const weekEntries = useMemo(() => list.map((e) => ({ id: e.id, date: e.date, time: e.time, title: e.title, color: e.tone.dot })), [list]);
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const openById = useCallback(
    (id: string) => {
      const e = byId.get(id);
      if (e) c.open(e);
    },
    [byId, c],
  );
  const activeId = all.find((e) => c.isActive(e))?.id ?? null;
  const pickDay = (ds: string) => {
    const vi = seq.findIndex((e) => e.date === ds);
    if (vi < 0) {
      showToast(t("No entries on this day in this view"));
      return;
    }
    if (virtual) {
      virtuoso.current?.scrollToIndex({ index: vi, align: "start" });
      return;
    }
    // Grid and timeline render lazily: the day may not be in the DOM yet.
    lazy.reveal(vi, () => document.querySelector<HTMLElement>(`[data-date="${ds}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const pickMix = (t: string) => {
    if (tag && bare(tag) === bare(t)) {
      setTag(null);
      return;
    }
    if (all.some((e) => hasTag(e, t))) setTag(t);
    else router.push(spaceHref("all", t));
  };

  const virtual = view === "list" && list.length > VIRTUAL_MIN && !!scroller;
  // Grid and timeline: the first rows render at once, more while scrolling (the list view is virtualised instead).
  const lazy = useIncremental(list.length, [p.scope, view, type, tag, obj, withTasks, sort, find].join("|"), { root: scroller });
  // The timeline shows days newest first whatever the sort, so its batches follow that order.
  const seq = useMemo(() => (view === "timeline" ? [...list].sort(newestFirst) : list), [view, list]);
  const shownList = useMemo(() => (virtual ? seq : seq.slice(0, lazy.shown)), [virtual, seq, lazy.shown]);
  const groups = useMemo(() => (view === "timeline" ? groupByDay(shownList, today) : []), [view, shownList, today]);
  // Day counts over the whole list (the last rendered day may be cut off by the lazy batch).
  const dayCount = useMemo(() => {
    const m = new Map<string, number>();
    if (view === "timeline") for (const e of list) m.set(e.date, (m.get(e.date) ?? 0) + 1);
    return m;
  }, [view, list]);

  // J / K step through the list while the editor is open (next / previous entry opens at once); F focuses the search.
  const listRef = useRef(list);
  listRef.current = list;
  const seqRef = useRef(seq);
  seqRef.current = seq;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f" && !e.shiftKey) {
        e.preventDefault();
        findRef.current?.focus();
        return;
      }
      if ((k !== "j" && k !== "k") || !c.drawerOpen) return;
      const rows = listRef.current;
      const at = rows.findIndex((x) => c.isActive(x));
      const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (k === "j" ? 1 : -1)))];
      if (!next || (at >= 0 && next === rows[at])) return;
      e.preventDefault();
      c.open(next);
      const i = seqRef.current.indexOf(next);
      if (virtual) virtuoso.current?.scrollIntoView({ index: i, behavior: "auto" });
      else {
        const id = CSS.escape(next.id);
        lazy.reveal(i, () => document.querySelector<HTMLElement>(`[data-entry-id="${id}"], [data-entry="${id}"]`)?.scrollIntoView({ block: "nearest" }));
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [c, virtual, lazy]);
  const empty = p.entries.length === 0;
  const filteredEmpty = !empty && list.length === 0;

  const viewSeg = (
    <div className="kc-viewseg" role="tablist" aria-label={t("View")}>
      {MODES.map((m) => (
        <button key={m.id} type="button" role="tab" aria-selected={view === m.id} aria-label={m.aria} title={`${t(m.label)}  ${m.key}`} onClick={() => setMode(m.id)}>
          <m.Icon aria-hidden />
          <span className="kc-l">{t(m.label)}</span>
        </button>
      ))}
    </div>
  );

  const anyClientFilter = type !== "all" || tag || obj || withTasks || find;
  const resetClient = () => {
    setFind("");
    setType("all");
    setTag(null);
    setObj(null);
    setWithTasks(false);
  };

  return (
    <div ref={pageRef} className="kc-page" data-fs="collection" data-density={density} data-collection={p.scope}>
      <CollectionHead
        crumbs={p.crumbs}
        title={p.title}
        stats={stats}
        help={p.help}
        aside={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {p.aside}
            {viewSeg}
          </span>
        }
      />

      <div className="kc-filters" role="toolbar" aria-label={t("Filter")}>
        <label className="kc-find">
          <Search aria-hidden />
          <input
            ref={findRef}
            type="search"
            value={find}
            placeholder={c.drawerOpen ? t("Search list  ·  J / K to step") : t("Search")}
            aria-label={t("Search in this view")}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (find) setFind("");
                else e.currentTarget.blur();
                e.stopPropagation();
              } else if (e.key === "Enter" && list[0]) {
                e.preventDefault();
                c.open(list[0]);
              }
            }}
          />
          {!find && <span className="kx-kbd">F</span>}
        </label>
        {tagCounts.length > 0 && (
          <FilterPopover
            label={tag ? tag.replace(/^#/, "") : "Tags"}
            icon={<Hash aria-hidden />}
            active={!!tag}
            search={t("Search hashtags …")}
            items={tagCounts.map(([t, n]) => ({ key: t, label: t.replace(/^#/, ""), count: n, checked: t === tag, icon: <Hash aria-hidden /> }))}
            onPick={(k) => setTag((cur) => (cur === k ? null : k))}
          />
        )}
        {objCounts.length > 0 && (
          <FilterPopover
            label={obj ? (objCounts.find(([id]) => id === obj)?.[1].title ?? t("Objects")) : t("Objects")}
            icon={<Users aria-hidden />}
            active={!!obj}
            search={t("Search objects …")}
            items={objCounts.map(([id, o]) => ({ key: id, label: o.title, count: o.n, checked: id === obj }))}
            onPick={(k) => setObj((cur) => (cur === k ? null : k))}
          />
        )}
        {anyWithTasks && (
          <button
            type="button"
            className={"kc-chip" + (withTasks ? " is-on" : "")}
            aria-pressed={withTasks}
            title={t("Only entries with open tasks")}
            onClick={() => setWithTasks((v) => !v)}
          >
            <SquareCheckBig aria-hidden />
            {t("With tasks")}
          </button>
        )}
        {chips.length > 2 && (
          <FilterPopover
            label={type === "all" ? t("Type") : (chips.find((ch) => ch.key === type)?.label ?? t("Type"))}
            icon={<Shapes aria-hidden />}
            active={type !== "all"}
            items={chips.map((ch) => ({ key: ch.key, label: ch.label, count: ch.count, checked: ch.key === type }))}
            onPick={(k) => setType((cur) => (cur === k ? "all" : k))}
          />
        )}
        <span className="kc-grow" />
        <FilterPopover
          label={SORT_LABEL[sort]}
          icon={<ChevronsUpDown aria-hidden />}
          items={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ key: k, label: SORT_LABEL[k], checked: k === sort }))}
          onPick={(k) => setSort(k as SortKey)}
        />
        <DensitySwitch value={density} onChange={setDensity} />
      </div>

      {(!!p.filters?.length || tag || obj) && (
        <div className="kc-activefilters">
          <span className="kc-meta">Filter:</span>
          {p.filters?.map((f) => (
            <Link key={f.label} href={f.clearHref} className="kc-chip is-on" aria-label={t("Remove filter {label}", { label: f.label })}>
              {f.label}
              <X aria-hidden />
            </Link>
          ))}
          {tag && (
            <button type="button" className="kc-chip is-on" aria-label={t("Remove filter {label}", { label: tag })} onClick={() => setTag(null)}>
              {tag}
              <X aria-hidden />
            </button>
          )}
          {obj && (
            <button type="button" className="kc-chip is-on" aria-label={t("Remove object filter")} onClick={() => setObj(null)}>
              {objCounts.find(([id]) => id === obj)?.[1].title ?? t("Object")}
              <X aria-hidden />
            </button>
          )}
        </div>
      )}

      {p.before}
      {c.selectionBar}

      {p.mixes && !c.drawerOpen && <MixesRail entries={all} active={tag} onPick={pickMix} />}
      {p.week !== false && !empty && (
        <WeekCalendar
          entries={weekEntries}
          plans={plans}
          today={today}
          forceClosed={c.drawerOpen}
          activeId={activeId}
          onOpen={openById}
          onPickDay={pickDay}
          onToggleTask={toggleTask}
        />
      )}

      {empty && (
        <div className="kc-section">
          <EmptyState
            title={p.emptyTitle ?? t("Nothing here yet")}
            actions={
              p.emptyActions !== undefined ? p.emptyActions ?? undefined : <>
                <Link href={p.resetHref} className="kx-btn kx-btn--secondary kx-btn--sm">
                  {t("Reset filters")}
                </Link>
                <button
                  type="button"
                  className="kx-btn kx-btn--primary kx-btn--sm"
                  onClick={() => {
                    setCmode("capture");
                    showToast(t("Type your thought below or tap the orb"));
                  }}
                >
                  {t("Capture a thought")}
                </button>
              </>
            }
          >
            {p.emptyText ??
              t("There are no entries yet for this combination of space, folder and hashtag. Kortex fills the space automatically as soon as something fitting comes in.")}
          </EmptyState>
        </div>
      )}

      {filteredEmpty && (
        <div className="kc-section kc-empty-line">
          {t("No entries for these filters.")}
          {anyClientFilter && (
            <button type="button" className="kc-chip" onClick={resetClient}>
              {t("Reset filters")}
            </button>
          )}
        </div>
      )}

      {mode && !empty && view === "grid" && (
        <div className="kc-grid" data-view="grid">
          {shownList.map((n) => (
            <EntryCard
              key={n.id}
              entry={n}
              data-date={n.date}
              when={capturedLabel(n.date, n.time, today)}
              active={c.isActive(n)}
              selected={c.sel.selected.has(n.id)}
              {...c.rowProps(n)}
            />
          ))}
        </div>
      )}

      {mode && !empty && view === "list" && list.length > 0 && (
        <HScroll className="kc-tbl-wrap">
          {virtual ? (
            <TableVirtuoso
              ref={virtuoso}
              customScrollParent={scroller!}
              data={list}
              context={{ c, today }}
              increaseViewportBy={400}
              computeItemKey={(_, n) => n.id}
              components={VIRTUAL_TABLE}
              fixedHeaderContent={ListHead}
              itemContent={(_, n) => <ListCells n={n} today={today} />}
            />
          ) : (
            <table className="kc-tbl" data-view="list">
              <thead>
                <ListHead />
              </thead>
              <tbody>
                {list.map((n) => (
                  <ListRow key={n.id} item={n} context={{ c, today }}>
                    <ListCells n={n} today={today} />
                  </ListRow>
                ))}
              </tbody>
            </table>
          )}
        </HScroll>
      )}

      {mode && !empty && view === "timeline" && (
        <div className="kc-tl" data-view="timeline">
          {groups.map((g) => (
            <section key={g.anchor} id={g.anchor} data-date={g.date} aria-label={g.label} style={{ scrollMarginTop: 8 }}>
              <div className="kc-tl-day">
                <span className="tc-micro">{g.label}</span>
                <span className="kc-count">{dayCount.get(g.date) ?? g.items.length}</span>
              </div>
              <div className="kc-tl-list">
                {g.items.map((n) => {
                  const img = ownImage(n.cover);
                  const sub = [n.domain, n.length?.label, n.tldr || n.facts?.line].filter(Boolean).join(" · ");
                  return (
                    <button key={n.id} type="button" className={"kc-tl-row" + (c.isActive(n) ? " is-on" : "")} aria-pressed={c.sel.selected.has(n.id) || undefined} {...c.rowProps(n)}>
                      <span className="kc-tl-time">{n.time}</span>
                      <span className="kc-tdot" aria-hidden />
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user covers come from arbitrary hosts
                        <img className="kc-tl-img" src={img} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <Glyph entry={n} className="kc-tl-img" />
                      )}
                      <span style={{ minWidth: 0 }}>
                        <span className="kc-tl-t kc-clamp1">{n.title}</span>
                        <span className="kc-tl-sub">
                          <b>{n.typeLabel}</b>
                          {sub && ` · ${sub}`}
                        </span>
                      </span>
                      <span className="kc-tl-end">
                        <Avatars objects={n.objects} max={3} />
                        <StatusPill status={n.status?.tone === "ok" ? undefined : n.status} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {mode && !empty && view !== "list" && lazy.more && <LoadMore sentinel={lazy.sentinel} shown={lazy.shown} total={list.length} onMore={() => lazy.reveal(lazy.shown)} />}
      {c.menus}
    </div>
  );
}

const newestFirst = (a: ViewEntry, b: ViewEntry) => (a.date === b.date ? (a.time < b.time ? 1 : a.time > b.time ? -1 : 0) : a.date < b.date ? 1 : -1);

/** End of a lazily rendered grid / timeline: the sentinel loads the next batch on its own, the button is the fallback. */
function LoadMore({ sentinel, shown, total, onMore }: { sentinel: (el: Element | null) => void; shown: number; total: number; onMore: () => void }) {
  return (
    <div ref={sentinel} className="kc-section kc-empty-line" data-load-more>
      {t("{n} of {total}", { n: shown, total })}
      <button type="button" className="kc-chip" onClick={onMore}>
        {t("Load more")}
      </button>
    </div>
  );
}

/** Lists longer than this render virtualised (react-virtuoso): only the visible rows plus a margin are in the DOM. */
const VIRTUAL_MIN = 60;

function matchesFind(e: ViewEntry, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const hay = [e.title, e.tldr, e.facts?.line, e.typeLabel, e.domain, ...e.tags.map((x) => x.label)].filter(Boolean).join(" ").toLowerCase();
  return t.split(/\s+/).every((w) => hay.includes(w));
}

type RowContext = { c: ReturnType<typeof useCollection>; today: string };

function ListHead() {
  return (
    <tr>
      <th className="kc-c-g" aria-label={t("Type")} />
      <th>{t("Title and key point")}</th>
      <th className="kc-c-tag">Tags</th>
      <th className="kc-c-task">{t("Tasks")}</th>
      <th className="kc-c-av">{t("Objects")}</th>
      <th className="is-r">{t("Captured")}</th>
    </tr>
  );
}

function ListCells({ n, today }: { n: ViewEntry; today: string }) {
  const take = n.tldr || n.facts?.line;
  return (
    <>
      <td className="kc-c-g" title={n.typeLabel}>
        <Glyph entry={n} />
      </td>
      <td className="kc-c-t">
        <span className="kc-li-t">
          <b className="kc-clamp1">{n.title}</b>
          <StatusPill status={n.status?.tone === "ok" ? undefined : n.status} />
        </span>
        <small className="kc-clamp1">{take || [n.typeLabel, n.domain].filter(Boolean).join(" · ")}</small>
      </td>
      <td className="kc-c-tag">{n.tags[0] ? <TagDot tag={n.tags[0].label} /> : null}</td>
      <td className="kc-c-task kc-num">{n.tasks ? `${n.tasks[0]}/${n.tasks[1]}` : "–"}</td>
      <td className="kc-c-av">
        <Avatars objects={n.objects} max={3} />
      </td>
      <td className="is-r kc-num kc-when">{capturedLabel(n.date, n.time, today)}</td>
    </>
  );
}

/** One list row: open on click / Enter, selection, context menu, drag to Favoriten (useCollection.rowProps). */
function ListRow({ item: n, context, children, ...rest }: { item: ViewEntry; context: RowContext; children?: ReactNode } & ComponentPropsWithoutRef<"tr">) {
  const { c } = context;
  const rp = c.rowProps(n);
  return (
    <tr
      {...rest}
      data-date={n.date}
      data-entry-id={n.id}
      tabIndex={0}
      draggable={rp.draggable}
      onDragStart={rp.onDragStart}
      className={[c.isActive(n) && "is-on", c.sel.selected.has(n.id) && "is-sel"].filter(Boolean).join(" ") || undefined}
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
      {children}
    </tr>
  );
}

const VIRTUAL_TABLE = {
  Table: forwardRef<HTMLTableElement, ComponentPropsWithoutRef<"table">>(function VTable(props, ref) {
    return <table {...props} ref={ref} className="kc-tbl" data-view="list" />;
  }),
  TableRow: function VRow({ item, context, ...rest }: { item: ViewEntry; context?: RowContext } & ComponentPropsWithoutRef<"tr">) {
    return <ListRow item={item} context={context!} {...rest} />;
  },
};
