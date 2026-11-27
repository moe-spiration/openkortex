"use client";

import { useSyncExternalStore } from "react";
import { subscribeSnapshot, workspaceSnapshot, type WorkspaceSnapshot } from "@/lib/workspace-data";

/**
 * The installed workspace snapshot, re-rendering when a new one arrives (capture, `router.refresh()`).
 * Collection routes derive their lists from it in the browser instead of loading the whole snapshot again on the
 * server for every client-side navigation (the layout installed it once; see <LiveData>).
 */
export function useSnapshot(): WorkspaceSnapshot {
  return useSyncExternalStore(subscribeSnapshot, workspaceSnapshot, workspaceSnapshot);
}
