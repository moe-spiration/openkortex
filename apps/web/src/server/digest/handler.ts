import { t } from "@/i18n";
import { badRequest, json } from "../api-error";
import { modelSettingsFor } from "../chat/handler";
import { getUserSettings } from "../repo";
import { preflight, route, type DepsProvider } from "../route";
import { DigestRequestSchema, generateDigests } from "./service";
import { enforceLimits } from "../limits";

export function createDigestHandlers(getDeps: DepsProvider) {
  return {
    /** Generates (and by default saves) weekly digests for the last `days` days. Empty body = defaults. */
    POST: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "digest");
      const text = await request.text();
      let raw: unknown = {};
      if (text.trim()) {
        try {
          raw = JSON.parse(text);
        } catch {
          throw badRequest(t("Body must be valid JSON"));
        }
      }
      const req = DigestRequestSchema.parse(raw);
      const settings = await getUserSettings(auth.client, auth.userId);
      const catalog = await deps.loadCatalog();
      const models = deps.createModels(modelSettingsFor(settings, req.model, catalog), catalog);
      return json(await generateDigests(deps, auth, req, models));
    }),
    OPTIONS: preflight(getDeps),
  };
}
