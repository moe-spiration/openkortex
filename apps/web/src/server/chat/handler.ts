import { byLocale } from "@kortex/i18n";
import { t } from "@/i18n";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import {
  ConfigError,
  parseModelOverride,
  withModelOverride,
  type CatalogModel,
  type ModelSettings,
} from "@kortex/ai-core";
import { badRequest } from "../api-error";
import { getUserSettings } from "../repo";
import { preflight, readJson, route, type DepsProvider } from "../route";
import {
  ChatRequestSchema,
  normalizeMessages,
  type Citation,
  type CitationsData,
} from "./contract";
import { copilotSystemPrompt } from "./prompts";
import { isRoutingQuestion } from "./routing-guide";
import { retrieveSources, type ContextSource } from "./retrieval";
import { enforceLimits } from "../limits";
import {
  editNoteFor,
  editToolsPrompt,
  noteEditInputSchema,
  readNoteFor,
  wantsEdit,
  type EditData,
} from "./edit";
import { z } from "zod";
import { loadFocusContext } from "../digest/synthesis";
import { SourceRegistry, agentPrompt, type DoneData, type ProposalData, type StepData } from "./agent";
import { AGENT_STEPS, createAgentTools } from "./agent-tools";

export type CopilotUIMessage = UIMessage<
  never,
  { citations: CitationsData; edit: EditData; step: StepData; proposal: ProposalData; done: DoneData }
>;


const SNIPPET_CHARS = 2_500;

