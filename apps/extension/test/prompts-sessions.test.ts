// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TYPE_REGISTRY, validateTypeMetadata } from "@kortex/db";
import { describe, expect, it, vi } from "vitest";
import { createApiClient, mockIngest, validateIngestRequest, type ApiClient, type IngestResponse } from "../src/lib/api";
import { extractPrompt, findMessageElements } from "../src/lib/chat/extract";
import { CHATGPT } from "../src/lib/chat/selectors";
import { applyLimits } from "../src/lib/limits";
import { readPrompts, readSessions, rememberPrompt, rememberSession, removeSession, searchPrompts } from "../src/lib/library";
import { createOutbox } from "../src/lib/outbox";
import { buildPrompt, extractVariables, fillVariables, PROMPT_FOLDER } from "../src/lib/prompts";
import { buildSession, isSavableUrl, saveSession, SESSION_FOLDER, savableTabs } from "../src/lib/sessions";
import { memoryStore } from "../src/lib/settings";

const now = new Date("2026-10-31T14:05:00Z");

describe("prompts", () => {
  it("finds unique {{variables}} in order", () => {
    expect(extractVariables("Übersetze {{text}} nach {{ sprache }} und {{text}}")).toEqual(["text", "sprache"]);
    expect(extractVariables("keine {Variable} und {{}}")).toEqual([]);
  });

  it("fills variables and keeps unfilled placeholders", () => {
    expect(fillVariables("A {{x}} B {{y}}", { x: "1", y: " " })).toBe("A 1 B {{y}}");
  });

  it("builds a prompt note that follows the registry", () => {
    const req = buildPrompt("Fasse {{text}} zusammen", now);
    expect(req).toMatchObject({ kind: "note", type_hint: "prompt", folder_path: PROMPT_FOLDER, metadata: { variables: ["text"] } });
    expect(PROMPT_FOLDER).toBe(TYPE_REGISTRY.prompt.folder);
    expect(validateIngestRequest(req)).toBeNull();
    expect(validateTypeMetadata("prompt", req.metadata!)).toMatchObject({ ok: true });
  });

  it("extracts only the user message from a chat page", () => {
    document.documentElement.innerHTML = readFileSync(resolve(process.cwd(), "test/fixtures/chatgpt.html"), "utf8");
    const [user, assistant] = findMessageElements(document, CHATGPT);
    expect(extractPrompt(document, CHATGPT, user!.el)?.text).toMatch(/^Wie chunke ich/);
    expect(extractPrompt(document, CHATGPT, assistant!.el)).toBeNull();
  });

  it("is searchable and kept in the local catalogue", async () => {
    const store = memoryStore();
    await rememberPrompt(store, { id: "1", title: "Übersetzer", text: "Übersetze {{text}}", saved_at: now.toISOString() });
    await rememberPrompt(store, { id: "2", title: "Code Review", text: "Prüfe den Diff", saved_at: now.toISOString() });
    const all = await readPrompts(store);
    expect(all[0]!.variables).toEqual([]);
    expect(searchPrompts(all, "text übersetz").map((p) => p.id)).toEqual(["1"]);
    expect(searchPrompts(all, "")).toHaveLength(2);
  });
});

const tabs = [
  { id: 1, url: "https://a.dev/x", title: "A [wip]" },
  { id: 2, url: "chrome://settings", title: "Settings" },
  { id: 3, url: "about:blank" },
  { id: 4, url: "https://b.dev/", title: "B" },
  { id: 5, url: "file:///c.txt" },
];

