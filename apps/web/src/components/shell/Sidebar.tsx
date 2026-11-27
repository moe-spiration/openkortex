"use client";

import Link from "next/link";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { Tip } from "@/components/ui/primitives";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { reviewDue } from "@kortex/db/daily";
import { OBJECT_TYPES } from "@kortex/ui";
import {
  AUTO_SPACES,
  LIFE_AREAS,
  OBJECT_HUBS,
  PROFILE,
  SIDEBAR_TAGS,
  TOTAL_ENTRIES,
  VAULT_TREE,
  pillClass,
} from "@/lib/workspace-data";
import { lifeLongLabel, navLongLabel, spaceLongLabel } from "@/lib/shell/labels";
import { lifeHref, objectHref, routeInfo, spaceHref, vaultHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { useShellStatus } from "@/lib/shell/status";
import { useLifeScores } from "@/lib/shell/life-scores";
import { registryIcon } from "@/lib/shell/registry-icons";
import { type GardenerTone } from "@/lib/shell/status-core";
import { badgeValue, reviewTooltip } from "@/lib/shell/badges";
import { todayDate } from "@/lib/date/today";
import { useSettings } from "@/lib/settings/store";
import { useAgentJobs } from "@/lib/shell/agent-jobs-store";
import { stageOf } from "@/lib/tasks-board";
import { TASKS } from "@/lib/workspace-data";
import { NAV_GROUPS, TOOL_LONG_LABEL, type NavGroup } from "@/lib/shell/nav";
import { LIB_LENSES, type LibLens } from "@/lib/shell/prefs";
import { useFavorites } from "@/lib/shell/favorites";
import { ITEM_DRAG_TYPE } from "@/lib/shell/favorites-core";
import { Folder, GripVertical, LayoutGrid, Library, Settings, Users } from "lucide-react";
import { useLook } from "@/components/theme/look";
import { msg, t, tx } from "@/i18n";
import { Ico, type IconId } from "./icons";

/*
 * fx3 (device test 0.6.1): the fixed rows sit in four labelled groups from lib/shell/nav.ts (Heute, Erfassen &
 * Erledigen, Wissen, Rückblick); Spaces, Objects and Hashtags fold under "Wissen", Life under "Rückblick". The
 * weekly review is the journal's week tab, so its due badge sits on "Tagebuch". Scratchpad is a popup and has no
 * row (titlebar, orbit bar, Alt+J).
 *
 * Sidebar of the web workspace (Tactile Craft v2; dummy `Sidebar`): transparent on the frame (new notes start from
 * the titlebar's "Neu" button or Alt/Ctrl+N, see ./Titlebar.tsx), 28px rows (main navigation 13/400, tree rows 12/500), active row = --lum-2 with the specular edge
 * and a 2px accent bar. Badges only for values above zero (A-06) as quiet micro counts; Life shows no scores (goals and habits live in Griply) and
 * Life icons keep their area colours in a tinted glyph tile; all other icons are neutral. Groups remember their
 * state (Objects und Hubs and Hashtags start collapsed, A-09). Footer: avatar, name + sync state (AI Gardener
 * popover), Vault Explorer, settings, sign-out. Logo and the hide toggle live in the titlebar (./Titlebar.tsx).
 */

/** Same zone as the server and the shared today helper (lib/date/today.ts). */
const REVIEW_TZ = "Europe/Berlin";
/** Ruhe (mockup): the type lens lists the main kinds only; every other type stays one tab away in the view bar. */
const RUHE_TYPE_ROWS = ["all", "meetings", "articles", "books", "recipes", "notes"];
/** Ruhe (mockup): the object lens lists these kinds; goals and assets stay on /objects. */
const RUHE_OBJECT_ROWS = ["person", "organization", "project", "concept", "tool"];

function Badge({
  children,
  label,
  title,
  tone,
}: {
  children: ReactNode;
  label?: string;
  title?: string;
  tone?: "accent";
}) {
  return (
    <span
      className={"kx-sidebar-badge" + (tone === "accent" ? " is-accent" : "")}
      aria-label={label}
      title={title}
    >
      {children}
    </span>
  );
}

/** Gardener dot: synced green, busy amber, failures red. */
const GARDENER_DOT: Record<GardenerTone, string> = {
  synced: "var(--status-synced)",
  busy: "var(--status-processing)",
  error: "var(--status-urgent)",
};

function NavRow({
  href,
  label,
  icon,
  active,
  tint,
  tree,
  trailing,
  tooltip,
  lucide,
  glyph,
  railOnly,
}: {
  href: string;
  label: string;
  /** Long form of the short label (V2-04a); defaults to the label. */
  tooltip?: string;
  icon: IconId;
  /** Type registry icon name (registry spaces); replaces `icon`. */
  lucide?: string;
  /** Own lucide component (Ruhe rows the registries lack); replaces `icon`. */
  glyph?: typeof Library;
  active: boolean;
  /** Life area colour: the icon sits in a tile tinted with it. */
  tint?: string;
  /** Tree row (Life, Spaces, Objects): 12/500. */
  tree?: boolean;
  trailing?: ReactNode;
  /** Only shown in the icon rail (e.g. the Life icon while the dock header is hidden). */
  railOnly?: boolean;
}) {
  const Registry = glyph ?? (lucide ? registryIcon(lucide) : null);
  return (
    <NavLink
      href={href}
      className={
        "kx-row kxb" +
        (tree ? " is-tree" : "") +
        (active ? " is-active" : "") +
        (railOnly ? " kx-rail-only" : "")
      }
      aria-current={active ? "page" : undefined}
      title={tooltip ?? label}
    >
      {Registry ? (
        <Registry aria-hidden className="kx-ico" />
      ) : tint ? (
        <span className="tc-lifeg" style={{ "--lc": tint } as CSSProperties}>
          <Ico name={icon} />
        </span>
      ) : (
        <Ico name={icon} />
      )}
      <span className="kx-truncate">{label}</span>
      {trailing}
    </NavLink>
  );
}

/**
 * Sidebar link without prefetch-on-render (abnahmebericht P7, point 5): the 22 sidebar links used to
 * prefetch as soon as the page loaded, and a click right after that waited behind them (2-3 s locally,
 * 6-7 s in production). Now a link prefetches when the pointer rests on it or it gets keyboard focus,
 * which still gives the likely next route a head start.
 */
function NavLink({
  href,
  onMouseEnter,
  onFocus,
  ...rest
}: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  const done = useRef(false);
  const warm = () => {
    if (done.current) return;
    done.current = true;
    router.prefetch(href);
  };
  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}

function VaultTree({ activePath }: { activePath: string | null }) {
  const { prefs, toggleTree } = useShell();
  const rows = VAULT_TREE.filter((f) => !f.parent || prefs.tree[f.parent]);
  return (
    <div className="kx-tree">
      {rows.map((f) => {
        const open = !!prefs.tree[f.id];
        const active = activePath === f.path;
        return (
          <NavLink
            key={f.id}
            href={vaultHref(f.path)}
            className={"kx-row kxb" + (active ? " is-active" : "") + (open ? " is-open" : "")}
            aria-current={active ? "page" : undefined}
            aria-expanded={f.hasChildren ? open : undefined}
            style={{ "--d": f.depth, height: 28 } as CSSProperties}
            onClick={() => f.hasChildren && toggleTree(f.id)}
          >
            <span
              className="kx-chev"
              style={{
                display: "inline-flex",
                width: 16,
                height: 16,
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
              }}
            >
              {f.hasChildren && <Ico name="chev-r" size="sm" />}
            </span>
            <Ico name="folder" />
            <span
              className="kx-truncate kx-mono"
              style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }}
            >
              {f.name}
            </span>
          </NavLink>
        );
      })}
    </div>
  );
}

