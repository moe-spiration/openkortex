import { createFlashcardHandlers } from "@/server/flashcards/handler";
import { getServerDeps } from "@/server/deps";

// GET /api/flashcards (?item_id= deck, else due cards) · POST /api/flashcards (generate). See src/server/flashcards.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handlers = createFlashcardHandlers(getServerDeps);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
