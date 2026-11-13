import { byLocale } from "@kortex/i18n";
import { t } from "@/i18n";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  EnrichmentActionItemSchema,
  normalizeActionItems,
  withFlashcardsSection,
  type EnrichmentActionItem,
} from "@kortex/ai-core";
import {
  KNOWLEDGE_ITEM_TYPES,
  matchKey,
  matchKnowledgeHybrid,
  NEW_TYPED_TYPES,
  syncSourceTasks,
  typeStatuses,
  validateTypeMetadata,
  type Json,
  type KnowledgeItemType,
} from "@kortex/db";
import { badRequest, json, notFound } from "../api-error";
import type { AuthContext } from "../auth";
import { getItem, getUserSettings, mergeJson, updateItem } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";
import { modelSettingsFor } from "./handler";
import { actionPrompt } from "./prompts";
import { enforceLimits } from "../limits";

// POST /api/chat/action — editor-agent actions on the open note or a selection (W8: the editor's
// KI menu sends rewrite / shorten / continue / summarize with the selection as content_md).

export const CHAT_ACTIONS = [
  "rewrite",
  "shorten",
  "continue",
  "summarize",
  "outline",
  "flashcards",
  "tasks",
  "status",
  "custom",
] as const;
/** Actions that answer with Markdown text (the editor applies it). */
type TextAction = "rewrite" | "shorten" | "continue" | "summarize" | "outline" | "custom";
export type ChatAction = (typeof CHAT_ACTIONS)[number];

export const ChatActionSchema = z
  .object({
    action: z.enum(CHAT_ACTIONS),
    /** Note to work on. Its content is loaded unless `content_md` is given (e.g. unsaved editor text or a selection). */
    item_id: z.uuid().optional(),
    content_md: z.string().min(1).max(200_000).optional(),
    /** Extra wish, e.g. "kürzer und lockerer". Required for `custom` (the editor's "Eigene Anweisung"). */
    instruction: z.string().max(2_000).optional(),
    /** Exact model for this call (see modelSettingsFor); default: the user's chat_reasoning route. */
    model: z.string().trim().min(1).max(200).optional(),
    /**
     * Persist the result on the item: summarize → summary, flashcards → flashcards,
     * tasks → action_items. rewrite/shorten/continue/outline are never saved (the editor applies them).
     */
    save: z.boolean().default(false),
    /** Number of flashcards. */
    count: z.number().int().min(3).max(30).default(10),
  })
  .refine(
    (r) => (r.action === "status" ? r.instruction || r.content_md : r.item_id || r.content_md),
    {
      message: "item_id or content_md is required (status: instruction)",
      path: ["item_id"],
    },
  )
  .refine((r) => r.action !== "custom" || !!r.instruction?.trim(), {
    message: "instruction is required for action 'custom'",
    path: ["instruction"],
  })
  // status finds its item itself (hybrid search) when no item_id is given.
  .refine((r) => !r.save || r.item_id || r.action === "status", {
    message: "save needs item_id",
    path: ["save"],
  });
export type ChatActionRequest = z.infer<typeof ChatActionSchema>;

export interface Flashcard {
  question: string;
  answer: string;
}

export type ChatActionResponse =
  | {
      ok: true;
      action: TextAction;
      model: string;
      content_md: string;
      saved: boolean;
    }
  | { ok: true; action: "flashcards"; model: string; flashcards: Flashcard[]; saved: boolean }
  | {
      ok: true;
      action: "tasks";
      model: string;
      action_items: EnrichmentActionItem[];
      saved: boolean;
    }
  | {
      ok: true;
      action: "status";
      model: string;
      item_id: string;
      title: string;
      type: string;
      /** The fields that change (status, feedback, rating); applied when `saved`. */
      metadata: Record<string, unknown>;
      saved: boolean;
    };

const FlashcardsSchema = z.object({
  flashcards: z.array(z.object({ question: z.string(), answer: z.string() })),
});
const TasksSchema = z.object({ action_items: z.array(EnrichmentActionItemSchema) });
const StatusSchema = z.object({
  query: z.string(),
  type: z.string().nullable(),
  status: z.string().nullable(),
  feedback: z.string().nullable(),
  rating: z.number().nullable(),
});

/** Types with a lifecycle, for the prompt ("book: want_to_read|reading|read"). */
const statusHint = (): string =>
  NEW_TYPED_TYPES.map((type) => [type, typeStatuses(type)] as const)
    .map(([type, s]) => (s.length ? `${type}: ${s.join("|")}` : `${type}: ${byLocale({ en: "(no status)", de: "(kein Status)" })}`))
    .join("; ");

