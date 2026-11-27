"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Ellipsis, X } from "lucide-react";
import { t } from "@/i18n";
import { DropMenu } from "@/components/ui/primitives";
import { useLook } from "@/components/theme/look";
import { Ico, type IconId } from "./icons";

/*
 * Ruhe header system (mockup `loc` + `vbar`, identical on every screen; gap report web-a W3).
 *
 * Every view fills two slots that the shell keeps ABOVE its scroll area, across the whole panel (also above a split
 * with the note drawer):
 *   - LocationBar (44 px): view icon, breadcrumb (last crumb is the current place), quiet actions on the right,
 *     an optional "…" menu and an optional close button.
 *   - ViewBar (40 px, hairline above and below): tabs on the left (label + grey count), filter / display controls on
 *     the right.
 * KbdHints is the quiet key row under a stack or list ("↵ erledigen · S später …").
 *
 * The bars render into hosts that AppShell places (HeaderSlotProvider + HeaderHosts). Before the hosts exist (server
 * render, first client render) and outside the shell they render inline at the top of the view, sticky, with the
 * same look; the switch happens before the first paint on client navigations. One LocationBar and one ViewBar per
 * view. These are Ruhe components: Vivid keeps its own heads (PageTitle and CollectionHead switch by look).
 */

type Hosts = { loc: HTMLElement | null; view: HTMLElement | null };
type HostSetters = { setLoc: (el: HTMLElement | null) => void; setView: (el: HTMLElement | null) => void };

const HostCtx = createContext<Hosts | null>(null);
const SetterCtx = createContext<HostSetters | null>(null);

/** Holds the two header hosts; wrap the shell content (the hosts and the routed view both sit inside). */
export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<HTMLElement | null>(null);
  const [setters] = useState<HostSetters>(() => ({ setLoc, setView }));
  return (
    <SetterCtx.Provider value={setters}>
      <HostCtx.Provider value={loc || view ? { loc, view } : null}>{children}</HostCtx.Provider>
    </SetterCtx.Provider>
  );
}

/** The two host elements, placed by the shell above the view's scroll area. Empty hosts take no space. */
export function HeaderHosts() {
  const s = useContext(SetterCtx);
  return (
    <div className="rz-headslot">
      <div className="rz-headslot-loc" ref={s?.setLoc} />
      <div className="rz-headslot-view" ref={s?.setView} />
    </div>
  );
}

function Slot({ which, children }: { which: keyof Hosts; children: ReactElement }) {
  const host = useContext(HostCtx)?.[which] ?? null;
  return host ? createPortal(children, host) : children;
}

/** Icon given as a registry id (Ico) or as a ready element (lucide, own SVG). */
export type BarIcon = IconId | ReactElement;

function renderIcon(icon: BarIcon | undefined, size = 14): ReactNode {
  if (!icon) return null;
  return typeof icon === "string" ? <Ico name={icon} size={size} /> : icon;
}

export interface LocCrumb {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}

/**
 * Location bar. `crumbs` runs from the root to the current place (the last one is bold and not a link). `actions` are
 * BarButton / BarIconButton elements; `more` fills the "…" menu (MenuItem / MenuSep); `onClose` adds an X at the end.
 */
export function LocationBar({
  icon,
  crumbs,
  meta,
  actions,
  more,
  moreLabel,
  onClose,
  className,
}: {
  icon?: BarIcon;
  crumbs: LocCrumb[];
  /** Quiet text after the breadcrumb (for example "gespeichert 10:30"). Use sparingly. */
  meta?: ReactNode;
  actions?: ReactNode;
  more?: ReactNode;
  moreLabel?: string;
  onClose?: () => void;
  className?: string;
}) {
  const host = useContext(HostCtx)?.loc ?? null;
  return (
    <Slot which="loc">
      <header className={"rz-locbar" + (host ? "" : " is-inline") + (className ? " " + className : "")}>
        <nav className="rz-locbar-path" aria-label={t("Path")}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            const lead = i === 0 ? renderIcon(icon) : null;
            const body = (
              <>
                {lead}
                <span className="rz-locbar-label">{c.label}</span>
              </>
            );
            return (
              <span key={i} className="rz-locbar-crumb">
                {i > 0 && (
                  <span className="rz-locbar-sep" aria-hidden>
                    ›
                  </span>
                )}
                {last ? (
                  <span className="rz-locbar-cur" aria-current="page">
                    {body}
                  </span>
                ) : c.href ? (
                  <Link href={c.href} className="rz-locbar-link">
                    {body}
                  </Link>
                ) : c.onClick ? (
                  <button type="button" className="rz-locbar-link" onClick={c.onClick}>
                    {body}
                  </button>
                ) : (
                  <span className="rz-locbar-step">{body}</span>
                )}
              </span>
            );
          })}
        </nav>
        {meta && <span className="rz-locbar-meta">{meta}</span>}
        <span className="rz-locbar-sp" />
        {actions && <div className="rz-locbar-acts">{actions}</div>}
        {more && (
          <DropMenu
            align="end"
            label={moreLabel ?? t("More")}
            trigger={
              <button type="button" className="rz-bib" aria-label={moreLabel ?? t("More")}>
                <Ellipsis aria-hidden />
              </button>
            }
          >
            {more}
          </DropMenu>
        )}
        {onClose && (
          <button type="button" className="rz-bib" aria-label={t("Close")} onClick={onClose}>
            <X aria-hidden />
          </button>
        )}
      </header>
    </Slot>
  );
}

