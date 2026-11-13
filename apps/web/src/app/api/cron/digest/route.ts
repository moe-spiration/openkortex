import { createCronHandlers } from "@/server/cron/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/cron/digest — hourly server cron (Coolify scheduled task), header X-Kortex-Cron-Secret.
// Generates the weekly digests of users whose digest day has come. See src/server/cron.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createCronHandlers(getServerDeps);
export const POST = handlers.digest;
