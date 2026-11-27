import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useApp, type CaptureKind } from "../src/state/AppState";

const CAPTURES: readonly string[] = ["voice", "note", "photo"];
const TABS = ["agent", "tasks", "journal", "entries", "inbox"] as const;
type Tab = (typeof TABS)[number];

/**
 * Deep link target of notifications and widgets: kortex://open?entry=<id> opens the entry sheet,
 * kortex://open?capture=voice|note|photo opens that capture view, kortex://open?tab=agent|tasks|journal|entries|inbox
 * opens that tab, plain kortex://open just opens the app.
 */
export default function OpenRoute() {
  const { entry, capture, tab } = useLocalSearchParams<{ entry?: string; capture?: string; tab?: string }>();
  const router = useRouter();
  const a = useApp();
  useEffect(() => {
    if (tab && (TABS as readonly string[]).includes(tab)) return router.replace(`/${tab as Tab}`);
    router.replace("/");
    if (entry) a.openEntry(entry);
    else if (capture && CAPTURES.includes(capture)) a.openCap(capture as CaptureKind);
    // Runs once per link; `a` changes identity on every state change.
  }, [entry, capture, tab]);
  return null;
}
