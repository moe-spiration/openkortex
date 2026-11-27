import AsyncStorage from "@react-native-async-storage/async-storage";
import { readStoredInstance } from "./instance";
import { isConfigured, supabase, switchInstance } from "./kortex";

/*
 * Headless callers (widget task, quick overlay) can start without the app's React tree, which normally
 * restores the server entered on first start. This does the same before they read or write.
 */

let restoring: Promise<boolean> | undefined;

/** True once the server is known (baked into the build, or restored from storage). */
export function ensureConfigured(): Promise<boolean> {
  if (isConfigured()) return Promise.resolve(true);
  restoring ??= readStoredInstance(AsyncStorage)
    .then((stored) => {
      if (stored && !isConfigured()) switchInstance(stored);
      return isConfigured();
    })
    .catch(() => false)
    .finally(() => {
      restoring = undefined;
    });
  return restoring;
}

/** True when a session is stored (the user signed in once on this phone). */
export async function hasSession(): Promise<boolean> {
  if (!(await ensureConfigured())) return false;
  try {
    const { data } = await supabase().auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}
