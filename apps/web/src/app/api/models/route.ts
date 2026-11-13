import { getServerDeps } from "@/server/deps";
import { createModelsHandlers } from "@/server/routing/models";

// GET /api/models?provider=&task=&refresh=1 — ADR-06 model catalog per provider. See src/server/routing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createModelsHandlers(getServerDeps);
export const GET = handlers.GET;
export const OPTIONS = handlers.OPTIONS;
