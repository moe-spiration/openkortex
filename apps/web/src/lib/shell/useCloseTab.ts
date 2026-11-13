"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { HOME_TAB_KEY, routeInfo } from "./routes";
import { useShell } from "./store";

/** Closes a tab (default: the current one) and moves to its right, else left neighbour, else /home. Home itself is pinned. */
export function useCloseTab() {
  const router = useRouter();
  const pathname = usePathname();
  const { prefs, setTabs } = useShell();
  return useCallback(
    (key?: string) => {
      const current = routeInfo(pathname).tabKey;
      const k = key ?? current;
      if (k === HOME_TAB_KEY) return; // Home is pinned
      const i = prefs.tabs.findIndex((t) => t.key === k);
      const rest = prefs.tabs.filter((t) => t.key !== k);
      setTabs(() => rest);
      if (k === current) {
        const next = rest[i] ?? rest[i - 1];
        router.push(next ? next.href : "/home");
      }
    },
    [pathname, prefs.tabs, router, setTabs],
  );
}
