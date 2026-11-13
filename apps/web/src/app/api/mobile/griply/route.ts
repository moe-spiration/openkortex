import { getServerDeps } from "@/server/deps";
import { createMobileHandlers } from "@/server/mobile/handler";

// GET/POST /api/mobile/griply — Griply goals of the life areas and the task hand-over for the mobile app (Supabase JWT as bearer). See src/server/mobile.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createMobileHandlers(getServerDeps).griply;
export const GET = handlers.GET;
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
