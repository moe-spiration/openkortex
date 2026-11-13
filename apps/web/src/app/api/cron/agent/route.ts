import { createCronHandlers } from "@/server/cron/handler";
import { getServerDeps } from "@/server/deps";

// POST /api/cron/agent — standing orders of the agent, header X-Kortex-Cron-Secret. The hourly
// digest cron starts them too; this endpoint is for a schedule of its own. See src/server/agent.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createCronHandlers(getServerDeps);
export const POST = handlers.agent;
