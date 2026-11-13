import { loadGraph } from "@/lib/data/graph";
import { json } from "../api-error";
import { preflight, route, type DepsProvider } from "../route";
import { parseGraphQuery } from "./query";

export function createGraphHandlers(getDeps: DepsProvider) {
  return {
    /**
     * GET /api/graph?types=note,meeting&domain=ai&since=30&semantic=0&limit=1500
     * The filtered, capped graph with layout positions and edge tuples (see ./types). Same auth as
     * the other API routes (cookie session, Supabase JWT or API token).
     */
    GET: route(getDeps, async ({ request, auth }) => {
      const query = parseGraphQuery(new URL(request.url).searchParams);
      return json(await loadGraph(auth.client, auth.userId, query));
    }),
    OPTIONS: preflight(getDeps),
  };
}
