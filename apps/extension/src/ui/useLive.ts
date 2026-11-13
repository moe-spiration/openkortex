import { useCallback, useEffect, useState } from "react";

export type LiveStatus = "loading" | "ready" | "error";

/**
 * Re-reads `load` whenever the local library (chrome.storage) or, with `tabsToo`, the browser tabs change.
 * `load` must be stable (module level or memoised): a new function per render would reload on every render.
 */
export function useLive<T>(load: () => Promise<T>, initial: T, tabsToo = false): { value: T; status: LiveStatus; retry: () => void } {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const refresh = useCallback(() => {
    load().then(
      (v) => {
        setValue(v);
        setStatus("ready");
      },
      () => setStatus("error"),
    );
  }, [load]);
  useEffect(() => {
    refresh();
    chrome.storage.onChanged.addListener(refresh);
    const events = tabsToo ? [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated] : [];
    for (const e of events) e.addListener(refresh);
    return () => {
      chrome.storage.onChanged.removeListener(refresh);
      for (const e of events) e.removeListener(refresh);
    };
  }, [refresh, tabsToo]);
  const retry = useCallback(() => {
    setStatus("loading");
    refresh();
  }, [refresh]);
  return { value, status, retry };
}
