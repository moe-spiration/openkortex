import { getServerDeps } from "@/server/deps";
import { createIngestHandlers } from "@/server/ingest/handler";

// POST /api/ingest — capture from web app, extension, desktop and mobile. See src/server/ingest.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const handlers = createIngestHandlers(getServerDeps);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
