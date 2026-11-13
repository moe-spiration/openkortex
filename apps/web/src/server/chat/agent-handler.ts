import { preflight, readJson, route, type DepsProvider } from "../route";
import { enforceLimits } from "../limits";
import { AgentRequestSchema, executeAction, undoAction, type AgentResponse } from "./agent";
import type { EditData } from "./edit";

/**
 * POST /api/chat/agent: carries out the changes the user confirmed on a proposal card
 * (op "execute") or takes changes of the agent back (op "undo"). No model call.
 */
export function createAgentHandlers(getDeps: DepsProvider) {
  return {
    POST: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "chat");
      const req = AgentRequestSchema.parse(await readJson(request));
      const ctx = { client: auth.client, userId: auth.userId };
      if (req.op === "execute") {
        const edits: EditData[] = [];
        const results = [];
        // In order: a later action may build on an earlier one (edit after create).
        for (const action of req.actions) results.push(await executeAction(ctx, action, (e) => edits.push(e)));
        return Response.json({ ok: true, op: "execute", results, edits } satisfies AgentResponse);
      }
      const results = [];
      for (const undo of [...req.undo].reverse()) results.push(await undoAction(ctx, undo));
      return Response.json({ ok: true, op: "undo", results } satisfies AgentResponse);
    }),
    OPTIONS: preflight(getDeps),
  };
}
