import { GraphView } from "@/components/graph/GraphView";
import { benchGraph, loadGraph, mockGraph } from "@/lib/data/graph";
import { dataSource } from "@/lib/supabase/config";
import { getSession } from "@/lib/supabase/server";
import { DEFAULT_GRAPH_QUERY, type GraphData } from "@/server/graph/types";

export const metadata = { title: "Knowledge Graph" };

const EMPTY: GraphData = {
  nodes: [],
  edges: [],
  stats: { matching: 0, total: 0, shown: 0, edges: 0, byKind: { related: 0, wiki: 0, semantic: 0, entity: 0, tag: 0 }, truncated: false, limit: DEFAULT_GRAPH_QUERY.limit, semantic: "off" },
  suggestion: null,
};

/* The graph is built on the server (links, tags, semantic neighbours, layout) and handed to the client view. */
export default async function GraphPage({ searchParams }: { searchParams: Promise<{ bench?: string }> }) {
  let initial = EMPTY;
  // Mock mode only: `?bench=500` renders a synthetic vault of that size (performance check A-14).
  const bench = Number((await searchParams).bench);
  if (dataSource() === "mock" && bench > 0) initial = benchGraph(bench);
  else if (dataSource() === "mock") initial = mockGraph(DEFAULT_GRAPH_QUERY);
  else {
    const session = await getSession();
    if (session) initial = await loadGraph(session.client, session.user.id, DEFAULT_GRAPH_QUERY);
  }
  return <GraphView initial={initial} />;
}
