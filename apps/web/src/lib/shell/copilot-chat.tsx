"use client";

import { t, tn, tx } from "@/i18n";
import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClientError, agentRun, chatAction, type ChatActionResponse, type CitationsData } from "@/lib/api/client";
import type { AgentActionResult, AgentAutonomy, AgentSkill, AgentUndo, DoneData, ProposalData, StepData } from "@/server/chat/agent";
import type { ContextMode } from "@/server/chat/contract";
import type { EditData } from "@/server/chat/edit";
import { useNotes } from "@/lib/notes/store";
import { isLiveData, noteById } from "@/lib/workspace-data";
import { effectiveScope, scopeBody, type SearchScope } from "./orbit";
import { routeInfo } from "./routes";
import { useShell } from "./store";
import type { ChipId } from "./copilot";

/*
 * Live Hybrid-RAG copilot (WP-B1): one AI SDK `Chat` for the whole workspace, streamed from
 * POST /api/chat. The first stream part of every answer is `data-citations` (numbered sources);
 * the answer cites them as [n]. Quick chips call POST /api/chat/action on the open note and
 * append their result to the same conversation.
 */

/** Client message: the server's citations and edit data parts, plus a marker for chip results. */
export type CopilotMessage = UIMessage<
  { action?: ChipId },
  { citations: CitationsData; edit: EditData; step: StepData; proposal: ProposalData; done: DoneData }
>;

/** What became of the agent's changes of one answer (proposal card, undo). */
export interface AgentOutcome {
  state: "running" | "confirmed" | "dismissed" | "undone";
  results?: AgentActionResult[];
}

const AUTONOMY_KEY = "kortex.agent.autonomy";
const AUTONOMY: readonly AgentAutonomy[] = ["read", "ask", "self"];
function storedAutonomy(): AgentAutonomy {
  try {
    const v = window.localStorage.getItem(AUTONOMY_KEY) as AgentAutonomy | null;
    return v && AUTONOMY.includes(v) ? v : "ask";
  } catch {
    return "ask";
  }
}

/** Toast text of a copilot edit: "„Q4 Sync“ geändert · 7 Ersetzungen". */
export function editToast(edit: EditData): string {
  const n = edit.replacements.reduce((sum, r) => sum + r.count, 0);
  const parts = [
    n ? tn(n, "{n} replacement", "{n} replacements") : null,
    edit.appended_md ? t("text added") : null,
    edit.previous_title ? t("renamed") : null,
  ].filter(Boolean);
  return t("“{title}” changed", { title: edit.title }) + (parts.length ? ` · ${parts.join(", ")}` : "");
}

export const MODE_LABEL: Record<ContextMode, string> = {
  get note() {
    return t("Note");
  },
  get folder() {
    return t("Folder");
  },
  get brain() {
    return t("Everything");
  },
};

/** Copilot context tab → Orbit-Bar Suchbereich. */
const MODE_SCOPE: Record<ContextMode, SearchScope> = { note: "note", folder: "space", brain: "all" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CopilotScope {
  /** Open note (drawer, full note or reader) with a database id. */
  itemId: string | null;
  itemTitle: string | null;
  /** Folder of the vault view, else the open note's folder. */
  folderPath: string | null;
  available: ContextMode[];
  defaultMode: ContextMode;
}

/** What the copilot can talk about right now (open note, current folder, whole brain). */
export function useCopilotScope(): CopilotScope {
  const pathname = usePathname();
  const { drawer } = useShell();
  return useMemo(() => {
    const info = routeInfo(pathname);
    const routeId = info.view === "notes" || info.view === "reader" ? (info.rest[0] ?? null) : null;
    const id = drawer.id ?? routeId;
    const note = id ? noteById(id) : undefined;
    const itemId = id && UUID.test(id) ? id : null;
    const vaultFolder = info.view === "vault" && !info.doc ? info.rest.join("/") : null;
    const noteFolder = note?.path.includes("/") ? note.path.split("/").slice(0, -1).join("/") : null;
    const folderPath = vaultFolder || noteFolder || null;
    const available: ContextMode[] = [...(itemId ? (["note"] as const) : []), ...(folderPath ? (["folder"] as const) : []), "brain"];
    return {
      itemId,
      itemTitle: note?.title ?? null,
      folderPath,
      available,
      defaultMode: itemId ? "note" : vaultFolder ? "folder" : "brain",
    };
  }, [pathname, drawer.id]);
}

/** Readable message of a failed chat or action call (API errors arrive as the JSON body). */
export function chatErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  const raw = err instanceof Error ? err.message : String(err ?? "");
  try {
    const body = JSON.parse(raw) as { error?: { code?: string; message?: string } };
    if (body?.error?.code === "unauthorized") return t("Not signed in. Please sign in again.");
    if (body?.error?.message) return body.error.message;
  } catch {
    /* plain text error */
  }
  if (/failed to fetch|networkerror/i.test(raw)) return t("No connection to the server.");
  return raw || t("The copilot is not reachable right now.");
}