/** Numbers sources [1..n], merging duplicates of the same item + locator. */
export function toCitations(sources: readonly ContextSource[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const s of sources) {
    const key = `${s.item_id}|${s.page_or_timestamp ?? ""}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      n: seen.size + 1,
      item_id: s.item_id,
      title: s.title,
      type: s.type,
      page_or_timestamp: s.page_or_timestamp,
      folder_path: s.folder_path,
      source_url: s.source_url,
      snippet: s.text.slice(0, SNIPPET_CHARS),
    });
  }
  return [...seen.values()];
}

/**
 * Model switch: a requested model pins `chat_reasoning` for this call (provider from the id or a
 * "provider:" prefix); everything else follows the user's ai_routing_config (ADR-06). When the
 * catalog knows the provider, the model must be listed there.
 */
export function modelSettingsFor(
  settings: ModelSettings | null,
  requested: string | undefined,
  catalog: readonly CatalogModel[] = [],
): ModelSettings {
  if (requested?.trim()) {
    const { provider, model_id } = parseModelOverride(requested);
    const listed = catalog.filter((m) => m.provider === provider);
    if (
      listed.length &&
      !listed.some((m) => m.model_id === model_id && m.capabilities.includes("chat"))
    ) {
      throw badRequest(t("model: {model} is not available at {provider}", { model: model_id, provider }));
    }
  }
  try {
    return {
      ai_routing_config: withModelOverride(
        settings?.ai_routing_config,
        "chat_reasoning",
        requested,
      ),
      // Query embeddings must use the model the user's chunks were embedded with.
      embedding_lock: settings?.embedding_lock,
    };
  } catch (err) {
    if (err instanceof ConfigError) throw badRequest(`model: ${err.message}`);
    throw err;
  }
}

export function createChatHandlers(getDeps: DepsProvider) {
  return {
    /**
     * Streams an AI SDK UI message stream (consumable with `useChat`). The first part is
     * `data-citations` with the numbered sources; the answer cites them as [n].
     */
    POST: route(getDeps, async ({ request, auth, deps }) => {
      await enforceLimits({ auth, deps }, "chat");
      const req = ChatRequestSchema.parse(await readJson(request));
      const messages = normalizeMessages(req.messages);
      const last = messages.at(-1);
      if (!last || last.role !== "user")
        throw badRequest("messages: last message must be from the user");

      const settings = await getUserSettings(auth.client, auth.userId);
      const catalog = await deps.loadCatalog();
      const models = deps.createModels(modelSettingsFor(settings, req.model, catalog), catalog);
      const [sources, focus] = await Promise.all([
        retrieveSources(auth, req, last.content, models, deps.log),
        // Small optional background (40_AI_Memories/Focus-Profile.md); null when absent.
        loadFocusContext(auth.client, auth.userId),
      ]);
      const citations = toCitations(sources);
      const today = deps.now().toISOString().slice(0, 10);
      // Edit tools only when the user asks for a change (see wantsEdit).
      // The open note (clients send item_id with every scope while one is open).
      const noteId = req.item_id ?? null;
      const editing = wantsEdit(messages.filter((m) => m.role === "user").map((m) => m.content));
      /** The entry a tool call means: source [n], else the open note. */
      const targetOf = (source: number | undefined): string | null =>
        source !== undefined
          ? (citations.find((c) => c.n === source)?.item_id ?? null)
          : noteId;
      const ctx = { client: auth.client, userId: auth.userId };
      const agent = req.agent === true;
      const registry = new SourceRegistry(citations, SNIPPET_CHARS);

      // Resolved here: the stream's error callback may run outside the request's language context.
      const unreachable = t("The copilot is not reachable right now. Please try again later.");
      const stream = createUIMessageStream<CopilotUIMessage>({
        execute: ({ writer }) => {
          const sendCitations = () =>
            writer.write({
              type: "data-citations",
              // One part per answer: with an id a later write replaces the earlier one.
              ...(agent ? { id: "citations" } : {}),
              data: { mode: req.mode, model: models.modelIds.chat, citations: agent ? registry.list() : citations },
            });
          sendCitations();
          const agentToolSet = agent
            ? createAgentTools({
                auth,
                deps,
                models,
                base: req,
                registry,
                noteId,
                autonomy: req.autonomy,
                events: {
                  step: (data) => writer.write({ type: "data-step", data }),
                  sources: sendCitations,
                  edit: (data) => writer.write({ type: "data-edit", data }),
                  proposal: (actions, labels) => writer.write({ type: "data-proposal", id: "proposal", data: { actions, labels } }),
                  done: (results) => writer.write({ type: "data-done", id: "done", data: { results } }),
                },
              })
            : undefined;
          const tools = {
            note_read: tool({
              description:
                byLocale({
                  en: "Reads the full Markdown content of an entry (source [n] or the open note).",
                  de: "Liest den vollständigen Markdown-Inhalt eines Eintrags (Quelle [n] oder die geöffnete Notiz).",
                }),
              inputSchema: z.object({
                source: z.number().int().min(1).optional().describe(byLocale({ en: "Number [n] of the source; omit = the open note", de: "Nummer [n] der Quelle; weglassen = geöffnete Notiz" })),
              }),
              execute: async ({ source }) => {
                const id = targetOf(source);
                if (!id) return { ok: false, error: t("Unclear which entry is meant") };
                return readNoteFor(ctx, id);
              },
            }),
            note_edit: tool({
              description:
                byLocale({
                  en: "Changes an existing entry: search & replace (all occurrences), append text, change the title. Saves immediately.",
                  de: "Ändert einen bestehenden Eintrag: Suchen & Ersetzen (alle Vorkommen), Text anhängen, Titel ändern. Speichert sofort.",
                }),
              inputSchema: noteEditInputSchema(),
              execute: async ({ source, ...input }) => {
                const id = targetOf(source);
                if (!id) return { ok: false, error: t("Unclear which entry is meant") };
                const { result, data } = await editNoteFor(ctx, id, input);
                if (data) writer.write({ type: "data-edit", data });
                return result;
              },
            }),
          };
          const result = streamText({
            model: models.chat(),
            system:
              copilotSystemPrompt(req.mode, citations, today, {
                routing: isRoutingQuestion(last.content),
                brief: req.brief,
                focus,
              }) + (agent ? agentPrompt(req.autonomy, req.skill, !!noteId) : editing ? editToolsPrompt(!!noteId) : ""),
            messages,
            temperature: 0.3,
            abortSignal: request.signal,
            ...(agent
              ? {
                  tools: agentToolSet as ToolSet,
                  stopWhen: stepCountIs(AGENT_STEPS),
                }
              : editing
                ? { tools: tools as ToolSet, stopWhen: stepCountIs(5) }
                : {}),
          });
          writer.merge(result.toUIMessageStream());
        },
        onError: (err) => {
          deps.log.error("chat stream failed", err);
          return unreachable;
        },
      });
      return createUIMessageStreamResponse({ stream });
    }),
    OPTIONS: preflight(getDeps),
  };
}
