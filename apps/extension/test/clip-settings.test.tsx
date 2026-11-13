// @vitest-environment jsdom
// Feedback round 3: C1 summary detail (`summary_level` in the ingest request) and C2 Autosave
// (a toolbar click saves at once, badge + short confirmation, outbox when offline).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient, mockIngest, type IngestRequest, type IngestResponse } from "../src/lib/api";
import { badgeFor } from "../src/lib/badge";
import { createOutbox, type SubmitResult } from "../src/lib/outbox";
import type { PageMeta } from "../src/lib/page-meta";
import { buildAiChat, buildWebClip, defaultClipChoice } from "../src/lib/requests";
import { DEFAULT_SETTINGS, loadSettings, memoryStore, saveSettings, type ExtensionSettings } from "../src/lib/settings";
import { ClipperPanel } from "../src/ui/ClipperPanel";
import { QuickSave } from "../src/ui/QuickSave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page: PageMeta = {
  url: "https://engineering-notes.dev/contextual-retrieval",
  title: "Contextual Retrieval in der Praxis",
  description: "RAG und MCP",
  image_url: "https://engineering-notes.dev/cover.jpg",
  site_name: null,
  domain: "engineering-notes.dev",
  reading_minutes: 8,
  keywords: [],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const remount = () => {
  act(() => root.unmount());
  root = createRoot(host);
};
const byText = (text: string, sel = "button") => [...host.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.includes(text));
const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
const deliver = () => vi.fn(async (req: IngestRequest): Promise<SubmitResult> => ({ ok: true, delivered: true, response: mockIngest(req) }));
let delivered = deliver();
const settings = (over: Partial<ExtensionSettings> = {}): ExtensionSettings => ({ ...DEFAULT_SETTINGS, ...over });

beforeEach(() => {
  delivered = deliver();
});

describe("C1 summary detail", () => {
  it("defaults to concise and survives a settings round trip", async () => {
    const store = memoryStore();
    expect((await loadSettings(store)).summaryLevel).toBe("concise");
    // an older saved settings object without the field still loads with the default
    await store.set("settings", { token: "kx_x" });
    expect((await loadSettings(store)).summaryLevel).toBe("concise");
    await saveSettings(store, { summaryLevel: "detailed" });
    expect((await loadSettings(store)).summaryLevel).toBe("detailed");
  });

  it("puts summary_level into web clips and chats, and leaves it out when unset", () => {
    expect(buildWebClip(page, { folder: null, tags: [], note: "", summaryLevel: "detailed" }).summary_level).toBe("detailed");
    expect(buildWebClip(page, { folder: null, tags: [], note: "" })).not.toHaveProperty("summary_level");
    const chat = { platform: "claude" as const, scope: "chat" as const, url: "https://claude.ai/chat/1", title: "C", content_md: "x", message_count: 1 };
    expect(buildAiChat(chat, new Date(), "concise").summary_level).toBe("concise");
    expect(buildAiChat(chat)).not.toHaveProperty("summary_level");
  });

  it("sends summary_level in the POST /api/ingest body", async () => {
    const answer: IngestResponse = { ok: true, kind: "web_clip", item_id: "i1", type: "article", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }));
    const api = createApiClient({ getSettings: async () => settings({ baseUrl: "https://kortex.example.com", token: "kx_" + "a".repeat(43) }), fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.ingest(buildWebClip(page, { folder: null, tags: [], note: "", summaryLevel: "detailed" }));
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "web_clip", summary_level: "detailed" });
  });

  it("the popup form shows the setting, saves a change and sends the chosen level", async () => {
    const onSettingsChange = vi.fn();
    render(<ClipperPanel page={page} settings={settings()} send={delivered} onClose={() => {}} onSettingsChange={onSettingsChange} />);
    const tab = (label: string) => byText(label, "[role=tab]");
    expect(tab("Knapp")?.getAttribute("aria-selected")).toBe("true");
    click(tab("Ausführlich"));
    expect(onSettingsChange).toHaveBeenCalledWith({ summaryLevel: "detailed" });
    expect(tab("Ausführlich")?.getAttribute("aria-selected")).toBe("true");
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});
    expect(delivered.mock.calls[0]![0]).toMatchObject({ kind: "web_clip", summary_level: "detailed" });
  });

  it("uses the saved level without the settings row (floating card)", async () => {
    render(<ClipperPanel page={page} settings={settings({ summaryLevel: "detailed" })} send={delivered} onClose={() => {}} />);
    expect(byText("Knapp", "[role=tab]")).toBeUndefined();
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});
    expect(delivered.mock.calls[0]![0]).toMatchObject({ summary_level: "detailed" });
  });
});

