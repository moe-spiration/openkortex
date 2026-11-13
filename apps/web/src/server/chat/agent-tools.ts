import { byLocale } from "@kortex/i18n";
import { tool, type ToolSet } from "ai";
import type { ModelRouter } from "@kortex/ai-core";
import { z } from "zod";
import { t } from "@/i18n";
import type { AuthContext } from "../auth";
import type { ServerDeps } from "../deps";
import {
  AgentActionSchema,
  actionLabel,
  executeAction,
  type AgentAction,
  type AgentActionResult,
  type AgentAutonomy,
  type SourceRegistry,
  type StepData,
} from "./agent";
import type { ChatRequest } from "./contract";
import { noteEditInputSchema, readNoteFor, type EditData } from "./edit";
import { retrieveSources } from "./retrieval";

/*
 * The agent's tools, shared by the copilot stream (POST /api/chat, the user watches) and the
 * background jobs (server/agent, nobody watches). What happens with a step, new sources, a proposal
 * or a finished change is up to the caller (`events`): the stream writes data parts, a job collects
 * them into its result.
 */

/** Tool rounds of one agent answer (searches, reads, changes, then the answer itself). */
export const AGENT_STEPS = 12;
const LIST_LIMIT = 40;

export interface AgentToolEvents {
  step(data: StepData): void;
  /** The source registry grew (a search or a listing added numbers). */
  sources(): void;
  /** A saved edit of an existing note, so an open note can show it. */
  edit?(data: EditData): void;
  /** Autonomy "ask": all changes proposed so far. */
  proposal(actions: AgentAction[], labels: string[]): void;
  /** Autonomy "self": all changes carried out so far. */
  done(results: AgentActionResult[]): void;
}

export interface AgentToolEnv {
  auth: AuthContext;
  deps: Pick<ServerDeps, "log" | "now">;
  models: ModelRouter;
  /** The request the searches are based on (scope fields are replaced per search). */
  base: ChatRequest;
  registry: SourceRegistry;
  /** The open note, if any (target of tool calls without a source number). */
  noteId: string | null;
  autonomy: AgentAutonomy;
  events: AgentToolEvents;
}

