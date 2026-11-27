"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Box, Clock, Hash, ListFilter, Network, RotateCcw, Scan, Search, SlidersHorizontal, Sparkles, Square, ZoomIn, ZoomOut } from "lucide-react";
import { TypeIcon } from "@/components/note/icons";
import { useLook } from "@/components/theme/look";
import { RuhePop } from "@/components/views/RuhePop";
import { LocationBar } from "@/components/shell/Bars";
import { MenuItem } from "@/components/ui/primitives";
import { ContextMenu, Kbd, TAG_DOMAINS, menuFor, type ActionId, type TagDomain } from "@kortex/ui";
import { Ico } from "@/components/shell/icons";
import { Pictogram } from "@/components/motion/Pictogram";
import { setFavorite } from "@/lib/api/actions";
import { announceFavorites } from "@/lib/shell/favorites";
import { linkItems } from "@/lib/api/graph-actions";
import { noteHrefById } from "@/lib/shell/routes";
import { isLiveData, NOTE_TYPES, noteById, type ItemType } from "@/lib/workspace-data";
import { useShell } from "@/lib/shell/store";
import { graphQueryString } from "@/server/graph/query";
import { DEFAULT_GRAPH_QUERY, KIND_BIT, type GraphData, type GraphNode, type GraphQuery } from "@/server/graph/types";
import { GraphCanvas, type GraphControls } from "./GraphCanvas";
import type { GraphMode } from "./graph-engine";
import { groupCounts, groupShown, neighboursOf, searchNodes, shapeOf, toggleTypeGroup, TYPE_GROUPS, useCanvasPalette } from "./graph-utils";
import { intlLocale, msg, t, tn, tx } from "@/i18n";

/*
 * Knowledge Graph (/graph): the user's items as nodes, linked by related ids, [[wiki-links]],
 * semantic similarity and shared tags / entities. Layout, edges and the node cap are computed on
 * the server (GET /api/graph); this component filters, pans / zooms and opens the note drawer on a
 * click. A node's size follows its number of connections.
 *
 * Tactile Craft v2 (dummy `Graph`): the canvas fills the window, the controls float above it as glass
 * HUDs (level 2): filter top left (type toggles with shape and count, Zeitraum, Thema, Semantisch),
 * search and zoom top right (`/` focuses the search), the inspector of the selected node (the note
 * open in the drawer) below it, legend and counters bottom left. Nodes are monochrome (circle entry,
 * square object); the accent marks only the selection and its edges.
 *
 * 0.6.1: the renderer is WebGL (GraphCanvas → graph-engine), 3D by default with a 2D switch that
 * flattens the graph onto the server's layout.
 */

type Ser = "open" | "linked" | "dismissed";

const DOMAIN_LABEL: Record<TagDomain, string> = {
  ai: msg("AI"),
  auto: msg("Automotive"),
  health: msg("Health"),
  food: msg("Food"),
  finance: msg("Finance"),
  strategy: msg("Strategy"),
};
const SINCE: { value: number | null; label: string; title: string }[] = [
  { value: 7, label: msg("7 d"), title: msg("Last 7 days") },
  { value: 30, label: msg("30 d"), title: msg("Last 30 days") },
  { value: 90, label: msg("90 d"), title: msg("Last 90 days") },
  { value: null, label: msg("Everything"), title: msg("All entries") },
];
/** Type toggles (the "Alle" group of the old tabs is "every toggle on"). */
const TYPE_CHIPS = TYPE_GROUPS.filter((g) => g.types.length > 0);
const ALL_KEYS = TYPE_CHIPS.map((g) => g.key);

const pairKey = (a: string, b: string) => `kortex.graph.ser.${a < b ? `${a}.${b}` : `${b}.${a}`}`;
const DOCK_KEY = "kortex.graph.serendipity.dock";
const MODE_KEY = "kortex.graph.mode";
const MIN_STAGE_H = 380;