let msgSeq = 0;
const localId = () => `local-${Date.now().toString(36)}-${(msgSeq++).toString(36)}`;

const CHIP_ACTION: Record<ChipId, "summarize" | "tasks" | "flashcards"> = { tldr: "summarize", tasks: "tasks", cards: "flashcards" };
const CHIP_PROMPT: Record<ChipId, () => string> = { tldr: () => t("TL;DR"), tasks: () => t("Extract tasks"), cards: () => tx("chip", "Flashcards") };

/** Markdown for a chip result (shown as an assistant message). */
export function actionMarkdown(res: ChatActionResponse): string {
  if (res.action === "flashcards")
    return res.flashcards.length
      ? res.flashcards.map((c, i) => `${i + 1}. **${c.question.trim()}** ${c.answer.trim()}`).join("\n")
      : t("No cards created.");
  if (res.action === "tasks")
    return res.action_items.length
      ? res.action_items
          .map((task) => `- ${task.title.trim()}${task.due_date ? ` ${t("(by {date})", { date: task.due_date })}` : ""}${task.priority !== "medium" ? ` · ${task.priority}` : ""}`)
          .join("\n")
      : t("No tasks found.");
  if (res.action === "status") {
    const fields = Object.entries(res.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(", ");
    return res.saved ? t("**{title}** updated ({fields}).", { title: res.title, fields }) : t("**{title}** would be updated ({fields}).", { title: res.title, fields });
  }
  return res.content_md.trim();
}

interface CopilotChatValue {
  live: boolean;
  messages: CopilotMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  /** A chip action is running (label shown as a pending row). */
  pendingAction: string | null;
  error: string | null;
  scope: CopilotScope;
  mode: ContextMode;
  setMode: (m: ContextMode) => void;
  /** Orbit-Bar Suchbereich (Alles, Dieser Space, Geöffnete Notiz, Nur Objekte); drives `mode`. */
  searchScope: SearchScope;
  setSearchScope: (s: SearchScope) => void;
  /** Folder the answer is limited to (folder mode, incl. 70_Objects for "Nur Objekte"). */
  folderPath: string | null;
  send: (text: string, opts?: { skill?: AgentSkill }) => void;
  /** How far the agent may go: read only, propose changes (default), or make them at once. */
  autonomy: AgentAutonomy;
  setAutonomy: (a: AgentAutonomy) => void;
  /** Per answer (message id): what happened to its proposed or made changes. */
  outcomes: Record<string, AgentOutcome>;
  /** Carries out the picked actions of an answer's proposal. */
  confirmProposal: (messageId: string, proposal: ProposalData, picked: readonly number[]) => void;
  dismissProposal: (messageId: string) => void;
  /** Takes back the changes of an answer (confirmed proposal or autonomous run). */
  undoChanges: (messageId: string, results: readonly AgentActionResult[]) => void;
  runChip: (chip: ChipId) => void;
  stop: () => void;
  retry: () => void;
  reset: () => void;
}

const Ctx = createContext<CopilotChatValue | null>(null);

export function CopilotChatProvider({ children }: { children: ReactNode }) {
  const live = isLiveData();
  const { setCopilot, showToast } = useShell();
  const notes = useNotes();
  // An edit the copilot saved (data-edit): show it in the open note at once and offer "Rückgängig".
  const onEdit = useRef<(edit: EditData) => void>(() => undefined);
  onEdit.current = (edit) => {
    const before = notes.applyServerEdit(edit.item_id, {
      ...(edit.content_md !== undefined ? { contentMd: edit.content_md } : {}),
      ...(edit.previous_title ? { title: edit.title } : {}),
      replacements: edit.replacements,
      ...(edit.appended_md ? { appendedMd: edit.appended_md } : {}),
    });
    if (!before) {
      showToast(editToast(edit));
      return;
    }
    showToast(editToast(edit), {
      label: t("Undo"),
      run: () => {
        if (edit.content_md !== undefined) notes.setContent(edit.item_id, before.contentMd);
        if (edit.previous_title) notes.setTitle(edit.item_id, edit.previous_title);
      },
    });
  };
  const [chat] = useState(
    () =>
      new Chat<CopilotMessage>({
        transport: new DefaultChatTransport({ api: "/api/chat", credentials: "same-origin" }),
        onData: (part) => {
          if (part.type === "data-edit") onEdit.current(part.data);
        },
      }),
  );
  const { messages, status, error, sendMessage, setMessages, stop, regenerate, clearError } = useChat({ chat, throttle: 40 });
  const scope = useCopilotScope();
  // One choice for the copilot tabs (Notiz / Ordner / Alles) and the Orbit-Bar Suchbereich.
  const [picked, setPicked] = useState<SearchScope | null>(null);
  const searchScope = effectiveScope(picked, scope, MODE_SCOPE[scope.defaultMode]);
  const scoped = scopeBody(searchScope, scope);
  const mode = scoped.mode;
  const folderPath = scoped.mode === "folder" ? scoped.folder_path : null;
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autonomy, setAutonomyState] = useState<AgentAutonomy>("ask");
  useEffect(() => setAutonomyState(storedAutonomy()), []);
  const setAutonomy = useCallback((a: AgentAutonomy) => {
    setAutonomyState(a);
    try {
      window.localStorage.setItem(AUTONOMY_KEY, a);
    } catch {
      /* private window: the choice lasts for this session */
    }
  }, []);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const [outcomes, setOutcomes] = useState<Record<string, AgentOutcome>>({});
  const outcome = useCallback((id: string, o: AgentOutcome) => setOutcomes((all) => ({ ...all, [id]: o })), []);

  const confirmProposal = useCallback(
    (messageId: string, proposal: ProposalData, picked: readonly number[]) => {
      const actions = proposal.actions.filter((_, i) => picked.includes(i));
      if (!actions.length) return;
      outcome(messageId, { state: "running" });
      void agentRun({ op: "execute", actions })
        .then((res) => {
          outcome(messageId, { state: "confirmed", results: res.results });
          for (const edit of res.edits) notesRef.current.applyServerEdit(edit.item_id, {
            ...(edit.content_md !== undefined ? { contentMd: edit.content_md } : {}),
            ...(edit.previous_title ? { title: edit.title } : {}),
            replacements: edit.replacements,
            ...(edit.appended_md ? { appendedMd: edit.appended_md } : {}),
          });
          const failed = res.results.filter((r) => !r.ok).length;
          showToast(failed ? tn(failed, "{n} change failed", "{n} changes failed") : tn(res.results.length, "{n} change made", "{n} changes made"));
        })
        .catch((err: unknown) => {
          setOutcomes((all) => {
            const rest = { ...all };
            delete rest[messageId];
            return rest;
          });
          showToast(chatErrorMessage(err));
        });
    },
    [outcome, showToast],
  );
  const dismissProposal = useCallback((messageId: string) => outcome(messageId, { state: "dismissed" }), [outcome]);
  const undoChanges = useCallback(
    (messageId: string, results: readonly AgentActionResult[]) => {
      const undo = results.map((r) => r.undo).filter((u): u is AgentUndo => !!u);
      if (!undo.length) return;
      void agentRun({ op: "undo", undo })
        .then((res) => {
          const failed = res.results.filter((r) => !r.ok).length;
          if (!failed) outcome(messageId, { state: "undone", results: [...results] });
          for (const u of undo)
            if (u.kind === "note_edit") {
              if (u.previous_md !== undefined) notesRef.current.setContent(u.item_id, u.previous_md);
              if (u.previous_title) notesRef.current.setTitle(u.item_id, u.previous_title);
            }
          showToast(failed ? tn(failed, "{n} change could not be undone", "{n} changes could not be undone") : t("Changes undone"));
        })
        .catch((err: unknown) => showToast(chatErrorMessage(err)));
    },
    [outcome, showToast],
  );

  // The open note travels with every scope: it is the default target of the copilot's edit tools.
  const body = useCallback(
    (skill?: AgentSkill) => ({
      ...(scope.itemId ? { item_id: scope.itemId } : {}),
      ...scopeBody(searchScope, scope),
      agent: true,
      autonomy,
      ...(skill ? { skill } : {}),
    }),
    [searchScope, scope, autonomy],
  );

  const send = useCallback(
    (text: string, opts?: { skill?: AgentSkill }) => {
      const q = text.trim();
      if (!q) return;
      setCopilot(true);
      setActionError(null);
      if (status === "streaming" || status === "submitted") void stop();
      clearError();
      void sendMessage({ text: q }, { body: body(opts?.skill) });
    },
    [setCopilot, status, stop, clearError, sendMessage, body],
  );

  const runChip = useCallback(
    (chip: ChipId) => {
      setCopilot(true);
      if (!scope.itemId) {
        showToast(t("Open a note, then the chip acts on it"));
        return;
      }
      const label = `${CHIP_PROMPT[chip]()} · ${scope.itemTitle ?? t("Note")}`;
      const user: CopilotMessage = { id: localId(), role: "user", parts: [{ type: "text", text: label }] };
      setMessages((m) => [...m, user]);
      setPendingAction(label);
      setActionError(null);
      void chatAction({ action: CHIP_ACTION[chip], item_id: scope.itemId, save: chip !== "tldr" })
        .then((res) => {
          const answer: CopilotMessage = {
            id: localId(),
            role: "assistant",
            metadata: { action: chip },
            parts: [{ type: "text", text: actionMarkdown(res) }],
          };
          setMessages((m) => [...m, answer]);
          if (res.saved && res.action === "tasks") showToast(tn(res.action_items.length, "{n} task created", "{n} tasks created"));
          else if (res.saved && res.action === "flashcards") showToast(tn(res.flashcards.length, "{n} card saved", "{n} cards saved"));
        })
        .catch((err: unknown) => setActionError(chatErrorMessage(err)))
        .finally(() => setPendingAction(null));
    },
    [setCopilot, scope.itemId, scope.itemTitle, setMessages, showToast],
  );

  const value = useMemo<CopilotChatValue>(
    () => ({
      live,
      messages,
      status,
      pendingAction,
      error: actionError ?? (error ? chatErrorMessage(error) : null),
      scope,
      mode,
      setMode: (m: ContextMode) => setPicked(MODE_SCOPE[m]),
      searchScope,
      setSearchScope: setPicked,
      folderPath,
      send,
      autonomy,
      setAutonomy,
      outcomes,
      confirmProposal,
      dismissProposal,
      undoChanges,
      runChip,
      stop: () => void stop(),
      retry: () => {
        // A failed chip only needs dismissing; a failed answer is regenerated.
        if (actionError) {
          setActionError(null);
          return;
        }
        clearError();
        void regenerate({ body: body() });
      },
      reset: () => {
        void stop();
        clearError();
        setActionError(null);
        setMessages([]);
        setOutcomes({});
      },
    }),
    [autonomy, setAutonomy, outcomes, confirmProposal, dismissProposal, undoChanges, live, messages, status, pendingAction, actionError, error, scope, mode, searchScope, folderPath, send, runChip, stop, clearError, regenerate, body, setMessages],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopilotChat(): CopilotChatValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCopilotChat must be used inside <CopilotChatProvider>");
  return v;
}
