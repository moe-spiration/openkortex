// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, IngestRequest, ItemStatusInfo } from "../src/lib/api";
import { mockIngest } from "../src/lib/api";
import type { SubmitResult } from "../src/lib/outbox";
import type { PageMeta } from "../src/lib/page-meta";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { SaveAnswerButton, SaveChatButton } from "../src/ui/ChatControls";
import { ClipperPanel } from "../src/ui/ClipperPanel";
import { SelectionToolbar } from "../src/ui/SelectionToolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page: PageMeta = {
  url: "https://engineering-notes.dev/contextual-retrieval",
  title: "Contextual Retrieval in der Praxis",
  description: "RAG und MCP",
  image_url: null,
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
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const q = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const byText = (text: string, tag = "button") =>
  [...host.querySelectorAll<HTMLElement>(tag)].find((e) => e.textContent?.includes(text));
const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

const okSend = () =>
  vi.fn(async (req: IngestRequest): Promise<SubmitResult> => ({ ok: true, delivered: true, response: mockIngest(req) }));

describe("ClipperPanel", () => {
  it("shows the page, suggests hashtags and sends an auto-routed clip", async () => {
    const send = okSend();
    render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={send} onClose={() => {}} />);
    expect(host.textContent).toContain("Contextual Retrieval in der Praxis");
    expect(host.textContent).toContain("engineering-notes.dev");
    expect(host.textContent).toContain("Zero-Setup");
    expect(byText("#ai/mcp", "[aria-pressed]")?.getAttribute("aria-pressed")).toBe("true");

    type(q<HTMLInputElement>("#x-note")!, "  wichtig fürs RAG-Projekt ");
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      kind: "web_clip",
      url: page.url,
      title: page.title,
      folder_path: null,
      note: "wichtig fürs RAG-Projekt",
      tags: expect.arrayContaining(["ai/mcp"]),
    });
    expect(host.textContent).toContain("In Kortex Inbox gespeichert");
    // the server's answer, not a canned sentence: auto-routing, folder so far, pipeline running
    expect(host.textContent).toContain("Kortex ordnet den Eintrag automatisch ein (vorerst 00_Inbox)");
    expect(host.textContent).toContain("Wird verarbeitet");
  });

  it("follows a live capture until the server has filed it", async () => {
    vi.useFakeTimers();
    try {
      const statuses: Array<ItemStatusInfo["status"]> = ["processing", "processed"];
      const fetchStatus = vi.fn(async (id: string): Promise<ApiResult<ItemStatusInfo>> => ({
        ok: true,
        data: { item_id: id, status: statuses.shift() ?? "processed", type: "bookmark", title: "T", folder_path: "30_Clippings/AI" },
      }));
      render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={okSend()} fetchStatus={fetchStatus} onClose={() => {}} />);
      click(byText("In Kortex Inbox werfen"));
      await act(async () => {});
      expect(host.textContent).toContain("Wird verarbeitet");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain("Verarbeitet");
      expect(host.textContent).toContain("Einsortiert in 30_Clippings/AI");
      expect(host.textContent).not.toContain("Wird verarbeitet");
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains a repeated capture instead of claiming a new save", async () => {
    const send = vi.fn(async (req: IngestRequest): Promise<SubmitResult> => ({
      ok: true,
      delivered: true,
      response: { ...mockIngest(req), replayed: true },
    }));
    render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={send} onClose={() => {}} />);
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});
    expect(host.textContent).toContain("Schon angekommen");
    expect(host.textContent).toContain("nichts doppelt gespeichert");
  });

  it("keeps the mock note and canned text in mock mode", async () => {
    render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={okSend()} mock onClose={() => {}} />);
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});
    expect(host.textContent).toContain("Artikel und Web");
    expect(host.textContent).toContain("Mock-Modus: es wurde nichts an einen Server gesendet");
  });

  describe("cover and transcript from the extractors", () => {
    const video: PageMeta = {
      ...page,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Ein Video",
      domain: "youtube.com",
      image_url: "https://i.ytimg.com/vi/x/maxresdefault.jpg",
      image_candidates: ["https://i.ytimg.com/vi/x/maxresdefault.jpg", "https://i.ytimg.com/vi/x/sddefault.jpg", "https://i.ytimg.com/vi/x/hqdefault.jpg"],
      media: { kind: "video", provider: "youtube", duration_sec: 213, channel: "Kanal" },
      transcript: { text: "a b c", lang: "de", source: "youtube-captions", segments: [{ start: 0, dur: 120, text: "a b c" }] },
    };
    const sent = async (choose: () => void) => {
      const send = okSend();
      render(<ClipperPanel page={video} settings={DEFAULT_SETTINGS} send={send} onClose={() => {}} />);
      choose();
      click(byText("In Kortex Inbox werfen"));
      await act(async () => {});
      return send.mock.calls[0]![0] as Extract<IngestRequest, { kind: "web_clip" }>;
    };

    it("shows the detected transcript and the channel, and sends transcript and media", async () => {
      const req = await sent(() => {
        expect(host.textContent).toContain("Transkript erkannt (2 Min., de)");
        expect(host.textContent).toContain("Kanal · 3:33");
      });
      expect(req.transcript).toMatchObject({ source: "youtube-captions", lang: "de" });
      expect(req.media).toMatchObject({ provider: "youtube", duration_sec: 213 });
      expect(req.image_url).toBe("https://i.ytimg.com/vi/x/maxresdefault.jpg");
    });

    it("lets the user switch the cover or drop it", async () => {
      expect(host.querySelectorAll(".kx-cover")).toHaveLength(0);
      const second = await sent(() => click(host.querySelectorAll(".kx-cover")[1]));
      expect(second.image_url).toBe("https://i.ytimg.com/vi/x/sddefault.jpg");
      act(() => root.unmount());
      root = createRoot(host);
      const none = await sent(() => click(byText("Ohne Cover")));
      expect(none.image_url).toBeNull();
    });

    it("skips a cover that fails to load and falls back to the next one", async () => {
      render(<ClipperPanel page={video} settings={DEFAULT_SETTINGS} send={okSend()} onClose={() => {}} />);
      const thumb = q<HTMLImageElement>(".kx-bookmark-thumb img")!;
      expect(thumb.getAttribute("src")).toContain("maxresdefault");
      act(() => void thumb.dispatchEvent(new Event("error")));
      expect(q<HTMLImageElement>(".kx-bookmark-thumb img")!.getAttribute("src")).toContain("sddefault");
    });

    it("explains why there is no transcript", () => {
      render(<ClipperPanel page={{ ...video, transcript: undefined, capture_notes: ["Keine Untertitel gefunden"] }} settings={DEFAULT_SETTINGS} send={okSend()} onClose={() => {}} />);
      expect(host.textContent).toContain("Keine Untertitel gefunden");
      expect(host.textContent).not.toContain("Transkript erkannt");
    });
  });

  it("sends the chosen folder and respects tag toggles", async () => {
    const send = okSend();
    render(<ClipperPanel page={page} settings={{ ...DEFAULT_SETTINGS, clipFolders: ["30_Clippings", "60_Documents/Artikel"] }} send={send} onClose={() => {}} />);
    click(byText("Ordner wählen", "[role=tab]"));
    const radios = host.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios).toHaveLength(2);
    click(radios[1]);
    click(byText("#ai/mcp", "[aria-pressed]")); // switch the pre-selected tag off
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});

    const sent = send.mock.calls[0]![0];
    expect(sent).toMatchObject({ kind: "web_clip", folder_path: "60_Documents/Artikel" });
    expect((sent as { tags: string[] }).tags).not.toContain("ai/mcp");
    expect(host.textContent).toContain("60_Documents/Artikel");
  });

  it("starts in manual mode when configured and pre-selects default tags", () => {
    render(
      <ClipperPanel
        page={page}
        settings={{ ...DEFAULT_SETTINGS, defaultRoute: "manual", defaultTags: ["strategy/mba"] }}
        send={okSend()}
        onClose={() => {}}
      />,
    );
    expect(host.querySelectorAll("input[type=radio]").length).toBeGreaterThan(0);
    expect(byText("#strategy/mba", "[aria-pressed]")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("surfaces a failed send and allows going back", async () => {
    const send = vi.fn(async (): Promise<SubmitResult> => ({ ok: false, error: { code: "unauthorized", message: "Token ungültig" } }));
    const onOpenOptions = vi.fn();
    render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={send} onClose={() => {}} onOpenOptions={onOpenOptions} />);
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});
    expect(q("[role=alert]")?.textContent).toContain("Token ungültig. Bitte in den Optionen ein gültiges Token eintragen");
    click(byText("Optionen öffnen"));
    expect(onOpenOptions).toHaveBeenCalled();
    click(byText("Zurück"));
    expect(byText("In Kortex Inbox werfen")).toBeTruthy();
  });

  it("tells the user when a capture is only queued and when mock mode is on", async () => {
    const send = vi.fn(async (): Promise<SubmitResult> => ({ ok: true, delivered: false, queued: true, reason: "offline" }));
    render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={send} mock onClose={() => {}} />);
    click(byText("In Kortex Inbox werfen"));
    await act(async () => {});
    expect(host.textContent).toContain("nachgeliefert");
    expect(host.textContent).toContain("Mock-Modus");
  });

  it("calls onClose from the header button", () => {
    const onClose = vi.fn();
    render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={okSend()} onClose={onClose} />);
    click(q("button[aria-label='Clipper schließen']"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("selection toolbar and chat controls", () => {
  it("renders the highlight action and only wires KI fragen when given", () => {
    const onHighlight = vi.fn();
    render(<SelectionToolbar onHighlight={onHighlight} />);
    expect(q("[role=toolbar][aria-label=Auswahl]")).toBeTruthy();
    expect(byText("KI fragen")).toBeUndefined();
    click(byText("Highlight in Kortex sichern"));
    expect(onHighlight).toHaveBeenCalled();
    render(<SelectionToolbar onHighlight={onHighlight} onAskAi={() => {}} />);
    expect(byText("KI fragen")).toBeTruthy();
  });

  it("toolbar mousedown does not steal the page selection", () => {
    render(<SelectionToolbar onHighlight={() => {}} />);
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    q("[role=toolbar]")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("switches the chat button to the saved pill with the vault path", () => {
    const onSave = vi.fn();
    render(<SaveChatButton state={{ status: "idle" }} onSave={onSave} />);
    click(byText("Save Chat to Kortex"));
    expect(onSave).toHaveBeenCalled();
    render(<SaveChatButton state={{ status: "saved", file: "2026-10-22_claude-rag.md" }} onSave={onSave} />);
    expect(host.textContent).toContain("Gespeichert: 40_AI_Memories/2026-10-22_claude-rag.md");
    expect(byText("Save Chat to Kortex")).toBeUndefined();
  });

  it("answer button saves once and then shows the file", () => {
    const onSave = vi.fn();
    render(<SaveAnswerButton state={{ status: "saving" }} onSave={onSave} />);
    expect(byText("Save to Kortex")?.hasAttribute("disabled")).toBe(true);
    render(<SaveAnswerButton state={{ status: "saved", file: "a.md" }} onSave={onSave} />);
    expect(host.textContent).toContain("40_AI_Memories/a.md");
  });
});