export interface StatusTarget {
  id: string;
  title: string;
  type: string;
  metadata: Json | null;
}

/**
 * The existing entry the user talks about: title match first (exact `matchKey`, then contains),
 * then hybrid search (needs a user session). Never creates anything.
 */
export async function findStatusTarget(
  auth: AuthContext,
  query: string,
  type: string | null,
  { exact = false }: { exact?: boolean } = {},
): Promise<StatusTarget | null> {
  const key = matchKey(query);
  if (!key) return null;
  let q = auth.client
    .from("knowledge_items")
    .select("id,title,type,metadata")
    .eq("user_id", auth.userId)
    .neq("status", "archived")
    .ilike("title", `%${query.replace(/[%_]/g, " ").trim()}%`);
  if (type) q = q.eq("type", type);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(20);
  if (error) throw new Error(`find status target: ${error.message}`);
  const rows = (data as StatusTarget[] | null) ?? [];
  const exactRow = rows.find((r) => matchKey(r.title) === key);
  if (exactRow) return exactRow;
  if (exact) return null; // capture path: only an unambiguous title, never a guess
  if (rows[0]) return rows[0];
  if (auth.mode === "api_token") return null; // the hybrid RPC scopes by auth.uid()
  const hits = await matchKnowledgeHybrid(auth.client, {
    queryText: query,
    queryEmbedding: null,
    matchCount: 5,
    ...(type && (KNOWLEDGE_ITEM_TYPES as readonly string[]).includes(type)
      ? { filterType: type as KnowledgeItemType }
      : {}),
  });
  const hit = hits[0];
  if (!hit) return null;
  const item = await getItem(auth.client, auth.userId, hit.item_id, [
    "id",
    "title",
    "type",
    "metadata",
  ]);
  return item as StatusTarget | null;
}

