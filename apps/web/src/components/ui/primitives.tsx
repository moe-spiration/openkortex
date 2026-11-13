"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { Menu } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";

/*
 * Shared UI primitives for the web app (one base: base-ui). They wrap the library parts once, in the design system's
 * classes (kx-menu, kx-tip), so call sites stay short and every popup behaves the same: focus handling, Escape,
 * outside click, arrow keys and typeahead come from base-ui instead of a per-component useDismiss copy.
 */

/** Button classes as typed variants (cva) over the existing kx-btn system. */
export const button = cva("kx-btn", {
  variants: {
    intent: { primary: "kx-btn--primary", secondary: "kx-btn--secondary", ghost: "kx-btn--ghost", danger: "kx-btn--danger" },
    size: { sm: "kx-btn--sm", md: "", icon: "kx-btn--icon" },
  },
  compoundVariants: [{ intent: "ghost", size: "icon", class: "kx-btn--sm" }],
  defaultVariants: { intent: "ghost", size: "md" },
});
export type ButtonVariants = VariantProps<typeof button>;

/** Tooltip on any focusable element (replaces title= and the CSS [data-tip] bubble where it matters). */
export function Tip({
  label,
  kbd,
  side = "bottom",
  children,
}: {
  label: ReactNode;
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6}>
          <Tooltip.Popup className="kx-tip">
            {label}
            {kbd && <span className="kx-kbd">{kbd}</span>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** App-wide tooltip timing: one short delay, then neighbouring tooltips show at once. */
export function TipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delay={450} closeDelay={0}>{children}</Tooltip.Provider>;
}

/** Dropdown menu in the kx-menu look. `trigger` is the button element; items are MenuItem / MenuSep / Menu.* parts. */
export function DropMenu({
  trigger,
  children,
  align = "start",
  side = "bottom",
  label,
  className,
  onOpenChange,
}: {
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  label?: string;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Menu.Root onOpenChange={onOpenChange ? (o) => onOpenChange(o) : undefined}>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner align={align} side={side} sideOffset={6} style={{ zIndex: 70 }}>
          <Menu.Popup className={"kx-menu kx-pop" + (className ? " " + className : "")} aria-label={label}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
  closeOnClick = true,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  closeOnClick?: boolean;
}) {
  return (
    <Menu.Item
      className={"kx-menu-item" + (danger ? " kx-menu-item--danger" : "")}
      disabled={disabled}
      closeOnClick={closeOnClick}
      onClick={onSelect}
    >
      {children}
    </Menu.Item>
  );
}

export function MenuSep() {
  return <Menu.Separator className="kx-menu-sep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="kx-menu-label">{children}</div>;
}

export { Menu };
