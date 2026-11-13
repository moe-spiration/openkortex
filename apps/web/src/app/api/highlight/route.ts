import { getServerDeps } from "@/server/deps";
import { createHighlightHandlers } from "@/server/highlight/handler";

// POST /api/highlight — { highlight_id, action: "delete" } removes a highlight (web clipper "Highlight entfernen").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createHighlightHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
