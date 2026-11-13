import { createDigestHandlers } from "@/server/digest/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/digest — weekly project digest per cluster/folder. See src/server/digest.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createDigestHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
