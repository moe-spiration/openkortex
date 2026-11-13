import { getServerDeps } from "@/server/deps";
import { createReminderHandlers } from "@/server/reminder/handler";

// POST /api/reminder — snooze an item (remind_at), null clears it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createReminderHandlers(getServerDeps);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
