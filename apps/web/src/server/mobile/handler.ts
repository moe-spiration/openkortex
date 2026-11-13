import { feature, msg, t } from "@/i18n";
import { z } from "zod";
import { badRequest, forbidden, json, notFound } from "../api-error";
import { createNoteFor, updateNoteFor } from "../notes/service";
import { loadHomeData } from "../home/service";
import { computeLife } from "../life/compute";
import { localDate } from "../life/dates";
import { loadLifeSource } from "../life/source";
import { readInsights } from "../life/state";
import { preflight, readJson, route, type DepsProvider } from "../route";
import type { AuthContext } from "../auth";
import { enforceLimits } from "../limits";
import {
  confirmJob,
  createJob,
  createStandingOrder,
  deleteStandingOrder,
  dismissJob,
  listJobs,
  listStandingOrders,
  runJob,
  setStandingOrder,
  undoJob,
} from "../agent/jobs";
import { AGENT_SKILLS } from "../chat/agent";
import { GRIPLY_REF, matchGriplyArea, type GriplyArea } from "@/lib/griply";
import { griplyIo } from "../griply/io";
import { griplyOverview, griplyStatus, handOverToGriply } from "../griply/service";

/*
 * Read-only endpoints for the mobile app (apps/mobile). The web app gets the same data through
 * server actions with its cookie session; the phone sends its Supabase access token as bearer,
 * so these run as the user (RLS) and reuse the web services 1:1.
 */

const DEFAULT_TZ = "Europe/Berlin";

function timeZoneOf(request: Request): string {
  const tz = new URL(request.url).searchParams.get("tz");
  if (tz && tz.length <= 64) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  return process.env.KORTEX_TIMEZONE?.trim() || DEFAULT_TZ;
}

/** Only user sessions (JWT / cookie): the owner-wide API token has no business here. */
function requireUser(auth: AuthContext) {
  if (auth.mode === "api_token") throw forbidden(t("Only with a Kortex sign-in"));
}

const NoteCreate = z.object({
  title: z.string().max(300),
  content_md: z.string().max(500_000).optional(),
  folder_path: z.string().trim().min(1).max(300).optional(),
  tags: z.array(z.string().max(100)).max(30).optional(),
});
const NotePatch = z
  .object({ title: z.string().max(300).optional(), content_md: z.string().max(500_000).optional() })
  .refine((p) => p.title !== undefined || p.content_md !== undefined, msg("title or content_md is missing"));

