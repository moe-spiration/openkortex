import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { t } from "../i18n";
import { AI_MEMORIES_FOLDER, type IngestFailure } from "../lib/api";
import { describeFailure } from "../lib/errors";
import { extractAnswer, extractChat, extractPrompt, findMessageElements } from "../lib/chat/extract";
import type { PlatformSpec } from "../lib/chat/selectors";
import { sendViaBackground } from "../lib/messages";
import { memoryFileName } from "../lib/api";
import { PROMPT_FOLDER, buildPrompt } from "../lib/prompts";
import { buildAiChat } from "../lib/requests";
import type { ExtensionSettings } from "../lib/settings";
import { SaveAnswerButton, SaveChatButton, SavePromptButton, type SaveState } from "../ui/ChatControls";
import { Toast, type ToastMessage } from "../ui/Toast";
import { mountReact, type MountedUi } from "./mount";
import { createStore, useStore } from "./store";

interface ChatState {
  hasMessages: boolean;
  chat: SaveState;
  answers: Record<string, SaveState>;
  prompts: Record<string, SaveState>;
  toast: ToastMessage | null;
}

const idle: SaveState = { status: "idle" };

export async function startChatExport(ctx: ContentScriptContext, settings: ExtensionSettings, spec: PlatformSpec) {
  const store = createStore<ChatState>({ hasMessages: false, chat: idle, answers: {}, prompts: {}, toast: null });
  const ids = new WeakMap<Element, string>();
  const mounted = new Map<string, { el: Element; ui: MountedUi }>();
  let seq = 0;
  let lastUrl = location.href;

  const toast = (text: string, tone: ToastMessage["tone"] = "success") => store.set((s) => ({ ...s, toast: { text, tone } }));
  const idOf = (el: Element) => {
    let id = ids.get(el);
    if (!id) ids.set(el, (id = `a${++seq}`));
    return id;
  };

  async function submit(content: { title: string; content_md: string; count: number }, scope: "chat" | "answer") {
    const res = await sendViaBackground(
      buildAiChat({
        platform: spec.id,
        scope,
        url: location.href,
        title: content.title,
        content_md: content.content_md,
        message_count: content.count,
      }, new Date(), settings.summaryLevel),
    );
    if (!res.ok) return { ok: false as const, message: describeFailure({ ok: false, error: res.error as IngestFailure["error"] }).message };
    const file = res.delivered && res.response.file ? res.response.file : memoryFileName(content.title, new Date());
    return { ok: true as const, file, notices: res.notices ?? [] };
  }

  async function saveChat() {
    const chat = extractChat(document, spec);
    if (chat.messages.length === 0) return toast(t("No chat found to save"), "error");
    store.set((s) => ({ ...s, chat: { status: "saving" } }));
    const res = await submit({ title: chat.title, content_md: chat.content_md, count: chat.messages.length }, "chat");
    if (!res.ok) {
      store.set((s) => ({ ...s, chat: { status: "error", message: res.message } }));
      return toast(res.message, "error");
    }
    const saved: SaveState = { status: "saved", file: res.file };
    store.set((s) => ({
      ...s,
      chat: saved,
      // the whole chat contains every answer
      answers: Object.fromEntries([...mounted.keys()].map((id) => [id, saved])),
    }));
    toast([t("Whole chat exported to {folder}/", { folder: AI_MEMORIES_FOLDER }), ...res.notices].join(". "));
  }

  async function savePrompt(id: string, el: Element) {
    const one = extractPrompt(document, spec, el);
    if (!one) return toast(t("Prompt not found"), "error");
    const set = (state: SaveState) => store.set((s) => ({ ...s, prompts: { ...s.prompts, [id]: state } }));
    set({ status: "saving" });
    const request = buildPrompt(one.text, new Date(), one.title);
    const res = await sendViaBackground(request);
    if (!res.ok) {
      const message = describeFailure({ ok: false, error: res.error as IngestFailure["error"] }).message;
      set({ status: "error", message });
      return toast(message, "error");
    }
    const file = res.delivered && res.response.file ? res.response.file : memoryFileName(request.title, new Date());
    set({ status: "saved", file });
    toast([t("Prompt saved to {folder}/", { folder: PROMPT_FOLDER }), ...(res.notices ?? [])].join(". "));
  }

  async function saveAnswer(id: string, el: Element) {
    const one = extractAnswer(document, spec, el);
    if (!one) return toast(t("Answer not found"), "error");
    store.set((s) => ({ ...s, answers: { ...s.answers, [id]: { status: "saving" } } }));
    const res = await submit({ title: one.title, content_md: one.content_md, count: one.messages.length }, "answer");
    if (!res.ok) {
      store.set((s) => ({ ...s, answers: { ...s.answers, [id]: { status: "error", message: res.message } } }));
      return toast(res.message, "error");
    }
    store.set((s) => ({ ...s, answers: { ...s.answers, [id]: { status: "saved", file: res.file } } }));
    toast([t("Answer saved to {folder}/", { folder: AI_MEMORIES_FOLDER }), ...res.notices].join(". "));
  }

  await mountReact(ctx, {
    name: "kortex-chat",
    theme: settings.theme,
    position: "overlay",
    node: <ChatOverlay store={store} onSave={() => void saveChat()} />,
  });

  async function syncAnswerButtons() {
    const streaming = document.querySelector(spec.streaming) !== null;
    const messages = findMessageElements(document, spec);
    store.set((s) => (s.hasMessages === messages.length > 0 ? s : { ...s, hasMessages: messages.length > 0 }));

    const assistants = messages.filter((m) => m.role === "assistant");
    const live = new Set<string>();
    for (const { el, role } of messages) {
      // never offer the answer that is still being written
      if (role === "assistant" && streaming && el === assistants[assistants.length - 1]?.el) continue;
      const id = idOf(el);
      live.add(id);
      const existing = mounted.get(id);
      if (existing?.ui.host.isConnected) continue;
      existing?.ui.remove();
      mounted.set(id, { el, ui: await (role === "user" ? mountPrompt(id, el) : mountAnswer(id, el)) });
    }
    for (const [id, m] of mounted) {
      if (!live.has(id) && !m.el.isConnected) {
        m.ui.remove();
        mounted.delete(id);
      }
    }
  }

  function mountPrompt(id: string, el: Element) {
    return mountReact(ctx, {
      name: "kortex-prompt",
      theme: settings.theme,
      position: "inline",
      anchor: spec.actionHost(el),
      append: "last",
      node: <PromptView id={id} store={store} onSave={() => void savePrompt(id, el)} />,
    });
  }

  function mountAnswer(id: string, el: Element) {
    return mountReact(ctx, {
      name: "kortex-answer",
      theme: settings.theme,
      position: "inline",
      anchor: spec.actionHost(el),
      append: "last",
      node: <AnswerView id={id} store={store} onSave={() => void saveAnswer(id, el)} />,
    });
  }

  let timer: number | undefined;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (location.href !== lastUrl) {
        // SPA navigation to another conversation: forget what was saved
        lastUrl = location.href;
        for (const m of mounted.values()) m.ui.remove();
        mounted.clear();
        store.set({ hasMessages: false, chat: idle, answers: {}, prompts: {}, toast: null });
      }
      void syncAnswerButtons();
    }, 400);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.querySelector(spec.root) ?? document.body, { childList: true, subtree: true });
  ctx.onInvalidated(() => {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const m of mounted.values()) m.ui.remove();
  });
  schedule();
}

