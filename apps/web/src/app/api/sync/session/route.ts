import { getServerDeps } from "@/server/deps";
import { createSyncSessionHandlers } from "@/server/sync/session";

// POST /api/sync/session — kx_ token (scope sync) → short-lived user JWT for the desktop vault sync.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createSyncSessionHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