const Id = z.uuid();
/** POST /api/mobile/griply: "An Griply geben" for one task, like the web board (server/griply/actions.ts). */
const GriplyOp = z.object({ op: z.literal("handover"), id: Id });
/** POST /api/mobile/agent: the same operations as the web agent page's server actions (server/agent/actions.ts). */
const AgentOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("start"),
    prompt: z.string().trim().min(3).max(4000),
    title: z.string().trim().min(1).max(200).optional(),
    skill: z.enum(AGENT_SKILLS).optional(),
    autonomy: z.enum(["read", "ask", "self"]).optional(),
    origin: z.enum(["manual", "task", "presort"]).optional(),
    action_item_id: Id.optional(),
  }),
  z.object({ op: z.literal("confirm"), id: Id, picks: z.array(z.number().int().min(0)).max(50).optional() }),
  z.object({ op: z.literal("dismiss"), id: Id }),
  z.object({ op: z.literal("undo"), id: Id }),
  z.object({ op: z.literal("order_add"), text: z.string().trim().min(3).max(500) }),
  z.object({ op: z.literal("order_toggle"), id: Id, enabled: z.boolean() }),
  z.object({ op: z.literal("order_remove"), id: Id }),
]);

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw badRequest(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

export function createMobileHandlers(getDeps: DepsProvider) {
  return {
    /** POST creates a note, PATCH ?id= saves title and/or body (same logic as the web editor). */
    notes: {
      POST: route(getDeps, async ({ request, auth }) => {
        requireUser(auth);
        const body = parse(NoteCreate, await readJson(request));
        const note = await createNoteFor(
          { client: auth.client, userId: auth.userId },
          { title: body.title, contentMd: body.content_md, folderPath: body.folder_path, tags: body.tags },
        );
        return json({ ok: true, data: note }, { status: 201 });
      }),
      PATCH: route(getDeps, async ({ request, auth }) => {
        requireUser(auth);
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest("id fehlt");
        const body = parse(NotePatch, await readJson(request));
        await updateNoteFor({ client: auth.client, userId: auth.userId }, id, { title: body.title, contentMd: body.content_md });
        return json({ ok: true, data: { id } });
      }),
      OPTIONS: preflight(getDeps),
    },
    /** GET /api/mobile/home?tz= — backIn, archive, flashcards, meeting, mixes (no vector search). */
    home: {
      GET: route(getDeps, async ({ request, auth }) => {
        requireUser(auth);
        const timeZone = timeZoneOf(request);
        const now = new Date();
        const data = await loadHomeData(
          { client: auth.client, userId: auth.userId },
          { today: localDate(now, timeZone), timeZone, now },
        );
        return json({ ok: true, data });
      }),
      OPTIONS: preflight(getDeps),
    },
    /**
     * GET /api/mobile/agent — the agent's jobs and standing orders. POST runs one operation (start, confirm,
     * dismiss, undo, order_add, order_toggle, order_remove) as the user, with the chat's rate limit for a start.
     */
    agent: {
      GET: route(getDeps, async ({ auth }) => {
        requireUser(auth);
        const ctx = { client: auth.client, userId: auth.userId };
        const [jobs, orders] = await Promise.all([listJobs(ctx, new Date()), listStandingOrders(ctx)]);
        return json({ ok: true, data: { jobs, orders } });
      }),
      POST: route(getDeps, async ({ request, auth, deps }) => {
        requireUser(auth);
        const body = parse(AgentOp, await readJson(request));
        const ctx = { client: auth.client, userId: auth.userId };
        const now = new Date();
        switch (body.op) {
          case "start": {
            await enforceLimits({ auth, deps }, "chat");
            const job = await createJob(ctx, {
              prompt: body.prompt,
              title: body.title,
              skill: body.skill,
              autonomy: body.autonomy,
              origin: body.origin ?? "manual",
              action_item_id: body.action_item_id,
            });
            deps.defer(runJob(deps, auth, job.id));
            return json({ ok: true, data: job }, { status: 201 });
          }
          case "confirm":
            return json({ ok: true, data: await confirmJob(ctx, body.id, now, body.picks) });
          case "dismiss":
            await dismissJob(ctx, body.id, now);
            return json({ ok: true, data: null });
          case "undo":
            return json({ ok: true, data: await undoJob(ctx, body.id) });
          case "order_add":
            return json({ ok: true, data: await createStandingOrder(ctx, body.text) }, { status: 201 });
          case "order_toggle":
            await setStandingOrder(ctx, body.id, { enabled: body.enabled });
            return json({ ok: true, data: null });
          case "order_remove":
            await deleteStandingOrder(ctx, body.id);
            return json({ ok: true, data: null });
        }
      }),
      OPTIONS: preflight(getDeps),
    },
    /**
     * GET /api/mobile/griply?area=key:Label&area=… — the Griply side of the life areas, read only (like the web
     * area page's "Ziele in Griply"); POST { op: "handover", id } hands a task to Griply and marks it exported.
     */
    griply: {
      GET: route(getDeps, async ({ request, auth }) => {
        if (!feature("griply")) throw notFound();
        requireUser(auth);
        const io = griplyIo();
        const status = await griplyStatus(io, auth.userId);
        const asked = new URL(request.url).searchParams.getAll("area").slice(0, 12);
        if (status.state !== "connected") return json({ ok: true, data: { state: status.state, areas: {} } });
        const overview = await griplyOverview(io, auth.userId);
        const areas: Record<string, GriplyArea | null> = {};
        for (const a of asked) {
          const [key = "", label = ""] = a.split(":");
          if (key) areas[key.slice(0, 40)] = matchGriplyArea(overview, key.slice(0, 40), label ? [label.slice(0, 60)] : []) ?? null;
        }
        return json({ ok: true, data: { state: status.state, areas } });
      }),
      POST: route(getDeps, async ({ request, auth }) => {
        if (!feature("griply")) throw notFound();
        requireUser(auth);
        const body = parse(GriplyOp, await readJson(request));
        const { data: task, error } = await auth.client
          .from("action_items")
          .select("id,title,due_date,context,priority")
          .eq("user_id", auth.userId)
          .eq("id", body.id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!task) throw badRequest(t("Task not found"));
        const id = await handOverToGriply(griplyIo(), auth.userId, { id: task.id, title: task.title, due: task.due_date, context: task.context, priority: task.priority });
        const patch = { exported_at: new Date().toISOString(), external_ref: GRIPLY_REF(id) };
        const { error: saveError } = await auth.client.from("action_items").update(patch).eq("user_id", auth.userId).eq("id", body.id);
        if (saveError) throw new Error(saveError.message);
        return json({ ok: true, data: patch });
      }),
      OPTIONS: preflight(getDeps),
    },
    /** GET /api/mobile/life?tz= — the same computeLife() as the web Life overview, plus visions. */
    life: {
      GET: route(getDeps, async ({ request, auth }) => {
        requireUser(auth);
        const timeZone = timeZoneOf(request);
        const [src, rows] = await Promise.all([
          loadLifeSource(auth.client, auth.userId, { now: new Date(), timeZone }),
          readInsights(auth.client, auth.userId, "life_vision"),
        ]);
        const visions: Record<string, string> = {};
        for (const r of rows)
          if (typeof r.payload.text === "string" && r.payload.text.trim()) visions[r.key] = r.payload.text;
        return json({ ok: true, data: { ...computeLife(src), visions } });
      }),
      OPTIONS: preflight(getDeps),
    },
  };
}
