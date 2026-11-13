import { createFlashcardHandlers } from "@/server/flashcards/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/flashcards/review — record one answer (again|hard|good|easy), SM-2 schedule.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createFlashcardHandlers(getServerDeps);
export const POST = handlers.review;
export const OPTIONS = handlers.OPTIONS;
