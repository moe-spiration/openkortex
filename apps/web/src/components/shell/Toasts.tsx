"use client";

import { Toaster } from "sonner";
import { useShell } from "@/lib/shell/store";
import { Ico } from "./icons";

/** Toast host (Sonner): top centre like before, in the design system's kx-toast look, several may stack. */
export function Toast() {
  const { prefs } = useShell();
  return (
    <Toaster
      position="top-center"
      offset={14}
      gap={8}
      visibleToasts={3}
      theme={prefs.theme === "light" ? "light" : "dark"}
      icons={{ success: <Ico name="check" /> }}
      toastOptions={{ unstyled: true, classNames: { toast: "kx-toast kx-toast--success", actionButton: "kx-btn kx-btn--ghost kx-btn--sm" } }}
    />
  );
}