describe("sessions", () => {
  it("captures only http(s) tabs", () => {
    expect(savableTabs(tabs).map((t) => t.id)).toEqual([1, 4]);
    expect(isSavableUrl("chrome-extension://x")).toBe(false);
  });

  it("builds one session note: markdown link list + registry metadata", () => {
    const req = buildSession(tabs, now, "Recherche");
    expect(req).toMatchObject({ kind: "note", type_hint: "session", folder_path: SESSION_FOLDER });
    expect(SESSION_FOLDER).toBe(TYPE_REGISTRY.session.folder);
    expect(req.title).toBe("Recherche · Session 2026-10-31 14:05 (2 Tabs)");
    expect(req.content_md).toContain(String.raw`- [A \[wip\]](<https://a.dev/x>)`);
    expect(req.metadata).toEqual({
      saved_at: now.toISOString(),
      tabs: [{ url: "https://a.dev/x", title: "A [wip]" }, { url: "https://b.dev/", title: "B" }],
    });
    expect(validateTypeMetadata("session", req.metadata!)).toMatchObject({ ok: true });
  });

  const delivered: IngestResponse = { ok: true, kind: "note", item_id: "i1", type: "session", status: "inbox", folder_path: SESSION_FOLDER, auto_routed: false, duplicate: false };

  async function run(response: IngestResponse, close = true) {
    const api: Pick<ApiClient, "ingest"> = { ingest: async () => response };
    const outbox = createOutbox({ store: memoryStore(), api });
    const closeTabs = vi.fn(async () => undefined);
    const res = await saveSession({ tabs, submit: (r) => outbox.submit(r), closeTabs, close, now });
    return { res, closeTabs, outbox };
  }

  it("closes the saved tabs only after the server confirmed", async () => {
    const { res, closeTabs } = await run(delivered);
    expect(res).toMatchObject({ ok: true, saved: 2, closed: 2 });
    expect(closeTabs).toHaveBeenCalledWith([1, 4]);
  });

  it("keeps all tabs open when offline (queued in the outbox)", async () => {
    const { res, closeTabs, outbox } = await run({ ok: false, error: { code: "network", message: "offline" } });
    expect(res).toMatchObject({ ok: false, reason: "queued" });
    expect(closeTabs).not.toHaveBeenCalled();
    expect(await outbox.size()).toBe(1);
  });

  it("keeps all tabs open on a final error and with 'nur speichern'", async () => {
    const bad = await run({ ok: false, error: { code: "unauthorized", message: "no" } });
    expect(bad.res).toMatchObject({ ok: false, reason: "error" });
    expect(bad.closeTabs).not.toHaveBeenCalled();
    const keep = await run(delivered, false);
    expect(keep.res).toMatchObject({ ok: true, closed: 0 });
    expect(keep.closeTabs).not.toHaveBeenCalled();
  });

  it("counts duplicate/replayed answers as saved, ignores unknown extra fields", async () => {
    for (const extra of [{ duplicate: true }, { replayed: true }, { merged_into: "x", surprise: 1 }]) {
      const { res, closeTabs } = await run({ ...delivered, ...extra } as IngestResponse);
      expect(res).toMatchObject({ ok: true, closed: 2 });
      expect(closeTabs).toHaveBeenCalledTimes(1);
    }
  });

  it("never closes on an unknown response shape", async () => {
    for (const odd of [{ ok: true }, { ok: true, item_id: "" }, { ok: true, item_id: 7 }]) {
      const { res, closeTabs } = await run(odd as unknown as IngestResponse);
      expect(res.ok).toBe(false);
      expect(closeTabs).not.toHaveBeenCalled();
    }
  });

  it("stays saved when closing fails, reports what stayed open and never closes pinned tabs", async () => {
    const api: Pick<ApiClient, "ingest"> = { ingest: async () => delivered };
    const outbox = createOutbox({ store: memoryStore(), api });
    const broken = await saveSession({ tabs, submit: (r) => outbox.submit(r), closeTabs: async () => Promise.reject(new Error("Tabs cannot be edited right now")), close: true, now });
    expect(broken).toMatchObject({ ok: true, saved: 2, closed: 0, keptOpen: 2 });

    const partly = await saveSession({ tabs, submit: (r) => outbox.submit(r), closeTabs: async () => [4], close: true, now });
    expect(partly).toMatchObject({ ok: true, closed: 1, keptOpen: 1, closedTabs: [{ url: "https://b.dev/" }] });

    const closeTabs = vi.fn(async (ids: number[]) => ids);
    const pinned = await saveSession({ tabs: tabs.map((t) => (t.id === 1 ? { ...t, pinned: true } : t)), submit: (r) => outbox.submit(r), closeTabs, close: true, now });
    expect(closeTabs).toHaveBeenCalledWith([4]);
    expect(pinned).toMatchObject({ ok: true, saved: 2, closed: 1, keptOpen: 1 });
  });

  it("refuses a session without savable tabs", async () => {
    const res = await saveSession({ tabs: [tabs[1]!], submit: vi.fn(), closeTabs: vi.fn(), close: true });
    expect(res).toMatchObject({ ok: false, reason: "empty" });
  });

  it("remembers sessions locally and can drop them", async () => {
    const store = memoryStore();
    await rememberSession(store, tabs.slice(0, 1), { id: "s1", title: "S", saved_at: now.toISOString() });
    expect((await readSessions(store))[0]!.tabs).toEqual([{ url: "https://a.dev/x", title: "A [wip]" }]);
    await removeSession(store, "s1");
    expect(await readSessions(store)).toEqual([]);
  });
});

describe("note kind in the client", () => {
  it("passes limits and mock ingest, filed as the hinted type", async () => {
    const req = buildPrompt("hallo", now);
    expect(applyLimits(req).error).toBeUndefined();
    expect(mockIngest(req, now)).toMatchObject({ type: "prompt", folder_path: PROMPT_FOLDER, auto_routed: false });
    const api = createApiClient({ getSettings: async () => ({ mockMode: true, baseUrl: "https://x.dev", token: "", theme: "dark" } as never), recordMock: async () => undefined });
    expect(await api.ingest(req)).toMatchObject({ ok: true, type: "prompt" });
  });
});
