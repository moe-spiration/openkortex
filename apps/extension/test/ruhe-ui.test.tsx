// @vitest-environment jsdom
// The Ruhe components (2026-11-27): the popup's capture panel (page, selection, screenshot, duplicate, after saving),
// the selection bar and note card on pages, and the side panel's question about the page.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIngest, type ApiResult, type IngestRequest, type IngestResponse, type ItemStatusInfo } from "../src/lib/api";
import type { SubmitResult } from "../src/lib/outbox";
import type { PageMeta } from "../src/lib/page-meta";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/lib/settings";
import { CapturePanel, type PopupActions } from "../src/ui/ruhe/CapturePanel";
import { NoteCard, SelectionBar } from "../src/ui/ruhe/OnPage";
import { RuheSidePanel, type SidePanelDeps } from "../src/ui/ruhe/SidePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEM = "11111111-1111-4111-8111-111111111111";
const page: PageMeta = {
  url: "https://engineering-notes.dev/contextual-retrieval",
  title: "Contextual Retrieval in der Praxis",
  description: "RAG",
  image_url: null,
  site_name: null,
  domain: "engineering-notes.dev",
  reading_minutes: 8,
  keywords: [],
};
const live: ExtensionSettings = { ...DEFAULT_SETTINGS, mockMode: false, baseUrl: "https://kortex.example.com", token: "kx_x", defaultTags: ["reading/later"] };

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
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const byText = (text: string, sel = "button") => [...host.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.includes(text));
const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
const typeIn = (el: HTMLTextAreaElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const flush = () => act(async () => {});

function actions(over: Partial<PopupActions> = {}): PopupActions {
  return {
    send: vi.fn(async (req: IngestRequest): Promise<SubmitResult> => ({ ok: true, delivered: true, response: { ...mockIngest(req), item_id: ITEM, status: "processing" } })),
    fetchStatus: vi.fn(async (id: string): Promise<ApiResult<ItemStatusInfo>> => ({ ok: true, data: { item_id: id, status: "processed", type: "article", title: page.title, folder_path: "30_Clippings/AI" } })),
    openOptions: vi.fn(),
    close: vi.fn(),
    ...over,
  };
}

describe("CapturePanel (popup)", () => {
  it("saves the page with note and tags, then shows the agent's steps and the final folder", async () => {
    const a = actions({ openItem: vi.fn() });
    render(<CapturePanel page={page} settings={live} mock={false} actions={a} suggestions={["ai/rag"]} />);
    expect(host.textContent).toContain("Contextual Retrieval in der Praxis");
    typeIn(host.querySelector("textarea")!, " wichtig ");
    click(byText("Speichern"));
    await flush();
    expect(a.send).toHaveBeenCalledTimes(1);
    expect((a.send as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ kind: "web_clip", url: page.url, note: "wichtig", tags: expect.arrayContaining(["reading/later", "ai/rag"]) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(host.textContent).toContain("Kortex-Agent");
    expect(host.textContent).toContain("Seite gelesen");
    expect(host.textContent).toContain("Abgelegt");
    // O opens the item in Kortex
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "o" })));
    expect(a.openItem).toHaveBeenCalledWith(ITEM);
  });

  it("says when the page is already in Kortex and offers to add to it", () => {
    render(<CapturePanel page={page} settings={live} mock={false} actions={actions()} captured={{ item_id: ITEM, folder_path: "30_Clippings/AI", at: "2026-11-24T08:00:00Z" }} />);
    expect(host.textContent).toContain("Schon in Kortex, seit");
    expect(byText("Ergänzen")).toBeTruthy();
  });

  it("saves the selection as a highlight with the note", async () => {
    const highlightSelection = vi.fn(async () => ({ ok: true as const, text: "x" }));
    const a = actions({ highlightSelection });
    render(<CapturePanel page={page} settings={live} mock={false} actions={a} selection="Ein Satz" />);
    click(host.querySelector('[role="radio"]:nth-child(2)'));
    typeIn(host.querySelector("textarea")!, "Notiz");
    click(byText("Highlight speichern"));
    await flush();
    expect(highlightSelection).toHaveBeenCalledWith({ note: "Notiz" });
    expect(a.send).not.toHaveBeenCalled();
  });

  it("uploads a screenshot with title, source and tags", async () => {
    const uploadScreenshot = vi.fn(async () => ({ ...mockIngest({ kind: "note", title: "x", content_md: "x", client: { name: "kortex-extension", version: "0" }, captured_at: "2026-11-27T08:00:00Z" }), item_id: ITEM, type: "image" }) as IngestResponse);
    render(<CapturePanel page={page} settings={live} mock={false} actions={actions({ uploadScreenshot })} />);
    click(byText("Screenshot", '[role="radio"]'));
    click(byText("Speichern"));
    await flush();
    expect(uploadScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Screenshot: Contextual Retrieval in der Praxis", note: `Quelle: ${page.url}`, tags: expect.arrayContaining(["reading/later"]) }),
    );
  });

  it("explains a rejected token and leads to the options", async () => {
    const a = actions({ send: vi.fn(async () => ({ ok: false, error: { code: "unauthorized", message: "401" } }) as SubmitResult) });
    render(<CapturePanel page={page} settings={live} mock={false} actions={a} />);
    click(byText("Speichern"));
    await flush();
    expect(host.textContent).toContain("Kortex hat das Token abgelehnt");
    click(byText("Token erneuern"));
    expect(a.openOptions).toHaveBeenCalled();
  });
});