function TagPills({ activeTag }: { activeTag: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const info = routeInfo(pathname);
  const space = info.view === "spaces" ? (info.rest[0] ?? "all") : "all";
  return (
    <div className="kxh-wrap" style={{ padding: "4px 8px 8px" }}>
      {SIDEBAR_TAGS.map((tag) => {
        const on = activeTag === tag;
        return (
          <button
            key={tag}
            type="button"
            className={`kx-pill kxb ${pillClass(tag)}`}
            style={
              on ? { background: "var(--accent-ai-soft)", color: "var(--text-primary)" } : undefined
            }
            aria-pressed={on}
            title={t("Filter by {tag}", { tag })}
            onClick={() => router.push(spaceHref(space, on ? null : tag))}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

function TagPillsFromUrl() {
  const params = useSearchParams();
  const pathname = usePathname();
  const tag = pathname.startsWith("/spaces") ? params.get("tag") : null;
  return <TagPills activeTag={tag} />;
}

/**
 * Footer icon button with a popover (Vault Explorer, AI Gardener). The popover is portalled to <body>
 * because the sidebar clips its overflow; closes on outside click and Escape, focus returns to the button.
 */
function FooterPopover({
  icon,
  label,
  title,
  alert,
  width = 300,
  trigger,
  children,
}: {
  icon: IconId;
  label: string;
  title: string;
  /** Red dot on the icon (e.g. Gardener errors). */
  alert?: boolean;
  width?: number;
  /** Custom trigger content (class tc-sb-who) instead of the icon button. */
  trigger?: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r)
      setPos({
        left: Math.max(8, Math.min(r.left - 8, window.innerWidth - width - 8)),
        bottom: window.innerHeight - r.top + 8,
      });
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open, width]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={trigger ? "tc-sb-who" : "tc-ibtn tc-ibtn--sm kx-sidebar-foot-btn"}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger ?? <Ico name={icon} />}
        {alert && !trigger && <span className="kx-sidebar-alert" aria-hidden />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={label}
            className="kx-menu kx-in kx-sidebar-popover"
            style={{ position: "fixed", left: pos.left, bottom: pos.bottom, width, zIndex: 40 }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Bibliothek view menu (variant A2): label, icon and one line on what the view shows. */
const LENS_INFO: Record<LibLens, { label: string; icon: IconId; desc: string }> = {
  types: { label: msg("Types"), icon: "layers", desc: msg("By kind: note, meeting, article …") },
  objects: { label: msg("Objects"), icon: "boxes", desc: msg("People, projects, goals …") },
  folders: { label: "Vault", icon: "vault", desc: msg("Folders, as filed in the vault") },
};

/** Drag type of a library entry dragged onto the Favoriten (set by the collection rows). */

/**
 * Favoriten (variant A2): the user's starred items in their own order. Drag a row to sort it (Alt+↑/↓ does the
 * same), the x removes the star, and an entry dragged in from a list is starred where it is dropped. "Bearbeiten"
 * keeps the grips and the x visible (touch, discoverability); "Alle" opens the full Favoriten page.
 */
function FavoritesSection() {
  const { openNote, drawer } = useShell();
  const fav = useFavorites();
  const [edit, setEdit] = useState(false);
  const [drop, setDrop] = useState<{ at: number } | null>(null);
  const dragId = useRef<string | null>(null);
  const zone = useRef<HTMLDivElement>(null);

  const indexAt = (e: React.DragEvent) => {
    const rows = Array.from(zone.current?.querySelectorAll<HTMLElement>("[data-fav]") ?? []);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return rows.length;
  };
  const accepts = (e: React.DragEvent) =>
    dragId.current !== null || e.dataTransfer.types.includes(ITEM_DRAG_TYPE);

  return (
    <section className="tc-sb-sec kx-rail-hide" aria-label={t("Favorites")}>
      <div className="kx-sidebar-group tc-sb-head">
        <span>{t("Favorites")}</span>
        <span className="tc-sb-head-acts">
          {fav.list.length > 0 && (
            <button
              type="button"
              className="tc-sb-link"
              aria-pressed={edit}
              onClick={() => setEdit((v) => !v)}
            >
              {edit ? tx("finish", "Done") : t("Edit")}
            </button>
          )}
          <NavLink href="/favorites" className="tc-sb-link" title={t("All favorites")} aria-label={t("All favorites")}>
            {t("All")}
          </NavLink>
        </span>
      </div>
      <div
        ref={zone}
        className={
          "tc-favs" + (edit ? " is-edit" : "") + (drop && fav.list.length === 0 ? " is-drop" : "")
        }
        onDragOver={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = dragId.current ? "move" : "copy";
          const at = indexAt(e);
          if (drop?.at !== at) setDrop({ at });
        }}
        onDragLeave={(e) => {
          if (!zone.current?.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
        onDrop={(e) => {
          if (!accepts(e)) return;
          e.preventDefault();
          const at = indexAt(e);
          const own = dragId.current;
          const ext = e.dataTransfer.getData(ITEM_DRAG_TYPE);
          if (own) fav.move(own, at);
          else if (ext) void fav.pin(ext, at);
          dragId.current = null;
          setDrop(null);
        }}
      >
        {fav.list.map((f, i) => {
          const Icon = registryIcon(f.icon);
          const active = drawer.id === f.id;
          return (
            <div
              key={f.id}
              data-fav={f.id}
              className={
                "kx-row kxb tc-fav" +
                (active ? " is-active" : "") +
                (drop?.at === i ? " is-drop-before" : "") +
                (drop?.at === fav.list.length && i === fav.list.length - 1 ? " is-drop-after" : "")
              }
              draggable
              onDragStart={(e) => {
                dragId.current = f.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", f.title);
              }}
              onDragEnd={() => {
                dragId.current = null;
                setDrop(null);
              }}
            >
              <span className="tc-fav-grip" aria-hidden>
                <GripVertical size={12} />
              </span>
              <button
                type="button"
                className="tc-fav-open"
                title={t("Open {title} (Alt+↑/↓ moves it)", { title: f.title })}
                aria-current={active ? "true" : undefined}
                onClick={() => openNote(f.id)}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault();
                  fav.move(f.id, e.key === "ArrowUp" ? i - 1 : i + 2);
                  requestAnimationFrame(() =>
                    zone.current
                      ?.querySelector<HTMLElement>(`[data-fav="${CSS.escape(f.id)}"] .tc-fav-open`)
                      ?.focus(),
                  );
                }}
              >
                <Icon aria-hidden className="kx-ico" />
                <span className="kx-truncate">{f.title}</span>
              </button>
              <button
                type="button"
                className="tc-fav-x"
                aria-label={t("Unpin {title} from favorites", { title: f.title })}
                title={t("Unpin from favorites")}
                onClick={() => void fav.unpin(f.id)}
              >
                <Ico name="x" size="sm" />
              </button>
            </div>
          );
        })}
        {!fav.loading && fav.list.length === 0 && (
          <p className="tc-fav-empty">{t("Set the star in the editor or drag an entry here.")}</p>
        )}
      </div>
    </section>
  );
}

/**
 * Bibliothek header with the lens switch (Typen, Ordner, Objekte, Tags); the choice is remembered.
 * All four lenses sit side by side as one flat segment (base-ui ToggleGroup: arrow keys move, Enter/Space picks), so a
 * switch is one click and the current lens is always visible; the old dropdown needed two clicks and hid the options.
 * The one-line descriptions moved into the tooltips.
 */
/** Ruhe lens icons (mockup): library shelf for the types, people for the objects, a folder for the vault. */
const RUHE_LENS_ICON: Record<LibLens, typeof Library> = { types: Library, objects: Users, folders: Folder };

function LibraryHead({ count }: { count: string | null }) {
  const { prefs, setLibLens } = useShell();
  const look = useLook();
  // Key chords (mockup lens variant A): G T types, G O objects, G V vault; never while typing.
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        armed = Date.now();
        return;
      }
      if (!armed || Date.now() - armed > 900) return;
      armed = 0;
      const lens: LibLens | null = k === "t" ? "types" : k === "o" ? "objects" : k === "v" ? "folders" : null;
      if (!lens) return;
      e.preventDefault();
      setLibLens(lens);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setLibLens]);
  // Classic: a labelled segment under the header. Ruhe (variant A, decided 2026-11-26): the same toggles as three icons inside
  // the header row with a sliding pill. Both are rendered and CSS picks by <html data-look>, so hydration never differs.
  return (
    <div className="tc-lib-head kx-rail-hide">
      <div className="tc-lib-row">
        <span className="tc-lib-t">{t("Library")}</span>
        {count && <span className="kx-count">{count}</span>}
      </div>
      <ToggleGroup
        className="tc-lens"
        aria-label={t("Show library by")}
        value={[prefs.libLens]}
        style={{ "--lens-i": LIB_LENSES.indexOf(prefs.libLens) } as CSSProperties}
        onValueChange={(v) => {
          const next = v[0] as LibLens | undefined;
          if (next) setLibLens(next);
        }}
      >
        <span className="tc-lens-pill" aria-hidden />
        {LIB_LENSES.map((l) => {
          const it = LENS_INFO[l];
          return (
            <Tip key={l} label={t(it.desc)} side="bottom">
              <Toggle value={l} data-lens={l} aria-label={t(it.label)}>
                {look === "ruhe" ? (
                  (() => {
                    const L = RUHE_LENS_ICON[l];
                    return <L aria-hidden className="kx-ico tc-lens-ico" />;
                  })()
                ) : (
                  <Ico name={it.icon} className="tc-lens-ico" />
                )}
                <span>{t(it.label)}</span>
              </Toggle>
            </Tip>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const info = routeInfo(pathname);
  const { prefs, toggleRail, toggleSection, setTheme } = useShell();
  const status = useShellStatus();
  const look = useLook();
  const ruhe = look === "ruhe";
  const { user, loading: settingsLoading } = useSettings();
  // Live: which areas are active (lib/data/life.ts); null = mock or still loading.
  const lifeScores = useLifeScores();
  const lifeRows = LIFE_AREAS.filter(
    (a) =>
      (a.key === "overview" ? !ruhe : true) &&
      (a.key === "overview" ||
      !lifeScores ||
      lifeScores.find((x) => x.key === a.key)?.active !== false),
  );
  // W6/A-07: the review day from reviewDue() (time zone aware); no badge while the settings load.
  const due = settingsLoading ? null : reviewDue(todayDate(), REVIEW_TZ, user.weekly_digest_day);
  const { jobs: agentJobs } = useAgentJobs();
  const gardener = status.gardener;
  const { sections } = prefs;
  const restPath = info.rest.join("/");
  const [mainGroup, toolGroup] = NAV_GROUPS as [NavGroup, NavGroup];

  const navBadge = (id: string, fixed?: string) => {
    if (id === "inbox") {
      const v = badgeValue(status.inboxCount);
      return v ? (
        <Badge tone="accent" label={t("{count} in progress", { count: v })}>
          {v}
        </Badge>
      ) : null;
    }
    // The weekly review is the journal week tab: its due badge sits on "Tagebuch".
    if (id === "journal")
      return due ? (
        <Badge tone="accent" label={reviewTooltip(due)} title={reviewTooltip(due)}>
          {due.weekdayShort}
        </Badge>
      ) : null;
    // Suggestions Kortex found and nobody decided on yet.
    if (id === "tasks") {
      const v = badgeValue(TASKS.filter((x) => stageOf({ done: !!x.done, ai: x.ai, accepted: !!x.accepted, assignee: x.assignee, ...(x.exportedAt ? { exportedAt: x.exportedAt } : {}) }) === "suggested").length);
      return v ? (
        <Badge tone="accent" label={t("{count} suggestions to decide", { count: v })}>
          {v}
        </Badge>
      ) : null;
    }
    // Results of the agent that wait for a confirmation.
    if (id === "agent") {
      const v = badgeValue(agentJobs.filter((j) => j.status === "waiting").length);
      return v ? (
        <Badge tone="accent" label={t("{count} results wait for you", { count: v })}>
          {v}
        </Badge>
      ) : null;
    }
    return fixed ? <Badge>{fixed}</Badge> : null;
  };

  const lens = prefs.libLens;
  const libCount =
    lens === "types"
      ? badgeValue(TOTAL_ENTRIES)
      : lens === "objects"
        ? badgeValue(OBJECT_HUBS.reduce((n, h) => n + (h.count ?? 0), 0))
        : null;

  const library = (
    <section className="tc-sb-sec tc-lib" aria-label={t("Library")}>
      <LibraryHead count={libCount} />
      {lens === "types" &&
        AUTO_SPACES.filter((s) => !ruhe || RUHE_TYPE_ROWS.includes(s.key)).map((s) => {
          const n = badgeValue(s.count);
          return (
            <NavRow
              key={s.key}
              href={spaceHref(s.key)}
              label={s.label}
              tooltip={spaceLongLabel(s.key, s.label)}
              icon={s.icon}
              lucide={s.lucide}
              glyph={ruhe && s.key === "all" ? Library : undefined}
              tree
              active={info.view === "spaces" && (info.rest[0] ?? "all") === s.key}
              trailing={n ? <span className="kx-count">{n}</span> : null}
            />
          );
        })}
      {lens === "folders" && <VaultTree activePath={info.view === "vault" ? restPath : null} />}
      {lens === "objects" && (
        <>
          {/* /objects redirects to the first object type, whose own row below then shows as active.
              Ruhe (mockup): "Alle Einträge" first, then the five main object kinds; the others stay on /objects. */}
          {ruhe ? (
            <NavRow
              href={spaceHref("all")}
              label={t("All entries")}
              icon="zap"
              glyph={Library}
              tree
              active={info.view === "spaces" && (info.rest[0] ?? "all") === "all"}
              trailing={badgeValue(TOTAL_ENTRIES) ? <span className="kx-count">{badgeValue(TOTAL_ENTRIES)}</span> : null}
            />
          ) : (
            <NavRow
              href="/objects"
              label={t("All objects")}
              tooltip={t("All objects (70_Objects)")}
              icon="boxes"
              tree
              active={false}
            />
          )}
          {(ruhe ? RUHE_OBJECT_ROWS.map((k) => OBJECT_HUBS.find((h) => h.type === k)).filter((h): h is (typeof OBJECT_HUBS)[number] => !!h) : OBJECT_HUBS).map((h) => {
            const Icon = OBJECT_TYPES[h.type].Icon;
            const active = info.view === "objects" && info.rest[0] === h.type;
            const n = badgeValue(h.count);
            return (
              <NavLink
                key={h.type}
                href={objectHref(h.type)}
                className={"kx-row kxb is-tree" + (active ? " is-active" : "")}
                aria-current={active ? "page" : undefined}
                title={h.label}
              >
                <Icon aria-hidden className="kx-ico" />
                <span className="kx-truncate">{h.label}</span>
                {n && <span className="kx-count">{n}</span>}
              </NavLink>
            );
          })}
        </>
      )}
    </section>
  );

  // Tags (2026-11-10): out of the Bibliothek lenses into their own collapsible section; the state is remembered.
  const tagCount = badgeValue(SIDEBAR_TAGS.length);
  const tags = (
    <section className="tc-sb-sec tc-tags kx-rail-hide" aria-label="Tags">
      <button
        type="button"
        className="kxb kx-sidebar-group kx-group-btn tc-tags-btn"
        aria-expanded={sections.tags}
        aria-label={sections.tags ? t("Collapse tags") : t("Expand tags")}
        onClick={() => toggleSection("tags")}
      >
        <Ico name="chev-d" />
        <span>Tags</span>
        {tagCount && <span className="kx-count">{tagCount}</span>}
      </button>
      {sections.tags && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavRow
            href="/hashtags"
            label={t("All hashtags")}
            tooltip={t("Hashtag index with count and history")}
            icon="hash"
            tree
            active={info.view === "hashtags"}
          />
          <Suspense fallback={<TagPills activeTag={null} />}>
            <TagPillsFromUrl />
          </Suspense>
        </div>
      )}
    </section>
  );

  const lifeSection = (
        <section className="tc-sb-life" aria-label="Life">
          <button
            type="button"
            className="kxb kx-sidebar-group kx-group-btn tc-sb-life-btn kx-rail-hide"
            aria-expanded={sections.life}
            aria-label={sections.life ? t("Collapse Life") : t("Expand Life")}
            onClick={() => toggleSection("life")}
          >
            <Ico name="chev-u" />
            <span>Life</span>
          </button>
          {ruhe && (
            <span className="tc-sb-head-acts tc-life-acts">
              <NavLink href={lifeHref("overview")} className="tc-sb-link" title={t("Life: overall view of all areas")} aria-label={t("Life: overall view of all areas")}>
                <LayoutGrid aria-hidden className="kx-ico" />
              </NavLink>
            </span>
          )}
          {sections.life && (
            <div className="tc-sb-life-list">
              {lifeRows.map((a) => {
                return (
                  <NavRow
                    key={a.key}
                    href={lifeHref(a.key)}
                    label={a.key === "overview" ? t("Overall view") : a.label}
                    tooltip={
                      a.key === "overview"
                        ? t("Life: overall view of all areas")
                        : lifeLongLabel(a.key, a.label)
                    }
                    icon={a.key === "overview" ? "grid" : a.icon}
                    tree
                    // Life icons keep their area colours (spec W2/W4) in a tinted tile; the overview is neutral.
                    tint={a.key === "overview" ? undefined : `var(--tag-${a.tone}-dot)`}
                    active={info.view === "life" && (info.rest[0] ?? "overview") === a.key}
                  />
                );
              })}
            </div>
          )}
          <NavRow
            href={lifeHref("overview")}
            label="Life"
            icon="life"
            active={info.view === "life"}
            tooltip={t("Life areas")}
            railOnly
          />
        </section>
  );

  return (
    <aside className="kx-sidebar" aria-label={t("Sidebar")} data-ruhe-side={ruhe ? "" : undefined}>
      {/* Icon rail (Settings > Kompakte Seitenleiste): one button to widen it again. */}
      <button
        type="button"
        className="kx-row kxb kx-rail-only"
        title={t("Expand sidebar")}
        aria-label={t("Expand sidebar")}
        onClick={toggleRail}
      >
        <Ico name="rail" />
      </button>

      <nav className="kx-scroll kx-sidebar-nav" aria-label={t("Navigation")}>
        <div role="group" aria-label={mainGroup.label} className="kx-nav-group tc-sb-main">
          {mainGroup.items.map((r) => (
            <NavRow
              key={r.id}
              href={r.href}
              label={r.label}
              tooltip={navLongLabel(r.id, r.label)}
              icon={r.icon}
              active={info.view === r.id || (r.id === "journal" && info.view === "review")}
              trailing={navBadge(r.id, r.badge)}
            />
          ))}
        </div>
        <FavoritesSection />
        {library}
        {/* Ruhe (mockup): no tag group in the sidebar (hashtags: the palette, /hashtags, the view bar filter); Life
            follows the library inside the scrolling list, so the tools and the profile stay visible at the bottom. */}
        {!ruhe && tags}
        {ruhe && lifeSection}
      </nav>

      {/* A2: Life and the tools are pinned at the bottom, just above the profile line. */}
      <div className="tc-sb-dock">
        {!ruhe && lifeSection}
        <div role="group" aria-label={toolGroup.label} className="tc-sb-tools-wrap">
          <div className="kx-sidebar-group kx-rail-hide tc-sb-tools-h">{toolGroup.label}</div>
          <div className="tc-sb-tools">
            {toolGroup.items.map((r) => (
              <NavRow
                key={r.id}
                href={r.href}
                label={r.label}
                tooltip={TOOL_LONG_LABEL[r.id] ?? r.label}
                icon={r.icon}
                active={info.view === r.id}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="kx-profile kx-sidebar-foot">
        <NavLink
          href="/settings?section=profile"
          className="kxb kx-sidebar-avatar"
          aria-label={t("Profile and settings")}
          title={t("Profile and settings")}
        >
          {PROFILE.initial}
        </NavLink>
        <span className="kx-rail-hide" style={{ display: "contents" }}>
          <FooterPopover
            icon="sparkles"
            label="AI Gardener"
            title={gardener.label}
            trigger={
              <>
                <span className="tc-sb-name">{PROFILE.name}</span>
                <span className="tc-sb-state">
                  <i
                    className="tc-sync-dot"
                    style={{ background: GARDENER_DOT[gardener.tone] }}
                    aria-hidden
                  />
                  <span className="kx-truncate">
                    {gardener.label.replace(/^AI Gardener · /, "")}
                  </span>
                </span>
              </>
            }
          >
            {(close) => (
              <div style={{ display: "grid", gap: 8, padding: "6px 8px" }}>
                <div className="kxh-row" style={{ gap: 8 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      flex: "none",
                      background: GARDENER_DOT[gardener.tone],
                    }}
                  />
                  <span
                    style={{
                      fontSize: "calc(13px * var(--kx-fs, 1))",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {gardener.label}
                  </span>
                </div>
                <p className="kx-meta" style={{ margin: 0 }}>
                  {gardener.detail}
                </p>
                <div className="kxh-row" style={{ gap: 6 }}>
                  <NavLink
                    href="/inbox"
                    className="kx-btn kx-btn--secondary kx-btn--sm"
                    onClick={close}
                  >
                    {t("Open Inbox")}
                  </NavLink>
                </div>
              </div>
            )}
          </FooterPopover>
          {/* Feinschliff A2: the theme switch moved here from the titlebar. Ruhe (mockup): only the gear stays; theme
              and sign-out live in Settings (Erscheinungsbild, Profil). */}
          {!ruhe && (
          <button
            type="button"
            className="tc-ibtn tc-ibtn--sm"
            aria-label={prefs.theme !== "light" ? t("Light theme") : t("Dark theme")}
            title={prefs.theme !== "light" ? t("Light") : t("Dark")}
            onClick={() => setTheme(prefs.theme !== "light" ? "light" : "dark")}
          >
            <Ico name={prefs.theme !== "light" ? "sun" : "moon"} />
          </button>
          )}
          <NavLink
            href="/settings?section=look"
            className={"tc-ibtn tc-ibtn--sm tc-sb-gear" + (info.view === "settings" ? " is-on" : "")}
            aria-label={t("Settings")}
            title={t("Settings")}
          >
            {ruhe ? <Settings aria-hidden className="kx-ico" /> : <Ico name="gear" />}
          </NavLink>
          {/* Plain anchor, not <Link>: a prefetch must never hit the sign-out route. */}
          {!ruhe && (
          <a
            href="/auth/logout"
            className="tc-ibtn tc-ibtn--sm"
            aria-label={t("Sign out")}
            title={t("Sign out")}
          >
            <Ico name="logout" />
          </a>
          )}
        </span>
      </div>
    </aside>
  );
}
