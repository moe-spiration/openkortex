"use client";

import { useSyncExternalStore } from "react";
import type { Look } from "@/lib/settings/appearance";

/*
 * The UI look of this device: "ruhe" (the standard) or "vivid" (Tactile Craft), Settings > Erscheinungsbild.
 * The pre-paint script and applyAppearance write it to <html data-look> before React hydrates, so prefer CSS
 * ([data-look="ruhe"] …) for every difference. This hook is for the rare case that needs other markup: it reads the
 * attribute, answers "ruhe" while hydrating (no mismatch with the server HTML) and follows later switches.
 */

const read = (): Look => (document.documentElement.dataset.look === "vivid" ? "vivid" : "ruhe");

function subscribe(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look"] });
  return () => mo.disconnect();
}

export function useLook(): Look {
  return useSyncExternalStore(subscribe, read, () => "ruhe");
}
