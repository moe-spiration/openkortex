import { createChatActionHandlers } from "@/server/chat/action";
import { getServerDeps } from "@/server/deps";

// POST /api/chat/action — rewrite, summarize, outline, flashcards, tasks.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handlers = createChatActionHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
