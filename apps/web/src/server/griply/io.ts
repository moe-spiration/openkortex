import { feature, t } from "@/i18n";
import { getServerDeps } from "@/server/deps";
import { sdkMcpPort } from "./mcp";
import type { GriplyIo } from "./service";
import { supabaseConnectionStore } from "./store";

/** The real outside world of the Griply connection: the table (service role) and the MCP SDK. */
export function griplyIo(): GriplyIo {
  // The open-source edition has no Griply hand-over (product.json features.griply = false).
  if (!feature("griply")) throw new Error(t("Griply is not part of this edition"));
  const deps = getServerDeps();
  return { store: supabaseConnectionStore(() => deps.clients.service()), mcp: sdkMcpPort, now: () => new Date() };
}
