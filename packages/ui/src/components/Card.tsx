import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Add 16px padding. */
  padded?: boolean;
}

export function Card({ padded, className, ...props }: CardProps) {
  return <div className={cn("card-3d-flat", padded && "p-4", className)} {...props} />;
}
