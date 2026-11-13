import { msg, t } from "@/i18n";
import { z } from "zod";
import { ApiError, json } from "../api-error";
import { getItem, updateItem } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";

/*
 * POST /api/reminder { item_id, remind_at } — snooze: sets `knowledge_items.remind_at` (ISO instant) of one
 * item, null clears it. For clients without a session action (web clipper popup after a save); the web app
 * itself uses the server action setReminder (lib/api/actions.ts).
 */

export const ReminderRequestSchema = z.object({
  item_id: z.uuid(),
  remind_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), msg("remind_at must be an ISO 8601 date"))
    .nullable(),
});

export function createReminderHandlers(getDeps: DepsProvider) {
  return {
    POST: route(getDeps, async ({ request, auth }) => {
      const req = ReminderRequestSchema.parse(await readJson(request));
      const cur = await getItem(auth.client, auth.userId, req.item_id, ["id"] as const);
      if (!cur) throw new ApiError("not_found", t("Entry not found"));
      const remind_at = req.remind_at === null ? null : new Date(req.remind_at).toISOString();
      await updateItem(auth.client, auth.userId, req.item_id, { remind_at });
      return json({ ok: true, item_id: req.item_id, remind_at });
    }),
    OPTIONS: preflight(getDeps),
  };
}
