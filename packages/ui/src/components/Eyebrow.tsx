import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("font-sans text-[12px] leading-[18px] font-normal tracking-normal text-muted", className)} {...props} />;
}
