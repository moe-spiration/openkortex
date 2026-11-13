import { getServerDeps } from "@/server/deps";
import { createSearchHandlers } from "@/server/search/handler";

// GET /api/search?q=&limit=&type=&content=1 — hybrid vault search (desktop launcher).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createSearchHandlers(getServerDeps);
export const GET = handlers.GET;
export const OPTIONS = handlers.OPTIONS;