function ChatOverlay({ store, onSave }: { store: ReturnType<typeof createStore<ChatState>>; onSave: () => void }) {
  const s = useStore(store);
  return (
    <>
      {s.hasMessages && (
        <div style={{ position: "fixed", right: 24, bottom: 112 }}>
          <SaveChatButton state={s.chat} onSave={onSave} />
        </div>
      )}
      {s.toast && (
        <div style={{ position: "fixed", bottom: 48, left: "50%", marginLeft: -180 }}>
          <Toast message={s.toast} onDone={() => store.set((p) => ({ ...p, toast: null }))} />
        </div>
      )}
    </>
  );
}

function AnswerView({ id, store, onSave }: { id: string; store: ReturnType<typeof createStore<ChatState>>; onSave: () => void }) {
  const state = useStore(store).answers[id] ?? idle;
  return (
    <div style={{ padding: "6px 0" }}>
      <SaveAnswerButton state={state} onSave={onSave} />
    </div>
  );
}

function PromptView({ id, store, onSave }: { id: string; store: ReturnType<typeof createStore<ChatState>>; onSave: () => void }) {
  const state = useStore(store).prompts[id] ?? idle;
  return (
    <div style={{ padding: "6px 0" }}>
      <SavePromptButton state={state} onSave={onSave} />
    </div>
  );
}
