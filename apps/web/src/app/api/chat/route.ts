import { createChatHandlers } from "@/server/chat/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/chat — streaming Hybrid-RAG copilot. See src/server/chat.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handlers = createChatHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
