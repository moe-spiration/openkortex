import { getServerDeps } from "@/server/deps";
import { createMeetingCoachHandlers } from "@/server/meeting/coach";

// POST /api/meeting/coach — live coaching cards from the user's meeting_coach route (ADR-06).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handlers = createMeetingCoachHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