export function createChatActionHandlers(getDeps: DepsProvider) {
  return {
    POST: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "chat_action");
      const req = ChatActionSchema.parse(await readJson(request));
      let content = req.content_md;
      let title: string | undefined;
      if (req.action === "status") content ??= req.instruction;
      if (req.item_id && req.action !== "status") {
        const item = await getItem(auth.client, auth.userId, req.item_id, [
          "id",
          "title",
          "content_md",
        ]);
        if (!item) throw notFound(t("Note not found"));
        title = item.title;
        content ??= item.content_md;
      }
      if (!content?.trim()) throw badRequest(t("The note is empty"));

      const settings = await getUserSettings(auth.client, auth.userId);
      const catalog = await deps.loadCatalog();
      const models = deps.createModels(modelSettingsFor(settings, req.model, catalog), catalog);
      const model = models.chat();
      const system = [
        actionPrompt(req.action),
        req.action === "flashcards"
          ? byLocale({ en: `Create exactly ${req.count} cards.`, de: `Erstelle genau ${req.count} Karten.` })
          : null,
        req.action === "status"
          ? byLocale({ en: `Types and allowed statuses: ${statusHint()}`, de: `Typen und erlaubte Status: ${statusHint()}` })
          : null,
        req.action === "custom"
          ? byLocale({ en: `The user's instruction: ${req.instruction}`, de: `Anweisung des Nutzers: ${req.instruction}` })
          : req.instruction && req.action !== "status"
          ? byLocale({ en: `Additional request from the user: ${req.instruction}`, de: `Zusätzlicher Wunsch des Nutzers: ${req.instruction}` })
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      const prompt = `${title ? `${byLocale({ en: "Title", de: "Titel" })}: ${title}\n\n` : ""}<text>\n${content.slice(0, 120_000)}\n</text>`;
      const modelId = models.modelIds.chat;

      if (req.action === "flashcards") {
        const { output } = await generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: FlashcardsSchema, name: "flashcards" }),
          temperature: 0.3,
        });
        const flashcards = output.flashcards
          .filter((c) => c.question.trim() && c.answer.trim())
          .slice(0, req.count);
        if (req.save && req.item_id) {
          const stamped = flashcards.map((c) => ({
            ...c,
            created_at: deps.now().toISOString(),
            source: "copilot",
          }));
          const note = await getItem(auth.client, auth.userId, req.item_id, ["content_md"]);
          await updateItem(auth.client, auth.userId, req.item_id, {
            flashcards: stamped as unknown as Json,
            // Portable Markdown: the deck is also a readable section of the note.
            content_md: withFlashcardsSection(note?.content_md ?? "", stamped),
          });
        }
        return json<ChatActionResponse>({
          ok: true,
          action: "flashcards",
          model: modelId,
          flashcards,
          saved: req.save,
        });
      }

      if (req.action === "status") {
        const { output } = await generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: StatusSchema, name: "status_update" }),
          temperature: 0,
        });
        // An existing entry is updated, never a new note created (MCP routing rule, too).
        const target = req.item_id
          ? ((await getItem(auth.client, auth.userId, req.item_id, [
              "id",
              "title",
              "type",
              "metadata",
            ])) as StatusTarget | null)
          : await findStatusTarget(auth, output.query.trim(), output.type?.trim() || null);
        if (!target) throw notFound(t("No entry found for \"{query}\"", { query: output.query }));
        const patch: Record<string, unknown> = {};
        const statuses = typeStatuses(target.type);
        if (output.status && statuses.length) {
          if (!statuses.includes(output.status))
            throw badRequest(
              t("Status \"{status}\" does not fit {type}: {allowed}", { status: output.status, type: target.type, allowed: statuses.join(", ") }),
            );
          patch.status = output.status;
        }
        if (output.feedback?.trim()) patch.feedback = output.feedback.trim();
        if (output.rating !== null && output.rating >= 0 && output.rating <= 10)
          patch.rating = output.rating;
        if (Object.keys(patch).length === 0) throw badRequest(t("No status or feedback recognised"));
        const checked = validateTypeMetadata(target.type, patch);
        if (!checked.ok) throw badRequest(checked.error);
        if (req.save)
          await updateItem(auth.client, auth.userId, target.id, {
            metadata: mergeJson(target.metadata, checked.metadata),
          });
        return json<ChatActionResponse>({
          ok: true,
          action: "status",
          model: modelId,
          item_id: target.id,
          title: target.title,
          type: target.type,
          metadata: checked.metadata,
          saved: req.save,
        });
      }

      if (req.action === "tasks") {
        // Existing projects / goals the tasks may belong to (matched by title in normalizeActionItems).
        const { data: objectRows } = await auth.client
          .from("knowledge_items")
          .select("id,title,type")
          .eq("user_id", auth.userId)
          .in("type", ["project", "goal"])
          .neq("status", "archived")
          .limit(100);
        const objects = ((objectRows ?? []) as Array<{ id: string; title: string; type: string }>).map(
          (o) => ({ id: o.id, title: o.title, type: o.type as "project" | "goal" }),
        );
        const { output } = await generateText({
          model,
          system: objects.length
            ? `${system}\n${byLocale({
                en: 'Priority per task: low|medium|high|urgent. If a task belongs to one of these projects/goals, set "project" to the exact title, otherwise null (never invent): ',
                de: 'Priorität je Aufgabe: low|medium|high|urgent. Gehört eine Aufgabe zu einem dieser Projekte/Ziele, setze "project" auf den exakten Titel, sonst null (nie erfinden): ',
              })}${objects.map((o) => o.title).join("; ")}`
            : system,
          prompt,
          output: Output.object({ schema: TasksSchema, name: "tasks" }),
          temperature: 0,
        });
        const items = normalizeActionItems(output.action_items, objects);
        if (req.save && req.item_id && items.length > 0) {
          // Dedup (@kortex/db): tasks the item already has (same title) are kept, not inserted
          // again; nothing the extraction no longer yields is removed (prune: false).
          await syncSourceTasks(
            auth.client,
            auth.userId,
            req.item_id,
            items.map((a) => ({
              title: a.title,
              description: a.description,
              assignee: a.assignee,
              priority: a.priority,
              due_date: a.due_date,
              source_timestamp_sec: a.source_timestamp_sec,
              project_item_id: a.project_item_id,
              timeframe: a.timeframe,
              context: a.context,
              user_id: auth.userId,
              source_item_id: req.item_id,
            })),
            { prune: false },
          );
        }
        return json<ChatActionResponse>({
          ok: true,
          action: "tasks",
          model: modelId,
          action_items: items,
          saved: req.save && items.length > 0,
        });
      }

      const { text } = await generateText({
        model,
        system,
        prompt,
        temperature: req.action === "outline" || req.action === "continue" ? 0.7 : 0.3,
      });
      const contentMd = text.trim();
      const saved = req.save && req.action === "summarize" && !!req.item_id;
      if (saved)
        await updateItem(auth.client, auth.userId, req.item_id as string, { summary: contentMd });
      return json<ChatActionResponse>({
        ok: true,
        action: req.action,
        model: modelId,
        content_md: contentMd,
        saved,
      });
    }),
    OPTIONS: preflight(getDeps),
  };
}
