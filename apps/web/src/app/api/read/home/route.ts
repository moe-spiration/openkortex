import { getHomeData } from "@/server/home/actions";
import { dayParams, readResponse } from "../respond";

export const dynamic = "force-dynamic";

/** GET /api/read/home?date=YYYY-MM-DD&tz=Europe/Berlin: "Weiter, wo Du warst" and "Wiederentdecken". */
export async function GET(req: Request) {
  const p = dayParams(req);
  if (p instanceof Response) return p;
  return readResponse(() => getHomeData(p));
}
