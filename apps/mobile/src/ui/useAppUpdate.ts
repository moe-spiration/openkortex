import { useRef, useState } from "react";
import * as Updates from "expo-updates";
import type { UpdatePhase } from "../lib/updateStatus";

/*
 * Manual update check for Einstellungen: look for a newer EAS update on this build's channel,
 * download it, and restart the app into it. Off in development (Updates.isEnabled is false there).
 */
export function useAppUpdate() {
  const [phase, setPhase] = useState<UpdatePhase>(Updates.isEnabled ? { kind: "idle" } : { kind: "off" });
  const busy = useRef(false);
  const runningId = Updates.isEmbeddedLaunch ? null : (Updates.updateId ?? null);

  /** Checks and downloads. Returns true when a new update is ready to run. */
  const check = async (): Promise<boolean> => {
    if (!Updates.isEnabled || busy.current) return false;
    busy.current = true;
    try {
      setPhase({ kind: "checking" });
      const found = await Updates.checkForUpdateAsync();
      if (!found.isAvailable) {
        setPhase({ kind: "current", at: new Date() });
        return false;
      }
      setPhase({ kind: "downloading" });
      const got = await Updates.fetchUpdateAsync();
      const id = got.manifest && "id" in got.manifest ? String(got.manifest.id) : null;
      if (!got.isNew) {
        setPhase({ kind: "current", at: new Date() });
        return false;
      }
      setPhase({ kind: "ready", id });
      return true;
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      busy.current = false;
    }
  };

  /** Restarts the app; first fetches the newest update unless one is already downloaded. */
  const restart = async () => {
    if (!Updates.isEnabled) return;
    if (phase.kind !== "ready") await check();
    await Updates.reloadAsync();
  };

  return { phase, runningId, check, restart };
}