function EmptyArt() {
  return (
    <svg viewBox="0 0 160 110" width={160} height={110} aria-hidden fill="none" className="kx-art-classic">
      <circle cx="80" cy="56" r="40" stroke="var(--hair-strong)" strokeWidth="1.5" />
      <circle cx="80" cy="56" r="26" stroke="var(--hair-strong)" strokeWidth="1.5" strokeDasharray="3 5" />
      <path d="M80 34l4.2 11 11 4.2-11 4.2-4.2 11-4.2-11-11-4.2 11-4.2z" fill="var(--accent)" opacity="0.9" />
      <rect x="114" y="36" width="8" height="8" rx="2" fill="var(--t3)" />
      <circle cx="46" cy="78" r="3" fill="var(--t3)" />
    </svg>
  );
}

/** Edge key of the legend: the kind shows in width and dash (all edges are drawn at the same opacity). */
function LegendItem({ label, width = 1, dashed, accent }: { label: string; width?: number; dashed?: boolean; accent?: boolean }) {
  return (
    <span className="gr-legend-item">
      <i
        aria-hidden
        style={{
          display: "block",
          width: 18,
          height: 0,
          borderTop: `1px ${dashed ? "dashed" : "solid"} ${accent ? "var(--accent-ink)" : "var(--edge)"}`,
          opacity: 0.7 * Math.min(1, width),
        }}
      />
      {label}
    </span>
  );
}

/** Shape swatch of a node kind (circle entry, square object). */
const Shape = ({ square, className = "" }: { square?: boolean; className?: string }) => (
  <span className={`gr-sh${square ? " gr-sh--square" : ""} ${className}`} aria-hidden />
);

/** Item types of the chosen groups, or null for "all types". */
function typesOf(keys: ReadonlySet<string>): ItemType[] | null {
  const out = TYPE_CHIPS.filter((g) => keys.has(g.key)).flatMap((g) => g.types);
  return out.length ? out : null;
}

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

