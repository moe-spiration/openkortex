import { loadFavorites } from "@/lib/data/favorites";
import { readResponse } from "../respond";

export const dynamic = "force-dynamic";

/** GET /api/read/favorites: the starred items for the sidebar's Favoriten section. */
export async function GET() {
  return readResponse(() => loadFavorites());
}
