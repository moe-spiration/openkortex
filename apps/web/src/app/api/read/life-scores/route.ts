import { loadLifeScores } from "@/lib/data/life";
import { readResponse } from "../respond";

export const dynamic = "force-dynamic";

/** GET /api/read/life-scores: the six area scores for the sidebar. */
export async function GET() {
  return readResponse(() => loadLifeScores());
}
