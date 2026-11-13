import { t } from "@/i18n";
import { z } from "zod";
import { ApiError, json } from "../api-error";
import { preflight, readJson, route, type DepsProvider } from "../route";

/*
 * POST /api/highlight { highlight_id, action: "delete" } — removes one of the user's highlights
 * (item_highlights row). Used by the web clipper, where a highlight on the page can be undone; the item
 * the highlight belongs to stays. Scoped by user_id on top of RLS.
 */

export const HighlightRequestSchema = z.object({
  highlight_id: z.uuid(),
  action: z.literal("delete"),
});

export function createHighlightHandlers(getDeps: DepsProvider) {
  return {
    POST: route(getDeps, async ({ request, auth }) => {
      const req = HighlightRequestSchema.parse(await readJson(request));
      const { data, error } = await auth.client
        .from("item_highlights")
        .delete()
        .eq("id", req.highlight_id)
        .eq("user_id", auth.userId)
        .select("id");
      if (error) throw new ApiError("server_error", `delete highlight: ${error.message}`, { cause: error });
      if (!data?.length) throw new ApiError("not_found", t("Highlight not found"));
      return json({ ok: true, highlight_id: req.highlight_id, deleted: true });
    }),
    OPTIONS: preflight(getDeps),
  };
}
