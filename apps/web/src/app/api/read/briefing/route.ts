import type { BriefingSummary } from "@/server/home/types";
import { getHomeBriefing } from "@/server/home/actions";
import { dayParams, readResponse } from "../respond";

export const dynamic = "force-dynamic";

const MAX_CACHED = 8_000;

/** The client's cached briefing (query `cached`, JSON), only when it has the expected shape. */
function cachedCopy(req: Request): BriefingSummary | null {
  const raw = new URL(req.url).searchParams.get("cached");
  if (!raw || raw.length > MAX_CACHED) return null;
  try {
    const v = JSON.parse(raw) as Partial<BriefingSummary>;
    const ok =
      typeof v.date === "string" &&
      typeof v.summary === "string" &&
      Array.isArray(v.taskIds) &&
      v.taskIds.every((t) => typeof t === "string") &&
      typeof v.kind === "string" &&
      (v.model === null || typeof v.model === "string") &&
      typeof v.generatedAt === "string";
    return ok ? (v as BriefingSummary) : null;
  } catch {
    return null;
  }
}

/** GET /api/read/briefing?date=&tz=&cached=: the Morning Briefing (may reuse the client's copy). */
export async function GET(req: Request) {
  const p = dayParams(req);
  if (p instanceof Response) return p;
  return readResponse(() => getHomeBriefing({ ...p, cached: cachedCopy(req) }));
}
