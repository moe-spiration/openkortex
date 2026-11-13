import { createScratchpadHandlers } from "@/server/scratchpad/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/scratchpad/cleanup — AI suggestions per entry. See src/server/scratchpad.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handlers = createScratchpadHandlers(getServerDeps);
export const POST = handlers.cleanup;
export const OPTIONS = handlers.OPTIONS;
