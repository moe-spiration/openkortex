"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { installSnapshot, type WorkspaceSnapshot } from "@/lib/workspace-data";

const noop = () => () => {};

/*
 * Hands the server-loaded snapshot to `@/lib/workspace-data` in the browser before any consumer
 * renders. In live mode the workspace is rendered on the client only: module-level data on the
 * server is shared between requests, so SSR of user data through module exports would not be
 * isolated per user. The data still arrives inline with the RSC payload (no extra round trip).
 */
export function LiveData({
  snapshot,
  children,
}: {
  snapshot: WorkspaceSnapshot | null;
  children: ReactNode;
}) {
  // false on the server and during hydration, true afterwards.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (!snapshot) return children;
  if (!mounted) return null;
  installSnapshot(snapshot);
  return children;
}
