import { createAgentHandlers } from "@/server/chat/agent-handler";
import { getServerDeps } from "@/server/deps";

// POST /api/chat/agent — confirm the agent's proposed changes, or undo changes it made.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handlers = createAgentHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
