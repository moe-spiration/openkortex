import { json } from "../api-error";
import { modelSettingsFor } from "../chat/handler";
import { enforceLimits } from "../limits";
import { getUserSettings } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";
import {
  dueCards,
  generateDeck,
  GenerateRequestSchema,
  getDeck,
  ListQuerySchema,
  listDecks,
  recordReview,
  ReviewRequestSchema,
} from "./service";

export function createFlashcardHandlers(getDeps: DepsProvider) {
  return {
    /** GET /api/flashcards?item_id= — one deck; without item_id: due cards across all notes (?limit=). */
    GET: route(getDeps, async ({ request, auth, deps }) => {
      const q = ListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      if (q.decks && !q.item_id) return json(await listDecks(deps, auth));
      return json(
        q.item_id ? await getDeck(deps, auth, q.item_id) : await dueCards(deps, auth, q.limit),
      );
    }),
    /** POST /api/flashcards { item_id, count?, mode?, model? } — generate cards from the note. */
    POST: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "chat_action");
      const req = GenerateRequestSchema.parse(await readJson(request));
      const settings = await getUserSettings(auth.client, auth.userId);
      const catalog = await deps.loadCatalog();
      const models = deps.createModels(modelSettingsFor(settings, req.model, catalog), catalog);
      return json(await generateDeck(deps, auth, req, models));
    }),
    /** POST /api/flashcards/review { item_id, card_id, grade: again|hard|good|easy }. */
    review: route(getDeps, async ({ request, auth, deps }) => {
      const req = ReviewRequestSchema.parse(await readJson(request));
      return json(await recordReview(deps, auth, req));
    }),
    OPTIONS: preflight(getDeps),
  };
}