export function createAgentTools(env: AgentToolEnv): ToolSet {
  const { registry } = env;
  const ctx = { client: env.auth.client, userId: env.auth.userId };
  const step = env.events.step;
  const agentTarget = (source: number | undefined): string | null =>
    source !== undefined ? (registry.get(source)?.item_id ?? null) : env.noteId;
  const proposed: AgentAction[] = [];
  const done: AgentActionResult[] = [];
  /** A change the model asks for: proposed (ask) or carried out at once (self). */
  const change = async (action: AgentAction) => {
    if (env.autonomy === "ask") {
      proposed.push(action);
      env.events.proposal([...proposed], proposed.map(actionLabel));
      return { ok: true, status: "proposed", note: t("Waiting for the user's confirmation; nothing was changed yet.") };
    }
    const result = await executeAction(ctx, action, (data) => env.events.edit?.(data));
    done.push(result);
    step({ kind: "write", label: result.label });
    env.events.done([...done]);
    return { ok: result.ok, status: result.ok ? "done" : "failed", error: result.error, item_id: result.item_id };
  };
  const agentTools = {
    vault_search: tool({
      description: byLocale({
        en: "Searches the user's whole vault (hybrid full-text + semantic). Returns numbered passages [n]. Call it several times with different wording.",
        de: "Durchsucht den ganzen Vault des Nutzers (Volltext + semantisch). Liefert nummerierte Passagen [n]. Mehrfach mit anderen Formulierungen aufrufen.",
      }),
      inputSchema: z.object({
        query: z.string().trim().min(2).max(300).describe(byLocale({ en: "What to look for, as keywords or a short question", de: "Wonach gesucht wird, als Stichworte oder kurze Frage" })),
        folder_path: z.string().trim().min(1).max(300).optional().describe(byLocale({ en: "Limit to a folder, e.g. 20_Meetings", de: "Auf einen Ordner begrenzen, z. B. 20_Meetings" })),
      }),
      execute: async ({ query, folder_path }) => {
        const hits = await retrieveSources(
          env.auth,
          { ...env.base, mode: folder_path ? "folder" : "brain", folder_path, cluster: undefined, item_id: undefined },
          query,
          env.models,
          env.deps.log,
        );
        const found = registry.add(hits);
        step({ kind: "search", label: query, count: found.length });
        env.events.sources();
        return {
          results: found.map((c) => ({
            n: c.n,
            title: c.title,
            type: c.type,
            folder: c.folder_path,
            where: c.page_or_timestamp,
            text: c.snippet,
          })),
        };
      },
    }),
    vault_list: tool({
      description: byLocale({
        en: "Lists entries newest first (title, type, folder, date, summary), optionally of one folder and of the last days. For 'what is new', the inbox or this week's notes.",
        de: "Listet Einträge, neueste zuerst (Titel, Typ, Ordner, Datum, Zusammenfassung), wahlweise eines Ordners und der letzten Tage. Für 'was ist neu', den Eingang oder die Notizen dieser Woche.",
      }),
      inputSchema: z.object({
        folder_path: z.string().trim().min(1).max(300).optional().describe(byLocale({ en: "Folder and its subfolders, e.g. 00_Inbox", de: "Ordner samt Unterordnern, z. B. 00_Inbox" })),
        days: z.number().int().min(1).max(365).optional().describe(byLocale({ en: "Only entries changed in the last days", de: "Nur Einträge, die in den letzten Tagen geändert wurden" })),
        limit: z.number().int().min(1).max(LIST_LIMIT).optional(),
      }),
      execute: async ({ folder_path, days, limit }) => {
        let q = env.auth.client
          .from("knowledge_items")
          .select("id,title,type,summary,content_md,folder_path,source_url,updated_at")
          .eq("user_id", env.auth.userId)
          .neq("status", "archived");
        if (folder_path) q = q.like("folder_path", `${folder_path.replace(/[%_]/g, "\\$&")}%`);
        if (days) q = q.gte("updated_at", new Date(env.deps.now().getTime() - days * 86_400_000).toISOString());
        const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit ?? 20);
        if (error) return { ok: false, error: error.message };
        const found = registry.add(
          (data ?? []).map((r) => ({
            item_id: r.id,
            title: r.title,
            type: r.type,
            page_or_timestamp: null,
            folder_path: r.folder_path,
            source_url: r.source_url,
            text: r.summary || (r.content_md ?? "").slice(0, 400),
          })),
        );
        step({ kind: "search", label: folder_path ?? t("Newest entries"), count: found.length });
        env.events.sources();
        return {
          results: found.map((c, i) => ({
            n: c.n,
            title: c.title,
            type: c.type,
            folder: c.folder_path,
            updated: data?.[i]?.updated_at?.slice(0, 10),
            text: c.snippet.slice(0, 400),
          })),
        };
      },
    }),
    note_read: tool({
      description: byLocale({
        en: "Reads the full Markdown content of an entry (source [n] or the open note).",
        de: "Liest den vollständigen Markdown-Inhalt eines Eintrags (Quelle [n] oder die geöffnete Notiz).",
      }),
      inputSchema: z.object({
        source: z.number().int().min(1).optional().describe(byLocale({ en: "Number [n] of the source; omit = the open note", de: "Nummer [n] der Quelle; weglassen = geöffnete Notiz" })),
      }),
      execute: async ({ source }) => {
        const id = agentTarget(source);
        if (!id) return { ok: false, error: t("Unclear which entry is meant") };
        const res = await readNoteFor(ctx, id);
        if (res.ok) step({ kind: "read", label: res.title ?? t("Entry") });
        return res;
      },
    }),
  };
  const writeTools = {
    note_create: tool({
      description: byLocale({
        en: "Creates a new note in the vault (briefing, draft, report, review).",
        de: "Legt eine neue Notiz im Vault an (Briefing, Entwurf, Bericht, Rückblick).",
      }),
      inputSchema: z.object({
        title: z.string().trim().min(1).max(300),
        markdown: z.string().max(60_000).describe(byLocale({ en: "Body as clean Markdown, without the title", de: "Inhalt als sauberes Markdown, ohne den Titel" })),
        folder_path: z.string().trim().min(1).max(300).optional().describe(byLocale({ en: "Target folder, e.g. 20_Meetings; omit = inbox", de: "Zielordner, z. B. 20_Meetings; weglassen = Eingang" })),
      }),
      execute: async (input) => change({ kind: "note_create", ...input }),
    }),
    note_edit: tool({
      description: byLocale({
        en: "Changes an existing entry: search & replace (all occurrences), append text, change the title.",
        de: "Ändert einen bestehenden Eintrag: Suchen & Ersetzen (alle Vorkommen), Text anhängen, Titel ändern.",
      }),
      inputSchema: noteEditInputSchema(),
      execute: async ({ source, ...input }) => {
        const id = agentTarget(source);
        if (!id) return { ok: false, error: t("Unclear which entry is meant") };
        const title = source !== undefined ? registry.get(source)?.title : undefined;
        const action = AgentActionSchema.safeParse({ kind: "note_edit", item_id: id, item_title: title, ...input });
        if (!action.success) return { ok: false, error: action.error.message };
        return change(action.data);
      },
    }),
    dossier_update: tool({
      description: byLocale({
        en: "Updates the living dossier of a person, company or project: rewrites the section 'Where things stand' and replaces the list of open points. The user's own notes and the rest of the entry stay untouched.",
        de: "Aktualisiert die lebende Akte einer Person, Firma oder eines Projekts: schreibt den Abschnitt 'Stand der Dinge' neu und ersetzt die Liste der offenen Punkte. Die eigenen Notizen des Nutzers und der Rest des Eintrags bleiben unberührt.",
      }),
      inputSchema: z.object({
        source: z.number().int().min(1).optional().describe(byLocale({ en: "Number [n] of the dossier; omit = the open note", de: "Nummer [n] der Akte; weglassen = geöffnete Notiz" })),
        state: z.string().max(6_000).optional().describe(byLocale({ en: "Where things stand now, as short Markdown without a heading", de: "Der aktuelle Stand der Dinge, als kurzes Markdown ohne Überschrift" })),
        open_points: z
          .array(z.string().trim().min(1).max(400))
          .max(30)
          .optional()
          .describe(byLocale({ en: "The complete list of open points, one short line each", de: "Die vollständige Liste der offenen Punkte, je eine kurze Zeile" })),
      }),
      execute: async ({ source, ...input }) => {
        const id = agentTarget(source);
        if (!id) return { ok: false, error: t("Unclear which entry is meant") };
        const title = registry.list().find((c) => c.item_id === id)?.title;
        return change({ kind: "dossier_update", item_id: id, ...(title ? { item_title: title } : {}), ...input });
      },
    }),
    task_create: tool({
      description: byLocale({
        en: "Creates a task (open loop, follow-up, next step).",
        de: "Legt eine Aufgabe an (offene Schleife, Nachfassen, nächster Schritt).",
      }),
      inputSchema: z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().max(2_000).optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
        source: z.number().int().min(1).optional().describe(byLocale({ en: "Number [n] of the entry the task comes from", de: "Nummer [n] des Eintrags, aus dem die Aufgabe stammt" })),
      }),
      execute: async ({ source, ...input }) => {
        const from = source !== undefined ? registry.get(source)?.item_id : undefined;
        return change({ kind: "task_create", ...input, ...(from ? { source_item_id: from } : {}) });
      },
    }),
  };
  return (env.autonomy === "read" ? agentTools : { ...agentTools, ...writeTools }) as ToolSet;
}
