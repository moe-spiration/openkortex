import { json } from "../api-error";
import { modelSettingsFor } from "../chat/handler";
import { enforceLimits } from "../limits";
import { getUserSettings } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";
import { AppendRequestSchema, ApplyRequestSchema } from "./schema";
import { appendToScratchpad, applyDecisions, listEntries, suggestCleanup } from "./service";

export function createScratchpadHandlers(getDeps: DepsProvider) {
  return {
    /** GET /api/scratchpad → { item_id, entries } */
    GET: route(getDeps, async ({ auth }) => json({ ok: true, ...(await listEntries(auth)) })),
    /** POST /api/scratchpad { text } → appends one entry (creates the document on first use). */
    POST: route(getDeps, async ({ request, auth, deps }) => {
      const { text } = AppendRequestSchema.parse(await readJson(request));
      return json({ ok: true, ...(await appendToScratchpad(deps, auth, text)) });
    }),
    /** POST /api/scratchpad/cleanup → { entries, suggestions } (changes nothing). */
    cleanup: route(getDeps, async ({ auth, deps }) => {
      await enforceLimits({ auth, deps }, "chat_action");
      const settings = await getUserSettings(auth.client, auth.userId);
      const catalog = await deps.loadCatalog();
      const models = deps.createModels(modelSettingsFor(settings, undefined, catalog), catalog);
      return json({ ok: true, ...(await suggestCleanup(auth, models)) });
    }),
    /** POST /api/scratchpad/apply { decisions } → per-entry results plus the remaining entries. */
    apply: route(getDeps, async ({ request, auth }) => {
      const { decisions } = ApplyRequestSchema.parse(await readJson(request));
      return json({ ok: true, ...(await applyDecisions(auth, decisions)) });
    }),
    OPTIONS: preflight(getDeps),
  };
}
