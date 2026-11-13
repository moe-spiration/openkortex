import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Use on top of an accent-filled surface (e.g. primary button). */
  onAccent?: boolean;
  /** sm 16 px (inside segments and hints), md 20 px (default), lg 26 px (triage key bar). */
  size?: "sm" | "md" | "lg";
  /** Pressed state: the cap sinks 1 px and gets the accent ring (keycap feedback when its shortcut fires). */
  pressed?: boolean;
}

/**
 * Physical keycap (Tactile Craft v2, dummy `.kbd`): specular top edge, 1.5 px lower edge, sinks when pressed.
 * Styling lives in tactile.css (`.kx-kbd`, `.kx-kbd--sm|--lg`, `.is-down`), so plain markup can use it too.
 */
export function Kbd({ onAccent, size = "md", pressed, className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "kx-kbd",
        size === "sm" && "kx-kbd--sm",
        size === "lg" && "kx-kbd--lg",
        onAccent && "kx-kbd--on-accent",
        pressed && "is-down",
        className,
      )}
      {...props}
    />
  );
}

/** A shortcut as a row of keycaps: `<Keys keys={["Ctrl", "K"]} />`. */
export function Keys({ keys, size, className }: { keys: string[]; size?: KbdProps["size"]; className?: string }) {
  return (
    <span className={cn("kx-keys", className)} aria-hidden>
      {keys.map((k) => (
        <Kbd key={k} size={size}>
          {k}
        </Kbd>
      ))}
    </span>
  );
}
