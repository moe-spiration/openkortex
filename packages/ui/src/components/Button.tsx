import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "ai" | "checkin" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-lg";

const base =
  "relative inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border-0 cursor-pointer select-none whitespace-nowrap " +
  "font-sans text-[13px] font-medium tracking-[-0.01em] no-underline " +
  "transition-[transform,box-shadow,background-color,color] duration-150 ease-snappy " +
  "active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100 " +
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:-mx-0.5 [&_svg]:[stroke-width:var(--icon-stroke)]";

const variants: Record<ButtonVariant, string> = {
  secondary:
    "bg-surface-muted text-primary shadow-[inset_0_0_0_1px_var(--border-subtle)] " +
    "hover:bg-hover hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-muted)_35%,transparent)]",
  primary:
    "bg-ai-solid text-on-ai shadow-none hover:shadow-none hover:bg-[color-mix(in_srgb,var(--accent-ai-solid)_88%,white)] " +
    "active:bg-[color-mix(in_srgb,var(--accent-ai-solid)_88%,black)]",
  checkin:
    "bg-checkin text-on-checkin shadow-none hover:shadow-none hover:bg-[color-mix(in_srgb,var(--accent-checkin)_88%,white)]",
  ghost: "bg-transparent text-secondary shadow-none hover:shadow-none hover:bg-hover hover:text-primary active:bg-hover",
  ai:
    "bg-ai-soft text-tag-ai-fg shadow-[inset_0_0_0_1px_var(--tag-ai-border)] " +
    "hover:bg-tag-ai-bg hover:shadow-[inset_0_0_0_1px_var(--accent-ai)]",
  danger:
    "bg-transparent text-urgent-text shadow-[inset_0_0_0_1px_var(--tag-finance-border)] " +
    "hover:bg-tag-finance-bg hover:shadow-[inset_0_0_0_1px_var(--status-urgent)]",
};

const sizes: Record<ButtonSize, string> = {
  md: "",
  sm: "h-7 px-2.5 gap-[5px] text-xs rounded-lg",
  lg: "h-10 px-4 gap-2 text-[13px] rounded-lg",
  icon: "w-8 p-0",
  "icon-sm": "h-7 w-7 p-0 rounded-lg text-xs",
  "icon-lg": "h-10 w-10 p-0 text-[13px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Fully rounded (pill) shape. */
  round?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", size = "md", round, className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], round && "rounded-pill", className)}
      {...props}
    />
  );
}
