import { getServerDeps } from "@/server/deps";
import { createMeetingLiveHandlers } from "@/server/meeting/live";

// GET/POST /api/meeting/live — live meeting session (desktop HUD writes, web card reads).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createMeetingLiveHandlers(getServerDeps);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
