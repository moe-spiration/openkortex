import { createScratchpadHandlers } from "@/server/scratchpad/handler";
import { getServerDeps } from "@/server/deps";

// GET/POST /api/scratchpad — the single scratchpad document. See src/server/scratchpad.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createScratchpadHandlers(getServerDeps);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