describe("C2 Autosave", () => {
  it("is off by default and shown as a switch in the popup form", () => {
    expect(DEFAULT_SETTINGS.autosave).toBe(false);
    const onSettingsChange = vi.fn();
    render(<ClipperPanel page={page} settings={settings()} send={delivered} onClose={() => {}} onSettingsChange={onSettingsChange} />);
    const sw = host.querySelector<HTMLInputElement>('input[aria-label="Autosave"]')!;
    expect(sw.checked).toBe(false);
    click(sw);
    expect(onSettingsChange).toHaveBeenCalledWith({ autosave: true });
    expect(delivered).not.toHaveBeenCalled();
  });

  it("defaultClipChoice mirrors the untouched form: route, pre-selected tags, summary level", () => {
    const auto = defaultClipChoice(page, settings({ defaultTags: ["inbox/later"], summaryLevel: "detailed" }));
    expect(auto).toMatchObject({ folder: null, note: "", summaryLevel: "detailed" });
    expect(auto.tags).toEqual(["inbox/later", "ai/mcp", "ai/rag"]);
    expect(auto.image).toBeUndefined(); // the page's first cover
    expect(defaultClipChoice(page, settings({ defaultRoute: "manual" })).folder).toBe("30_Clippings");
    expect(defaultClipChoice(page, settings({ defaultRoute: "manual", clipFolders: [] })).folder).toBeNull();
  });

  it("saves once on open, without any click, and confirms", async () => {
    render(<QuickSave page={page} settings={settings({ autosave: true, summaryLevel: "detailed" })} send={delivered} onClose={() => {}} autoCloseMs={0} />);
    await act(async () => {});
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(delivered.mock.calls[0]![0]).toMatchObject({
      kind: "web_clip",
      url: page.url,
      folder_path: null,
      summary_level: "detailed",
      image_url: page.image_url,
      tags: ["ai/mcp", "ai/rag"],
    });
    expect(host.textContent).toContain("In Kortex Inbox gespeichert");
    expect(byText("In Kortex Inbox werfen")).toBeUndefined(); // no confirmation form
  });

  it("closes by itself after a save, but stays while the pointer rests on it", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<QuickSave page={page} settings={settings({ autosave: true })} send={delivered} mock onClose={onClose} autoCloseMs={2500} />);
    await act(async () => {});
    await act(async () => void vi.advanceTimersByTime(2400));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(200));
    expect(onClose).toHaveBeenCalledTimes(1);

    remount();
    const stay = vi.fn();
    render(<QuickSave page={page} settings={settings({ autosave: true })} send={delivered} mock onClose={stay} autoCloseMs={2500} />);
    await act(async () => {});
    act(() => void host.querySelector('[role="dialog"]')!.dispatchEvent(new Event("pointerover", { bubbles: true })));
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(stay).not.toHaveBeenCalled();
  });

  it("reports an offline capture as queued and never closes on an error", async () => {
    vi.useFakeTimers();
    const queued = vi.fn(async (): Promise<SubmitResult> => ({ ok: true, delivered: false, queued: true, reason: "offline", code: "network" }));
    render(<QuickSave page={page} settings={settings({ autosave: true })} send={queued} onClose={() => {}} autoCloseMs={0} />);
    await act(async () => {});
    expect(host.textContent).toContain("Offline gespeichert");
    expect(host.textContent).toContain("wird automatisch nachgeliefert");

    remount();
    const onClose = vi.fn();
    const onOpenOptions = vi.fn();
    const failing = vi.fn(async (): Promise<SubmitResult> => ({ ok: false, error: { code: "unauthorized", message: "x" } }));
    render(<QuickSave page={page} settings={settings({ autosave: true })} send={failing} onClose={onClose} onOpenOptions={onOpenOptions} />);
    await act(async () => {});
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    click(byText("Optionen öffnen"));
    expect(onOpenOptions).toHaveBeenCalled();
  });

  it("an offline autosave lands in the outbox and is delivered later with the same key", async () => {
    const store = memoryStore();
    let online = false;
    const ingest = vi.fn(async (req: IngestRequest): Promise<IngestResponse> =>
      online ? mockIngest(req) : { ok: false, error: { code: "network", message: "offline" } },
    );
    const outbox = createOutbox({ store, api: { ingest } });
    const request = buildWebClip(page, defaultClipChoice(page, settings({ summaryLevel: "detailed" })));
    const res = await outbox.submit(request);
    expect(res).toMatchObject({ ok: true, delivered: false, queued: true });
    expect(badgeFor(res).text).toBe("…");
    online = true;
    expect(await outbox.flush({ force: true })).toMatchObject({ delivered: 1, pending: 0 });
    expect(ingest.mock.calls[1]![0]).toMatchObject({ summary_level: "detailed", idempotency_key: request.idempotency_key });
  });

  it("lets the user change both settings from the confirmation", async () => {
    const onSettingsChange = vi.fn();
    render(<QuickSave page={page} settings={settings({ autosave: true })} send={delivered} onClose={() => {}} onSettingsChange={onSettingsChange} autoCloseMs={0} />);
    await act(async () => {});
    click(byText("Ausführlich", "[role=tab]"));
    click(host.querySelector('input[aria-label="Autosave"]'));
    expect(onSettingsChange).toHaveBeenNthCalledWith(1, { summaryLevel: "detailed" });
    expect(onSettingsChange).toHaveBeenNthCalledWith(2, { autosave: false });
    expect(host.textContent).toContain("Ab dem nächsten Klick öffnet sich wieder das Formular");
    expect(delivered).toHaveBeenCalledTimes(1);
  });

  it("maps every outcome to a toolbar badge", () => {
    const ok: SubmitResult = { ok: true, delivered: true, response: mockIngest(buildWebClip(page, { folder: null, tags: [], note: "" })) };
    expect(badgeFor(ok).text).toBe("✓");
    expect(badgeFor({ ok: true, delivered: false, queued: true, reason: "x" }).text).toBe("…");
    expect(badgeFor({ ok: false, error: { code: "unauthorized", message: "x" } }).text).toBe("!");
  });
});
