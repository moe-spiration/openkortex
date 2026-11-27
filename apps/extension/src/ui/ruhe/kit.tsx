// Ruhe primitives of the extension (2026-11-27): one header system (location bar + view tabs), property rows,
// tags as a 6 px dot, folder paths with quiet parents, agent steps with a status ring, banners with one action,
// menus, switches and a toast stack. Styles: src/styles/ruhe-ui.css (rx-*), tokens from packages/ui ruhe.css.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AlertTriangle, CircleCheck, CircleDashed, X } from "lucide-react";
import { PRODUCT_NAME, t } from "../../i18n";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Mac shows ⌥/⌘, everything else Alt/Ctrl (hint text only; the shortcuts themselves are the same keys). */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
export const ALT = IS_MAC ? "⌥" : "Alt+";
export const MOD = IS_MAC ? "⌘" : "Ctrl+";
/** `true` when the platform's command key is held (⌘ on Mac, Ctrl elsewhere). */
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (IS_MAC ? e.metaKey : e.ctrlKey);

/** Keys typed into a field must not trigger single-letter shortcuts. */
export const isTyping = (e: { target: EventTarget | null }) => {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
};

export function Kbd({ children, bare }: { children: ReactNode; bare?: boolean }) {
  return (
    <kbd className={cx("rx-kbd", bare && "rx-kbd--bare")} aria-hidden>
      {children}
    </kbd>
  );
}