export function GraphView({ initial }: { initial: GraphData }) {
  const { openNote, setSplit, showToast, setCmode, drawer } = useShell();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState<GraphQuery>(DEFAULT_GRAPH_QUERY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ser, setSer] = useState<Ser>("open");
  // Serendipity card: docked = compact glass bar, undocked = floating card.
  const [docked, setDocked] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile: the filter HUD starts folded
  const palette = useCanvasPalette();
  const [nodeMenu, setNodeMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const first = useRef(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const controls = useRef<GraphControls | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [stageH, setStageH] = useState(560);
  const [q, setQ] = useState("");
  const [qIdx, setQIdx] = useState(0);

  // The graph fills the main window from its top to the bottom edge; the orbit bar floats over it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      let scroller: HTMLElement | null = el.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      setStageH(Math.max(MIN_STAGE_H, Math.round(bottom - el.getBoundingClientRect().top)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Filters change the query; the server answers with the filtered, laid-out graph.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = graphQueryString(query);
        const res = await fetch(`/api/graph${qs ? `?${qs}` : ""}`, { signal: ctrl.signal, credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData((await res.json()) as GraphData);
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : t("Error"));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  // "/" focuses the node search (not while typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      setFiltersOpen(false);
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const [mode, setMode] = useState<GraphMode>("3d");
  const ruhe = useLook() === "ruhe";
  useEffect(() => {
    // Ruhe starts flat like the mockup; a mode chosen before wins in both looks.
    const flatFirst = document.documentElement.dataset.look !== "vivid";
    try {
      if (localStorage.getItem(DOCK_KEY) === "float") setDocked(false);
      const stored = localStorage.getItem(MODE_KEY);
      if (stored === "2d" || (!stored && flatFirst)) setMode("2d");
    } catch {
      /* storage blocked: stays docked, 3D (Ruhe: 2D) */
      if (flatFirst) setMode("2d");
    }
  }, []);
  const chooseMode = (m: GraphMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage blocked: the choice lasts this visit */
    }
  };
  const toggleDock = () => {
    const next = !docked;
    setDocked(next);
    try {
      localStorage.setItem(DOCK_KEY, next ? "dock" : "float");
    } catch {
      /* see above */
    }
  };

  const suggestion = data.suggestion;
  const sugKey = suggestion ? pairKey(suggestion.a, suggestion.b) : null;
  useEffect(() => {
    setSer("open");
    if (!sugKey) return;
    try {
      const v = sessionStorage.getItem(sugKey);
      if (v === "linked" || v === "dismissed") setSer(v);
    } catch {
      /* storage blocked: the suggestion shows again */
    }
  }, [sugKey]);

  const remember = (v: Ser) => {
    setSer(v);
    try {
      if (sugKey) sessionStorage.setItem(sugKey, v);
    } catch {
      /* see above */
    }
  };

  const link = async () => {
    if (!suggestion) return;
    if (isLiveData()) {
      const r = await linkItems(suggestion.a, suggestion.b);
      if (!r.ok) {
        showToast(t("Linking failed: {error}", { error: r.error }));
        return;
      }
    }
    const ia = data.nodes.findIndex((n) => n.id === suggestion.a);
    const ib = data.nodes.findIndex((n) => n.id === suggestion.b);
    if (ia >= 0 && ib >= 0)
      setData((d) => ({ ...d, edges: [...d.edges, [ia, ib, KIND_BIT.related, 100]], stats: { ...d.stats, edges: d.stats.edges + 1 } }));
    remember("linked");
    showToast(t("Backlink created between {a} and {b}", { a: suggestion.aTitle, b: suggestion.bTitle }));
  };
  const dismiss = () => {
    remember("dismissed");
    showToast(t("Suggestion hidden"));
  };

  // Type toggles are kept as group keys; the empty set is "all on" (query types null).
  const [typeKeys, setTypeKeys] = useState<Set<string>>(() => new Set());
  const toggleType = (key: string) => {
    const next = toggleTypeGroup(typeKeys, key, ALL_KEYS);
    setTypeKeys(next);
    setQuery((x) => ({ ...x, types: typesOf(next) }));
  };
  const toggleDomain = (d: TagDomain) =>
    setQuery((x) => {
      const cur = x.domains ?? [];
      const next = cur.includes(d) ? cur.filter((y) => y !== d) : [...cur, d];
      return { ...x, domains: next.length ? next : null };
    });
  const activeFilters = typeKeys.size + (query.domains?.length ?? 0);
  const filtered = activeFilters > 0 || query.sinceDays !== null;
  const reset = () => {
    setTypeKeys(new Set());
    setQuery((x) => ({ ...DEFAULT_GRAPH_QUERY, semantic: x.semantic }));
  };
  const resetChips = () => {
    setTypeKeys(new Set());
    setQuery((x) => ({ ...x, types: null, domains: null }));
  };

  // Counters: the current graph for visible groups; a switched-off group keeps its last count.
  const lastCounts = useRef<Record<string, number>>({});
  const counts = useMemo(() => {
    const now = groupCounts(data.nodes, TYPE_CHIPS);
    for (const k of ALL_KEYS) if (groupShown(typeKeys, k)) lastCounts.current[k] = now[k] ?? 0;
    return { ...lastCounts.current };
  }, [data.nodes, typeKeys]);

  const { stats } = data;
  const empty = data.nodes.length === 0;
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const a = suggestion ? byId.get(suggestion.a) : undefined;
  const b = suggestion ? byId.get(suggestion.b) : undefined;
  const pair: [GraphNode, GraphNode] | null = a && b ? [a, b] : null;
  const cardShown = !!suggestion && ser !== "dismissed";

  // Inspector: the node open in the drawer.
  const selIdx = drawer.id ? data.nodes.findIndex((n) => n.id === drawer.id) : -1;
  const sel = selIdx >= 0 ? data.nodes[selIdx]! : null;
  const nbs = useMemo(() => (selIdx >= 0 ? neighboursOf(selIdx, data.edges, data.nodes) : []), [selIdx, data.edges, data.nodes]);
  const selDegree = useMemo(() => (selIdx >= 0 ? neighboursOf(selIdx, data.edges, data.nodes, Infinity).length : 0), [selIdx, data.edges, data.nodes]);
  const take = sel ? noteById(sel.id)?.tldr : undefined;

  const hits = useMemo(() => searchNodes(data.nodes, q), [data.nodes, q]);
  const pick = (n: GraphNode) => {
    controls.current?.centerOn(n.id);
    openNote(n.id);
    setQ("");
    searchRef.current?.blur();
  };

  const semanticHint =
    query.semantic && stats.semantic === "error"
      ? t("Not available right now")
      : query.semantic && stats.semantic === "empty"
        ? t("No similar pairs (or no embeddings yet)")
        : null;
  const semanticHintLong =
    stats.semantic === "error" ? t("Semantic similarity is not available right now.") : t("No semantically similar pairs found (or no embeddings yet).");

  const filterHud = (
    <div className={`gr-hud gr-hud--filter tc-float${filtersOpen ? "" : " is-collapsed"}`} role="group" aria-label={t("Graph filters")}>
      <button type="button" className="gr-tg gr-hud-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
        <SlidersHorizontal className="kx-ico" aria-hidden style={{ width: 14, height: 14 }} />
        {activeFilters ? t("Filter · {n}", { n: activeFilters }) : t("Filter")}
      </button>
      <div className="gr-hud-body">
        <div className="e-micro">{t("Filter")}</div>
        {TYPE_CHIPS.map((g) => {
          const on = groupShown(typeKeys, g.key);
          return (
            <button key={g.key} type="button" className={`gr-tg${on ? "" : " is-off"}`} aria-pressed={on} onClick={() => toggleType(g.key)}>
              <Shape square={g.key === "objects"} />
              {t(g.label)}
              <span className="count">{counts[g.key] ?? 0}</span>
            </button>
          );
        })}
        <div className="tc-seg tc-seg--text gr-seg" role="group" aria-label={t("Period")}>
          {SINCE.map((s) => (
            <button key={s.label} type="button" aria-pressed={query.sinceDays === s.value} title={t(s.title)} onClick={() => setQuery((x) => ({ ...x, sinceDays: s.value }))}>
              {t(s.label)}
            </button>
          ))}
        </div>
        <div className="gr-sec">
          <div className="e-micro" id="gr-thema">
            {t("Topic")}
          </div>
          <div className="gr-domains" role="group" aria-labelledby="gr-thema">
            {TAG_DOMAINS.map((d) => {
              const on = !!query.domains?.includes(d);
              return (
                <button key={d} type="button" className="e-chip" aria-pressed={on} onClick={() => toggleDomain(d)}>
                  <i className="gr-dom-dot" aria-hidden style={on ? { background: "var(--accent)" } : undefined} />
                  {t(DOMAIN_LABEL[d])}
                </button>
              );
            })}
          </div>
        </div>
        <div className="gr-sec">
          <button
            type="button"
            role="switch"
            aria-checked={query.semantic}
            className={`gr-tg${query.semantic ? "" : " is-off"}`}
            title={semanticHint ? semanticHintLong : t("Connect entries with similar content (dashed)")}
            aria-describedby={semanticHint ? "kx-graph-semantic-hint" : undefined}
            onClick={() => setQuery((x) => ({ ...x, semantic: !x.semantic }))}
          >
            <i aria-hidden style={{ display: "block", width: 12, borderTop: "1px dashed var(--accent-ink)" }} />
            {t("Semantic")}
            <span className="count">{query.semantic ? t("on") : t("off")}</span>
          </button>
          {semanticHint && (
            <p id="kx-graph-semantic-hint" className="e-meta" style={{ margin: "2px 8px 0", fontSize: "calc(11px * var(--kx-fs, 1))", color: stats.semantic === "error" ? "var(--crit)" : undefined }}>
              {semanticHint}
            </p>
          )}
          {filtered && (
            <button type="button" className="e-link" style={{ margin: "6px 8px 0" }} onClick={reset}>
              {t("Reset filters")}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const searchBox = (
      <div className="gr-search">
        <Search className="kx-ico" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="gr-results"
          aria-label={t("Search nodes")}
          placeholder={t("Search nodes")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setQIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQ("");
              e.currentTarget.blur();
            } else if (e.key === "ArrowDown" && hits.length) {
              e.preventDefault();
              setQIdx((i) => (i + 1) % hits.length);
            } else if (e.key === "ArrowUp" && hits.length) {
              e.preventDefault();
              setQIdx((i) => (i - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter" && hits[qIdx]) {
              e.preventDefault();
              pick(hits[qIdx]!);
            }
          }}
        />
        {!q && <Kbd size="sm">/</Kbd>}
        {hits.length > 0 && (
          <div id="gr-results" className="kx-menu gr-results" role="listbox" aria-label={tx("hits", "Results")}>
            {hits.map((n, i) => (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={i === qIdx}
                className="kx-menu-item"
                style={i === qIdx ? { background: "var(--lum-3)" } : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(n)}
              >
                <Shape square={shapeOf(n.type) === "square"} className="gr-sh--dot" />
                <span className="e-clamp1" style={{ flex: 1 }}>
                  {n.label}
                </span>
                <span className="e-meta">{NOTE_TYPES[n.type]?.label ?? ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
  );

  // Ruhe: clusters by tag domain (colour + name) and the legend of the clusters in view.
  const domainCounts = useMemo(() => {
    const m = new Map<TagDomain, number>();
    for (const n of data.nodes) if (n.domain) m.set(n.domain, (m.get(n.domain) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [data.nodes]);
  const clusterNames = useMemo(
    () => (ruhe ? Object.fromEntries(domainCounts.filter(([, n]) => n >= 3).map(([d]) => [d, t(DOMAIN_LABEL[d])])) : null),
    [ruhe, domainCounts],
  );
  const since = SINCE.find((x) => x.value === query.sinceDays) ?? SINCE[SINCE.length - 1]!;
  const ruheBar = (
    <>
      <LocationBar
        icon={<Network aria-hidden size={14} strokeWidth={1.75} />}
        crumbs={[{ label: "Graph" }]}
        actions={
          <>
            {!empty && <div className="gr-rz-search">{searchBox}</div>}
            <RuhePop label={t("Types")} icon={<ListFilter aria-hidden size={14} strokeWidth={1.75} />} count={typeKeys.size}>
              {TYPE_CHIPS.map((g) => {
                const on = groupShown(typeKeys, g.key);
                return (
                  <button key={g.key} type="button" className="rz-pop-item" aria-pressed={on} onClick={() => toggleType(g.key)}>
                    <Shape square={g.key === "objects"} />
                    {t(g.label)}
                    <span className="rz-pop-c">{counts[g.key] ?? 0}</span>
                  </button>
                );
              })}
              <span className="rz-pop-sep" />
              <button
                type="button"
                role="switch"
                aria-checked={query.semantic}
                className="rz-pop-item"
                title={semanticHint ? semanticHintLong : t("Connect entries with similar content (dashed)")}
                onClick={() => setQuery((x) => ({ ...x, semantic: !x.semantic }))}
              >
                <i aria-hidden style={{ display: "block", width: 12, borderTop: "1px dashed var(--accent-ink)" }} />
                {t("Semantic")}
                <span className="rz-pop-c">{semanticHint ?? (query.semantic ? t("on") : t("off"))}</span>
              </button>
            </RuhePop>
            <RuhePop label={t("Tags")} icon={<Hash aria-hidden size={14} strokeWidth={1.75} />} count={query.domains?.length ?? 0}>
              {TAG_DOMAINS.map((d) => {
                const on = !!query.domains?.includes(d);
                return (
                  <button key={d} type="button" className="rz-pop-item" aria-pressed={on || !query.domains?.length} onClick={() => toggleDomain(d)}>
                    <i className="gr-rz-dot" aria-hidden style={{ background: `var(--tag-${d}-dot)` }} />
                    {t(DOMAIN_LABEL[d])}
                    <span className="rz-pop-c">{on ? t("on") : ""}</span>
                  </button>
                );
              })}
            </RuhePop>
            <RuhePop label={t(since.title)} icon={<Clock aria-hidden size={14} strokeWidth={1.75} />}>
              {(close) =>
                SINCE.map((x) => (
                  <button key={x.label} type="button" className="rz-pop-item" aria-pressed={query.sinceDays === x.value} onClick={() => (close(), setQuery((q) => ({ ...q, sinceDays: x.value })))}>
                    {t(x.title)}
                  </button>
                ))
              }
            </RuhePop>
          </>
        }
        meta={loading ? <span className="kx-spinner" aria-label={t("Loading")} style={{ margin: "0 4px" }} /> : undefined}
        more={
          <>
            <MenuItem onSelect={() => chooseMode(mode === "3d" ? "2d" : "3d")}>
              {mode === "3d" ? <Square aria-hidden size={14} strokeWidth={1.75} /> : <Box aria-hidden size={14} strokeWidth={1.75} />}
              {mode === "3d" ? t("Flat view") : t("Spatial view")}
            </MenuItem>
            <MenuItem closeOnClick={false} onSelect={() => controls.current?.zoomBy(1.35)}>
              <ZoomIn aria-hidden size={14} strokeWidth={1.75} />
              {t("Zoom in")}
            </MenuItem>
            <MenuItem closeOnClick={false} onSelect={() => controls.current?.zoomBy(1 / 1.35)}>
              <ZoomOut aria-hidden size={14} strokeWidth={1.75} />
              {t("Zoom out")}
            </MenuItem>
            <MenuItem onSelect={() => controls.current?.fit()}>
              <Scan aria-hidden size={14} strokeWidth={1.75} />
              {t("Fit the whole graph")}
            </MenuItem>
            {filtered && (
              <MenuItem onSelect={reset}>
                <RotateCcw aria-hidden size={14} strokeWidth={1.75} />
                {t("Reset filters")}
              </MenuItem>
            )}
          </>
        }
      />
    </>
  );

  const toolsHud = (
    <div className="gr-hud gr-hud--tools tc-float" role="toolbar" aria-label={t("Search and zoom")}>
      {searchBox}
      {loading && <span className="kx-spinner" aria-label={t("Loading")} style={{ margin: "0 4px" }} />}
      <div className="tc-seg tc-seg--text gr-mode" role="group" aria-label={t("View")}>
        {(["3d", "2d"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} title={m === "3d" ? t("Spatial view") : t("Flat view")} onClick={() => chooseMode(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <button type="button" className="tc-ibtn" aria-label={t("Zoom in")} data-tip={t("Zoom in")} onClick={() => controls.current?.zoomBy(1.35)}>
        <ZoomIn className="kx-ico gr-zoom-ico" aria-hidden />
      </button>
      <button type="button" className="tc-ibtn" aria-label={t("Zoom out")} data-tip={t("Zoom out")} onClick={() => controls.current?.zoomBy(1 / 1.35)}>
        <ZoomOut className="kx-ico gr-zoom-ico" aria-hidden />
      </button>
      <button type="button" className="tc-ibtn" aria-label={t("Fit the whole graph")} data-tip={t("Fit")} onClick={() => controls.current?.fit()}>
        <Scan className="kx-ico gr-zoom-ico" aria-hidden />
      </button>
    </div>
  );

  return (
    <div className={"gr-page" + (ruhe ? " gr-page--ruhe" : "")}>
      <h1 style={srOnly} data-testid="graph-title">
        Knowledge Graph
      </h1>
      {ruhe && ruheBar}
      <div ref={stageRef} className="gr-stage" style={{ height: stageH }}>
        {empty ? (
          <div className="kx-emptystate kx-in" style={{ position: "absolute", inset: "70px 16px auto", margin: "0 auto", maxWidth: 520 }}>
            <EmptyArt />
            <Pictogram kind={stats.total === 0 ? "idea" : "search"} className="kx-art-ruhe" />
            <strong className="kx-h-section">{stats.total === 0 ? t("Your graph is still empty") : t("No results for these filters")}</strong>
            <span className="kx-help" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", lineHeight: 1.4, maxWidth: 440 }}>
              {stats.total === 0
                ? t("As soon as you create notes, links and [[wiki links]], the web of your knowledge grows here. Kortex adds connections through tags and similar content.")
                : t("There are no entries with these filters. Widen the period or choose another topic.")}
            </span>
            <div className="kxh-row" style={{ gap: 8 }}>
              {filtered && (
                <button type="button" className="e-btn e-btn--ghost" onClick={reset}>
                  {t("Reset filters")}
                </button>
              )}
              {activeFilters > 0 && (
                <button type="button" className="e-btn" onClick={resetChips}>
                  {t("Clear type and topic only")}
                </button>
              )}
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
            </div>
          </div>
        ) : (
          <GraphCanvas
            data={data}
            palette={palette}
            activeId={drawer.id}
            loading={loading}
            height={stageH}
            mode={mode}
            onOpen={(id) => openNote(id)}
            onMenu={(id, at) => setNodeMenu({ id, at })}
            suggestion={ser === "dismissed" ? null : pair}
            suggestionOpen={ser === "open"}
            onLink={link}
            controlsRef={controls}
            clusters={clusterNames}
          />
        )}

        {!ruhe && filterHud}
        {!ruhe && !empty && toolsHud}

        {sel && ruhe && (
          <aside className="gr-rz-ins kx-in" aria-label={t("Selected node")}>
            <div className="gr-rz-ins-h">
              <span className="gr-rz-av" aria-hidden>
                {sel.type === "person" ? initials(sel.label) : <TypeIcon type={sel.type} size={15} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="gr-rz-ins-t">{sel.label}</div>
                <div className="gr-rz-ins-s">
                  {NOTE_TYPES[sel.type]?.label ?? sel.type} · {tn(selDegree, "{n} connection", "{n} connections")}
                </div>
              </div>
            </div>
            {take ? <div className="gr-rz-ins-ai">{take}</div> : <div className="gr-rz-ins-s">{t("Changed on {date}", { date: new Date(sel.updated).toLocaleDateString(intlLocale()) })}</div>}
            {nbs.length > 0 && (
              <>
                <div className="gr-rz-lab">{t("Strongest connections")}</div>
                {nbs.map((i) => {
                  const n = data.nodes[i]!;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className="gr-rz-link"
                      onClick={() => {
                        controls.current?.centerOn(n.id);
                        openNote(n.id);
                      }}
                    >
                      <TypeIcon type={n.type} size={14} />
                      <span className="e-clamp1">{n.label}</span>
                      <span className="gr-rz-n">{n.degree}</span>
                    </button>
                  );
                })}
              </>
            )}
            <div className="gr-rz-acts">
              <Link href={noteHrefById(sel.id)} className="rz-btn">
                {shapeOf(sel.type) === "square" ? t("Open dossier") : tx("verb", "Open")}
              </Link>
              <button type="button" className="rz-btn rz-btn--ghost" onClick={() => controls.current?.centerOn(sel.id)}>
                {t("Only neighbours")}
              </button>
            </div>
          </aside>
        )}

        {!empty && ruhe && (
          <div className="gr-rz-leg" aria-label={t("Legend")}>
            {error && <span style={{ color: "var(--crit)" }}>{t("Graph could not be updated ({error})", { error })}</span>}
            {domainCounts.slice(0, 6).map(([d]) => (
              <span key={d}>
                <i aria-hidden style={{ background: `var(--tag-${d}-dot)` }} />
                {t(DOMAIN_LABEL[d])}
              </span>
            ))}
            <span className="gr-rz-faint">
              {t("{nodes} entries · {edges} links", { nodes: stats.shown.toLocaleString(intlLocale()), edges: stats.edges.toLocaleString(intlLocale()) })}
              {stats.truncated && ` · ${t("{n} of {total}", { n: stats.limit, total: stats.matching })}`}
            </span>
          </div>
        )}

        {sel && !ruhe && (
          <aside className="gr-hud gr-hud--inspector tc-float kx-in" aria-label={t("Selected node")}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="e-micro" style={{ padding: 0, color: "var(--accent-ink)" }}>
                {NOTE_TYPES[sel.type]?.label ?? sel.type}
              </span>
              <span className="e-meta e-num" style={{ marginLeft: "auto", fontSize: "calc(11px * var(--kx-fs, 1))" }}>
                {tn(selDegree, "{n} connection", "{n} connections")}
              </span>
            </div>
            <div className="gr-ins-title">{sel.label}</div>
            {take ? (
              <div className="gr-ins-take">
                <Sparkles className="kx-ico" aria-hidden />
                <span>{take}</span>
              </div>
            ) : (
              <div className="e-meta" style={{ marginTop: 6 }}>
                {t("Changed on {date}", { date: new Date(sel.updated).toLocaleDateString(intlLocale()) })}
              </div>
            )}
            {nbs.length > 0 && (
              <div className="gr-ins-nb">
                {nbs.map((i) => {
                  const n = data.nodes[i]!;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className="gr-tg"
                      onClick={() => {
                        controls.current?.centerOn(n.id);
                        openNote(n.id);
                      }}
                    >
                      <Shape square={shapeOf(n.type) === "square"} />
                      <span className="e-clamp1">{n.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
        )}

        {!empty && !ruhe && (
          <div className="gr-hud gr-hud--legend tc-float" style={{ bottom: cardShown && docked ? 156 : 96 }} aria-label={t("Legend")}>
            <span className="e-meta e-num" aria-live="polite">
              {error ? <span style={{ color: "var(--crit)" }}>{t("Graph could not be updated ({error})", { error })} · </span> : null}
              {t("{nodes} nodes · {edges} edges", { nodes: stats.shown, edges: stats.edges })}
              {stats.truncated && <span title={t("{matching} entries match, the {limit} best connected are shown", { matching: stats.matching, limit: stats.limit })}> · {t("{n} of {total}", { n: stats.limit, total: stats.matching })}</span>}
            </span>
            <span className="gr-legend-item">
              <Shape /> {t("Entry")}
            </span>
            <span className="gr-legend-item">
              <Shape square /> {t("Object")}
            </span>
            <LegendItem label={t("Link")} />
            <LegendItem label={t("Semantic")} accent />
            <LegendItem label={t("Tag / entity")} width={0.6} />
            <span className="e-meta">
              {stats.edges === 0
                ? t("Create links, tags or [[wiki links]]")
                : mode === "3d"
                  ? t("Drag rotates, scroll zooms, click focuses")
                  : t("Drag moves, scroll zooms")}
            </span>
          </div>
        )}

        {cardShown && suggestion && (
          <div className={`gr-ser tc-float kx-in ${docked ? "gr-ser--dock" : "gr-ser--float"}`} style={docked ? { bottom: 96, left: "auto", width: "min(520px, calc(100% - 28px))" } : undefined}>
            <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 12, alignItems: "center" }}>
              <Sparkles className="kx-ico" aria-hidden style={{ color: "var(--accent-ink)" }} />
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <span className="e-meta e-clamp1">
                  {t("Serendipity · semantic similarity {value} · not linked yet", { value: suggestion.similarity.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                </span>
                <strong className={docked ? "e-clamp1" : undefined} style={{ fontSize: "calc(13px * var(--kx-fs, 1))", fontWeight: 500 }}>
                  {t("{a} and {b}", { a: suggestion.aTitle, b: suggestion.bTitle })}
                </strong>
              </div>
              <div className="kxh-row" style={{ gap: 6 }}>
                {ser === "open" && (
                  <>
                    <button type="button" className="e-btn" onClick={dismiss}>
                      {t("Ignore")}
                    </button>
                    <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={link}>
                      {t("Link entries")}
                    </button>
                  </>
                )}
                {ser === "linked" && <span className="kx-status kx-status--done">{t("Linked")}</span>}
                <button
                  type="button"
                  className="tc-ibtn tc-ibtn--sm"
                  aria-label={docked ? t("Undock card") : t("Dock card at the bottom")}
                  aria-pressed={docked}
                  title={docked ? t("Undock card") : t("Dock at the bottom")}
                  onClick={toggleDock}
                >
                  <Ico name={docked ? "expand" : "minimize"} size="sm" />
                </button>
              </div>
            </div>
            {!docked && (
              <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))", lineHeight: 1.4, color: "var(--t2)" }}>
                {t("Both entries cover similar content but do not refer to each other. A backlink makes the connection findable in the copilot and in the graph.")}
              </span>
            )}
          </div>
        )}
      </div>
      <ContextMenu
        at={nodeMenu?.at ?? null}
        label={t("Node")}
        sections={menuFor({ kind: "graph-node" })}
        onAction={(action: ActionId) => {
          const id = nodeMenu?.id;
          if (!id) return;
          if (action === "open") openNote(id);
          else if (action === "open-split") {
            openNote(id);
            setSplit(true);
          } else if (action === "copy-link") {
            void navigator.clipboard
              .writeText(`${window.location.origin}${noteHrefById(id)}`)
              .then(() => showToast(t("Link copied")), () => showToast(t("Link could not be copied")));
          } else if (action === "favorite" || action === "unfavorite") {
            const on = action === "favorite";
            showToast(on ? t("Marked as favorite") : t("Favorite removed"));
            if (isLiveData()) void setFavorite([id], on).then((r) => (r.ok ? announceFavorites() : showToast(t("Favorite not saved: {error}", { error: r.error }))));
          }
        }}
        onClose={() => setNodeMenu(null)}
      />
    </div>
  );
}

/** "Jonas Weber" → "JW". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const srOnly: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", margin: 0 };