export interface ViewTab<T extends string = string> {
  id: T;
  label: ReactNode;
  count?: number | string;
  icon?: BarIcon;
}

/**
 * View bar under the location bar. Either `tabs` (+ `value` / `onChange`) or own `children` on the left; `right` holds
 * the filter / display controls (BarButton). Tabs never wrap: the strip scrolls sideways when it is too narrow.
 */
export function ViewBar<T extends string = string>({
  tabs,
  value,
  onChange,
  label,
  children,
  right,
  className,
}: {
  tabs?: ViewTab<T>[];
  value?: T;
  onChange?: (id: T) => void;
  /** Accessible name of the tab list. */
  label?: string;
  children?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  const host = useContext(HostCtx)?.view ?? null;
  return (
    <Slot which="view">
      <div className={"rz-viewbar" + (host ? "" : " is-inline") + (className ? " " + className : "")}>
        {tabs && (
          <div className="rz-viewbar-tabs" role="tablist" aria-label={label ?? t("Show")}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === value}
                className="rz-vt"
                onClick={() => onChange?.(tab.id)}
              >
                {renderIcon(tab.icon, 13)}
                <span className="rz-vt-l">{tab.label}</span>
                {tab.count !== undefined && <span className="rz-vt-c">{tab.count}</span>}
              </button>
            ))}
          </div>
        )}
        {children}
        <span className="rz-viewbar-sp" />
        {right && <div className="rz-viewbar-right">{right}</div>}
      </div>
    </Slot>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: BarIcon;
  /** ghost (default, location bar), soft (l2 fill), primary (accent), line (hairline ring). */
  variant?: "ghost" | "soft" | "primary" | "line";
  /** Key hint after the label (mockup "Briefing öffnen ↵"). */
  kbd?: string;
  /** Marks a filter or display control that is set (a small accent dot). */
  active?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

/** 28 px text button of the bars (12.5/500). Also usable as a menu / popover trigger (props and ref pass through). */
export function BarButton({ icon, variant = "ghost", kbd, active, className, children, type, ...rest }: BtnProps) {
  return (
    <button
      type={type ?? "button"}
      className={"rz-bbtn rz-bbtn--" + variant + (active ? " is-active" : "") + (className ? " " + className : "")}
      {...rest}
    >
      {renderIcon(icon)}
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}

/** 28 px square icon button of the bars; `label` is its accessible name. */
export function BarIconButton({
  icon,
  label,
  className,
  type,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: BarIcon; label: string; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button type={type ?? "button"} className={"rz-bib" + (className ? " " + className : "")} aria-label={label} {...rest}>
      {renderIcon(icon, 15)}
    </button>
  );
}

/** One key cap (mockup kbd: mono 10.5, l3, r4). */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rz-kbdcap">{children}</kbd>;
}

export interface KeyHint {
  keys: string[];
  label: ReactNode;
}

/** Quiet key row: "↵ erledigen  S später  Z rückgängig  J K blättern" (11.5 px, t4). */
export function KbdHints({ items, className }: { items: KeyHint[]; className?: string }) {
  return (
    <div className={"rz-keys" + (className ? " " + className : "")}>
      {items.map((h, i) => (
        <span key={i} className="rz-keys-i">
          {h.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          {h.label}
        </span>
      ))}
    </div>
  );
}

/* ---------- PageTitle adapter ---------- */

/**
 * Page head of the workspace views. Ruhe: a LocationBar (icon, crumbs or the title as the current place, `aside` as the
 * actions); help and eyebrow are left out there. Vivid: the classic head (title 24, help line) unchanged.
 */
export function PageTitle({
  title,
  help,
  eyebrow,
  crumbs,
  aside,
  icon,
}: {
  title: ReactNode;
  /** Icon of the view; only the Ruhe location bar shows it, in front of the first crumb. */
  icon?: IconId;
  help?: ReactNode;
  eyebrow?: ReactNode;
  crumbs?: { label: string; href?: string }[];
  aside?: ReactNode;
}) {
  const look = useLook();
  if (look === "ruhe") {
    const path: LocCrumb[] = crumbs && crumbs.length ? crumbs : [{ label: title }];
    return <LocationBar icon={icon} crumbs={path} actions={aside} />;
  }
  return (
    <div className={"kx-pagetitle" + (crumbs ? " has-crumbs" : "")}>
      {crumbs && (
        <nav className="kx-crumbs" aria-label={t("Path")}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <Ico name="chev-r" className="kx-sep" />}
              {c.href ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? "page" : undefined} style={{ padding: "0 6px" }}>
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div
        className="kx-pagetitle-row"
        style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginTop: crumbs ? 6 : 0 }}
      >
        <div className="kx-pagetitle-text" style={{ flex: "1 1 260px", minWidth: 0 }}>
          {eyebrow && <div className="kx-eyebrow">{eyebrow}</div>}
          <h1 className="kx-h-page" style={{ margin: eyebrow ? "2px 0 0" : 0 }}>
            {title}
          </h1>
          {help && (
            <p className="kx-help kx-pagetitle-help" style={{ margin: "4px 0 0" }}>
              {help}
            </p>
          )}
        </div>
        {aside}
      </div>
    </div>
  );
}
