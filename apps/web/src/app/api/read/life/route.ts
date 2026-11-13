import { loadLife } from "@/lib/data/life";
import { readResponse } from "../respond";

export const dynamic = "force-dynamic";

/** GET /api/read/life: the Life areas with scores, goals, routines and visions. */
export async function GET() {
  return readResponse(() => loadLife());
}
