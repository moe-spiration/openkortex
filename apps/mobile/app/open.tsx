import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useApp, type CaptureKind } from "../src/state/AppState";

const CAPTURES: readonly string[] = ["voice", "note", "photo"];

/**
 * Deep link target of notifications and widgets: kortex://open?entry=<id> opens the entry sheet,
 * kortex://open?capture=voice|note|photo opens that capture view, plain kortex://open just opens the app.
 */
export default function OpenRoute() {
  const { entry, capture } = useLocalSearchParams<{ entry?: string; capture?: string }>();
  const router = useRouter();
  const a = useApp();
  useEffect(() => {
    router.replace("/");
    if (entry) a.openEntry(entry);
    else if (capture && CAPTURES.includes(capture)) a.openCap(capture as CaptureKind);
    // Runs once per link; `a` changes identity on every state change.
  }, [entry, capture]);
  return null;
}
