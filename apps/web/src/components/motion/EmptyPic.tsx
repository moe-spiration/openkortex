import type { ReactNode } from "react";
import { Pictogram, type PictogramKind, type PictogramSize } from "./Pictogram";

/**
 * Ruhe empty or waiting state with its animated pictogram (Linear-like: the drawing, one title line, one text line).
 * Shown only in the Ruhe look (.kx-empty-pic); the classic look keeps whatever the view rendered before, passed as
 * `classic` (or nothing). Styles: packages/ui/src/styles/ruhe-motion.css. For a whole empty view use Page.tsx EmptyState.
 */
export function EmptyPic({
  kind,
  title,
  children,
  size = "md",
  idle,
  classic,
  className,
}: {
  kind: PictogramKind;
  title?: ReactNode;
  children?: ReactNode;
  /** lg: a whole view (centred in the free space), md: a panel or column, sm: a rail or card. */
  size?: PictogramSize;
  idle?: boolean;
  /** What the classic look shows instead (the view's former plain text). */
  classic?: ReactNode;
  className?: string;
}) {
  return (
    <>
      <div className={["kx-empty-pic", size === "lg" && "is-lg", className].filter(Boolean).join(" ")} data-empty-pic={kind}>
        <Pictogram kind={kind} size={size} idle={idle} />
        {title && <strong>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
      {classic && <div className="kx-empty-classic">{classic}</div>}
    </>
  );
}
