import { loadDailyCheckin } from "@/lib/api/actions";
import { dayParams, readResponse } from "../respond";

export const dynamic = "force-dynamic";

/** GET /api/read/checkin?date=YYYY-MM-DD: the check-in stored on that day's daily note. */
export async function GET(req: Request) {
  const p = dayParams(req);
  if (p instanceof Response) return p;
  return readResponse(() => loadDailyCheckin(p.date));
}
