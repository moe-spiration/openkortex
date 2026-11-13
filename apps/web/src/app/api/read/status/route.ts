import { getShellStatus } from "@/server/settings/status";
import { readResponse } from "../respond";

export const dynamic = "force-dynamic";

/** GET /api/read/status: inbox counts, AI Gardener line and the current meeting. */
export async function GET() {
  return readResponse(() => getShellStatus());
}
