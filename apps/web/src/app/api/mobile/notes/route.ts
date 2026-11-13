import { getServerDeps } from "@/server/deps";
import { createMobileHandlers } from "@/server/mobile/handler";

// POST /api/mobile/notes (create) and PATCH /api/mobile/notes?id= (edit) — the phone's note editor.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createMobileHandlers(getServerDeps).notes;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const OPTIONS = handlers.OPTIONS;
