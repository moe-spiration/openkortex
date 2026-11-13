import { createScratchpadHandlers } from "@/server/scratchpad/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/scratchpad/apply — applies confirmed suggestions. See src/server/scratchpad.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createScratchpadHandlers(getServerDeps);
export const POST = handlers.apply;
export const OPTIONS = handlers.OPTIONS;