describe("on-page pieces", () => {
  it("selection bar: colour, highlight, note and ask", () => {
    const onColor = vi.fn();
    const onHighlight = vi.fn();
    const onNote = vi.fn();
    const onAsk = vi.fn();
    render(<SelectionBar kind="new" color="yellow" onColor={onColor} onHighlight={onHighlight} onNote={onNote} onAsk={onAsk} />);
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute("aria-label")).toBe("Sand");
    click(host.querySelector('[aria-label="Indigo"]'));
    click(byText("Highlight"));
    click(byText("Notiz"));
    click(byText("Fragen"));
    expect(onColor).toHaveBeenCalledWith("indigo");
    expect([onHighlight, onNote, onAsk].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("note card saves note and colour with Ctrl/Cmd+Enter", () => {
    const onSave = vi.fn();
    render(<NoteCard quote="Ein Satz" color="yellow" onSave={onSave} onCancel={() => {}} />);
    click(host.querySelector('[aria-label="Salbei"]'));
    const area = host.querySelector("textarea")!;
    typeIn(area, "Warum");
    act(() => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, metaKey: true, bubbles: true })));
    expect(onSave).toHaveBeenCalledWith("Warum", "green");
  });
});

describe("RuheSidePanel", () => {
  it("asks about the saved page and shows the answer with its sources", async () => {
    const ask = vi.fn<SidePanelDeps["ask"]>(async (_body, onUpdate) => {
      const answer = { text: "Weil der Kontext fehlt [1].", citations: [{ n: 1, item_id: "a", title: "Chunking" }], error: null };
      onUpdate(answer);
      return { ok: true, answer };
    });
    const deps: SidePanelDeps = {
      page: { tabId: 1, windowId: 1, url: page.url, title: page.title },
      info: { url: page.url, selection: "", highlights: [] },
      captured: { item_id: ITEM, folder_path: "30_Clippings/AI", at: "2026-11-24T08:00:00Z" },
      highlights: [],
      ask,
      send: vi.fn(),
      focusHighlight: vi.fn(),
      openUrl: vi.fn(),
      openManager: vi.fn(),
      openOptions: vi.fn(),
      connected: true,
      prompts: [],
      promptSync: { sync: null, busy: false, refresh: () => {} },
      tabsView: null,
    };
    render(<RuheSidePanel deps={deps} settings={live} />);
    expect(host.textContent).toContain("Gespeichert in");
    const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
    typeIn(input, "Warum?");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await flush();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toMatchObject({ mode: "note", item_id: ITEM });
    expect(host.textContent).toContain("Weil der Kontext fehlt");
    expect(host.textContent).toContain("Chunking");
  });
});
