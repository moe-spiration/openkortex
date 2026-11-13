import { getServerDeps } from "@/server/deps";
import { mockGraph } from "@/lib/data/graph";
import { dataSource } from "@/lib/supabase/config";
import { parseGraphQuery } from "@/server/graph/query";
import { createGraphHandlers } from "@/server/graph/handler";

// GET /api/graph: knowledge graph (nodes, edges, layout) for the current user. See src/server/graph.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createGraphHandlers(getServerDeps);

export async function GET(request: Request): Promise<Response> {
  // Mock mode has no users: answer from the prototype data.
  if (dataSource() === "mock")
    return Response.json(mockGraph(parseGraphQuery(new URL(request.url).searchParams)), { headers: { "cache-control": "no-store" } });
  return handlers.GET(request);
}

export const OPTIONS = handlers.OPTIONS;
