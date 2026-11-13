import { getServerDeps } from "@/server/deps";
import { createTranscribeHandlers } from "@/server/chat/transcribe";

// POST /api/chat/transcribe — footbar voice note: audio (multipart `audio`) to text.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createTranscribeHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
