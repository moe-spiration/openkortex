import type { CSSProperties } from "react";
import { useDesktop } from "@/state/desktop";
import { DIco } from "./icons";

export const TOAST_PLACEMENT: CSSProperties = {
  position: "absolute",
  bottom: 68,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 70,
};

/** Success toast (Desktop.dc.html bottom toast). */
export function Toast({ placement = TOAST_PLACEMENT }: { placement?: CSSProperties }) {
  const { toast } = useDesktop();
  if (!toast) return null;
  return (
    <div className="kx-toast kx-toast--success kx-slide-up" role="status" style={placement}>
      <DIco name="check" />
      <span>{toast}</span>
    </div>
  );
}
