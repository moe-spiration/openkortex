import type { ReactNode } from "react";
import { NotesRouteSwitch } from "@/components/note/NotesRouteSwitch";

/* /notes/*: keeps the new-note editor mounted across its own address change (see NotesRouteSwitch). */
export default function NotesLayout({ children }: { children: ReactNode }) {
  return <NotesRouteSwitch>{children}</NotesRouteSwitch>;
}
