import { getServerDeps } from "@/server/deps";
import { createDueHandlers } from "@/server/reminder/due";

// GET /api/reminders/due — due reminders and unseen radar changes for web, desktop and Android.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createDueHandlers(getServerDeps);
export const GET = handlers.GET;
export const OPTIONS = handlers.OPTIONS;
