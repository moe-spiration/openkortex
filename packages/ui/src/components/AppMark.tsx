import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { PRODUCT_NAME } from "@kortex/i18n";

const MARK =
  'url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cpath%20d%3D%22M30%2014a18%2018%200%200%200%200%2036z%22%20fill%3D%22%23FFFFFF%22/%3E%3Cpath%20d%3D%22M36%2016.6a15.6%2015.6%200%200%201%200%2030.8%22%20stroke%3D%22%23C7D2FE%22%20stroke-width%3D%225%22%20stroke-linecap%3D%22round%22%20fill%3D%22none%22/%3E%3C/svg%3E")';

export interface AppMarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Edge length in px. */
  size?: number;
}

/** The Kortex logo ("Second Half"): accent tile with a half-disc and arc. */
export function AppMark({ size = 28, className, style, ...props }: AppMarkProps) {
  return (
    <span
      role="img"
      aria-label={PRODUCT_NAME}
      className={cn("inline-block shrink-0 rounded-[26%] bg-ai-solid bg-center bg-no-repeat", className)}
      style={{ width: size, height: size, backgroundImage: MARK, backgroundSize: "100% 100%", ...style }}
      {...props}
    />
  );
}
