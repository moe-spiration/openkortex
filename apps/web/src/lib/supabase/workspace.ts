import { cache } from "react";
import { redirect } from "next/navigation";
import { setRequestSnapshot, type WorkspaceSnapshot } from "@/lib/workspace-data";
import { dataSource, timeZone } from "./config";
import { ensureBootstrapped, getSession, NoAccessError } from "./server";
import { loadSnapshot } from "./snapshot";

/**
 * Loads the signed-in user's workspace for this request and makes it the data behind
 * `@/lib/workspace-data` on the server. Call `await loadWorkspace()` at the top of every server
 * page / generateMetadata that reads workspace data; it is cached per request, so the layout and
 * the page share one load. Returns null in mock mode. Redirects to /login without a session and to
 * /kein-zugang for accounts that are not on the Kortex allowlist.
 */
export const loadWorkspace = cache(async (): Promise<WorkspaceSnapshot | null> => {
  if (dataSource() === "mock") return null;
  const session = await getSession();
  if (!session) redirect("/login");
  try {
    await ensureBootstrapped(session);
  } catch (err) {
    if (err instanceof NoAccessError) redirect("/kein-zugang");
    throw err;
  }
  const snap = await loadSnapshot(session.client, session.user, timeZone());
  setRequestSnapshot(snap);
  return snap;
});
