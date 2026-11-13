import { getUserSettings } from "@/lib/api/settings-actions";
import { readResponse } from "../respond";

export const dynamic = "force-dynamic";

/** GET /api/read/settings: the signed-in user's settings row (client view, no secrets). */
export async function GET() {
  return readResponse(() => getUserSettings());
}
