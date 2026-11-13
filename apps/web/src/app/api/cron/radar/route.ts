import { createCronHandlers } from "@/server/cron/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/cron/radar — hourly server cron (Coolify scheduled task), header X-Kortex-Cron-Secret.
// Checks the watched URL items (delta radar) whose interval has passed. See src/server/radar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createCronHandlers(getServerDeps);
export const POST = handlers.radar;