/** The product mark: first letter on the accent tile. */
export function Mark({ className }: { className?: string }) {
  return (
    <span className={cx("rx-mark", className)} aria-hidden>
      {PRODUCT_NAME.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Location bar: mark, place (bold) with an optional sub place, fixed actions on the right. */
export function LocBar({ title, place, extra, children, className }: { title?: ReactNode; place?: ReactNode; extra?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cx("rx-loc", className)}>
      <Mark />
      {title && <b className="rx-loc-title">{title}</b>}
      {place && (
        <>
          <span className="rx-loc-sep" aria-hidden>
            /
          </span>
          <span className="rx-loc-place rx-trunc">{place}</span>
        </>
      )}
      {extra}
      <span className="rx-grow" />
      {children}
    </header>
  );
}

export interface ViewTab<V extends string> {
  value: V;
  label: string;
  /** Digit shortcut shown as a quiet key. */
  kbd?: string;
  icon?: ReactNode;
}

/** Text tabs without a tray; arrow keys move between them (tablist). */
export function ViewTabs<V extends string>({ tabs, value, onChange, label, idPrefix = "rx-view" }: { tabs: ViewTab<V>[]; value: V; onChange: (v: V) => void; label: string; idPrefix?: string }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = tabs.findIndex((x) => x.value === value);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    onChange(next.value);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-${next.value}`)?.focus());
  };
  return (
    <div className="rx-views" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((v) => (
        <button
          key={v.value}
          id={`${idPrefix}-${v.value}`}
          type="button"
          role="tab"
          className="rx-view"
          aria-selected={v.value === value}
          tabIndex={v.value === value ? 0 : -1}
          onClick={() => onChange(v.value)}
        >
          {v.icon}
          {v.label}
          {v.kbd && <Kbd>{v.kbd}</Kbd>}
        </button>
      ))}
    </div>
  );
}

/** Square icon button; the label is the tooltip and the accessible name (with the shortcut). */
export function IconBtn({ label, kbd, small, pressed, children, className, ...rest }: { label: string; kbd?: string; small?: boolean; pressed?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const title = kbd ? `${label} (${kbd})` : label;
  return (
    <button type="button" className={cx("rx-ib", small && "rx-ib--sm", className)} aria-label={label} title={title} aria-pressed={pressed} aria-keyshortcuts={kbd} {...rest}>
      {children}
    </button>
  );
}

export type BtnVariant = "ghost" | "soft" | "pri" | "line";

export function Btn({
  variant = "ghost",
  big,
  block,
  crit,
  kbd,
  children,
  className,
  ...rest
}: { variant?: BtnVariant; big?: boolean; block?: boolean; crit?: boolean; kbd?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx("rx-btn", variant !== "ghost" && `rx-btn--${variant}`, big && "rx-btn--big", block && "rx-btn--block", crit && "rx-btn--crit", className)}
      {...rest}
    >
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}

/** Property row: icon + 74 px label, value, optional chevron; a button when it opens something. */
export function PropRow({ icon, label, children, onClick, open, chevron, id }: { icon: ReactNode; label: string; children: ReactNode; onClick?: () => void; open?: boolean; chevron?: ReactNode; id?: string }) {
  const body = (
    <>
      <span className="rx-prop-k">
        {icon}
        {label}
      </span>
      <span className="rx-prop-v">{children}</span>
      {chevron && <span className="rx-prop-cv">{chevron}</span>}
    </>
  );
  return onClick ? (
    <button id={id} type="button" className="rx-prop" data-open={open ? "" : undefined} aria-expanded={open} aria-haspopup="listbox" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div id={id} className="rx-prop">
      {body}
    </div>
  );
}

/** Tag as a 6 px dot plus text; a suggestion is an empty ring, pressing toggles it. */
export function TagDot({ tag, on = true, onToggle }: { tag: string; on?: boolean; onToggle?: () => void }) {
  const dot = <span className={cx("rx-dot", !on && "rx-dot--ring")} aria-hidden />;
  if (!onToggle)
    return (
      <span className="rx-tag">
        {dot}
        {tag}
      </span>
    );
  return (
    <button type="button" className="rx-tag" aria-pressed={on} onClick={onToggle} title={on ? t("Remove tag") : t("Add suggested tag")}>
      {dot}
      {tag}
    </button>
  );
}

/** `30_Clippings/AI Engineering`: parents quiet, the last segment in full ink. */
export function FolderPath({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean);
  return (
    <span className="rx-path" title={path}>
      {parts.map((p, i) =>
        i < parts.length - 1 ? (
          <span key={i}>
            <span className="rx-path-p">{p}</span>
            <span className="rx-path-s">/</span>
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

export interface SegOption<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
  title?: string;
}

/** Segmented control (radiogroup). */
export function Seg<V extends string>({ options, value, onChange, label, className }: { options: SegOption<V>[]; value: V; onChange: (v: V) => void; label: string; className?: string }) {
  return (
    <div className={cx("rx-seg", className)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
          {o.count !== undefined && <span className="rx-c rx-num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** One sentence, at most one action. */
export function Banner({ tone, icon, title, children, action, role }: { tone?: "warn" | "crit"; icon: ReactNode; title: ReactNode; children?: ReactNode; action?: { label: string; onClick: () => void }; role?: "alert" | "status" | "note" }) {
  return (
    <div className={cx("rx-banner", tone && `rx-banner--${tone}`)} role={role ?? (tone === "crit" ? "alert" : "note")}>
      {icon}
      <div className="rx-grow">
        <b>{title}</b>
        {children}
      </div>
      {action && (
        <button type="button" className="rx-banner-act" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="rx-empty">
      {icon}
      <div className="rx-empty-t">{title}</div>
      {children && <div className="rx-empty-s">{children}</div>}
      {actions && <div style={{ display: "flex", gap: 6, marginTop: 10 }}>{actions}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <input type="checkbox" role="switch" className="rx-switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

/** Status ring: a share of the circle, spinning while the share is unknown. */
export function Ring({ value = 0.6, spin, warn }: { value?: number; spin?: boolean; warn?: boolean }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg className={cx("rx-ring", spin && "rx-ring--spin", warn && "rx-ring--warn")} viewBox="0 0 16 16" aria-hidden>
      <circle className="rx-ring-bg" cx="8" cy="8" r={r} />
      <circle className="rx-ring-fg" cx="8" cy="8" r={r} strokeDasharray={`${c * value} ${c}`} />
    </svg>
  );
}

export type StepState = "done" | "run" | "wait" | "fail";
export interface Step {
  key: string;
  label: ReactNode;
  state: StepState;
  right?: ReactNode;
}

/** The agent's visible steps: check (done), ring (running), dashed (waiting), warning (failed). */
export function Steps({ steps, label }: { steps: Step[]; label?: string }) {
  return (
    <div className="rx-steps" role="list" aria-label={label} aria-live="polite">
      {steps.map((s) => (
        <div key={s.key} className="rx-step" role="listitem" data-state={s.state === "done" ? undefined : s.state}>
          {s.state === "done" ? <CircleCheck aria-hidden /> : s.state === "run" ? <Ring spin /> : s.state === "fail" ? <AlertTriangle aria-hidden /> : <CircleDashed aria-hidden />}
          <span className="rx-trunc">{s.label}</span>
          {s.right && <span className="rx-step-r rx-trunc">{s.right}</span>}
        </div>
      ))}
    </div>
  );
}

/** Monochrome monogram tile; the real favicon only once it loaded (desaturated). */
export function Fav({ url, title, icon }: { url?: string; title?: string; icon?: string }) {
  const [ok, setOk] = useState(false);
  let letter = (title ?? "").trim().slice(0, 1);
  try {
    if (url) letter = new URL(url).hostname.replace(/^www\./, "").slice(0, 1) || letter;
  } catch {
    /* keep the title letter */
  }
  return (
    <span className="rx-fav" aria-hidden>
      {icon && /^(https?:|data:image\/)/.test(icon) ? (
        <img src={icon} alt="" style={ok ? undefined : { display: "none" }} onLoad={() => setOk(true)} onError={() => setOk(false)} referrerPolicy="no-referrer" />
      ) : null}
      {!ok && (letter.toUpperCase() || "·")}
    </span>
  );
}

export function Hints({ items, right }: { items: { kbd: string; label: string }[]; right?: ReactNode }) {
  return (
    <div className="rx-hints" aria-hidden>
      {items.map((h) => (
        <span key={h.kbd + h.label}>
          <Kbd>{h.kbd}</Kbd>
          {h.label}
        </span>
      ))}
      {right && (
        <>
          <span className="rx-grow" />
          {right}
        </>
      )}
    </div>
  );
}

/** Closes on Escape and on a click outside the given element. */
export function useDismiss(open: boolean, onClose: () => void, ref: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, ref]);
}

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  /** Group heading shown above this item. */
  group?: string;
  /** Separator above this item. */
  sep?: boolean;
  muted?: boolean;
}

/**
 * Floating list with roving selection (arrows, Enter, Escape). With `search`, a filter field sits on top and
 * `onSearchEnter` gets ⌘/Ctrl+Enter (the "new folder" path of the folder picker).
 */
export function Menu({
  items,
  onPick,
  onClose,
  style,
  label,
  search,
  className,
}: {
  items: MenuItem[];
  onPick: (key: string) => void;
  onClose: () => void;
  style?: CSSProperties;
  label: string;
  search?: { value: string; onChange: (v: string) => void; placeholder: string; onModEnter?: () => void };
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  useDismiss(true, onClose, ref);
  useEffect(() => setActive(0), [search?.value, items.length]);
  useEffect(() => {
    if (!search) ref.current?.focus();
  }, [search]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (modKey(e) && search?.onModEnter) search.onModEnter();
      else if (items[active]) onPick(items[active]!.key);
    } else if (/^[1-9]$/.test(e.key) && !search) {
      const hit = items[Number(e.key) - 1];
      if (hit) {
        e.preventDefault();
        onPick(hit.key);
      }
    }
  };
  return (
    <div ref={ref} className={cx("rx-menu", className)} style={style} role="dialog" aria-label={label} tabIndex={-1} onKeyDown={onKey}>
      {search && (
        <label className="rx-menu-search">
          <SearchGlyph />
          <input
            autoFocus
            value={search.value}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => search.onChange(e.target.value)}
          />
          <Kbd>Esc</Kbd>
        </label>
      )}
      <div className="rx-menu-list" role="listbox" id={listId} aria-label={label}>
        {items.map((it, i) => (
          <div key={it.key}>
            {it.sep && <div className="rx-msep" role="separator" />}
            {it.group && <div className="rx-mgrp">{it.group}</div>}
            <button
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className="rx-mi"
              data-active={i === active ? "" : undefined}
              style={it.muted ? { color: "var(--t3)" } : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(it.key)}
            >
              {it.icon}
              <span className="rx-trunc">{it.label}</span>
              {it.right && <span className="rx-mi-r">{it.right}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg className="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export type ToastTone = "ok" | "error" | "warn" | "busy";
export interface RxToast {
  id: string;
  tone: ToastTone;
  text: string;
  detail?: string;
  action?: { label: string; kbd?: string; onClick: () => void };
  /** ms until it goes away; busy toasts stay until replaced. */
  ms?: number;
}

/** Bottom-right stack, newest at the bottom; each toast has at most one action. */
export function ToastStack({ toasts, onDismiss, style }: { toasts: RxToast[]; onDismiss: (id: string) => void; style?: CSSProperties }) {
  return (
    <div className="rx-toasts" style={style} aria-live="polite">
      {toasts.map((x) => (
        <ToastItem key={x.id} toast={x} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: RxToast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (toast.tone === "busy") return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.ms ?? (toast.tone === "error" ? 6000 : toast.action ? 6000 : 3200));
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);
  return (
    <div className={cx("rx-toast", toast.tone !== "busy" && `rx-toast--${toast.tone}`)} role={toast.tone === "error" ? "alert" : "status"}>
      {toast.tone === "busy" ? <Ring spin /> : toast.tone === "ok" ? <CircleCheck aria-hidden /> : <AlertTriangle aria-hidden />}
      <span>{toast.text}</span>
      {toast.detail && <span className="rx-toast-d rx-trunc">{toast.detail}</span>}
      {toast.action && (
        <Btn
          kbd={toast.action.kbd}
          onClick={() => {
            toast.action!.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Btn>
      )}
      {!toast.action && toast.tone === "error" && (
        <IconBtn small label={t("Dismiss")} onClick={() => onDismiss(toast.id)}>
          <X />
        </IconBtn>
      )}
    </div>
  );
}

/** Small toast store for one view. */
export function useToasts() {
  const [toasts, setToasts] = useState<RxToast[]>([]);
  const dismiss = useRef((id: string) => setToasts((all) => all.filter((x) => x.id !== id))).current;
  const show = useRef((x: Omit<RxToast, "id"> & { id?: string }) => {
    const id = x.id ?? Math.random().toString(36).slice(2);
    setToasts((all) => [...all.filter((y) => y.id !== id), { ...x, id }].slice(-3));
    return id;
  }).current;
  return { toasts, show, dismiss };
}
