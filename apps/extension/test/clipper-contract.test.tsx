// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitResult } from "../src/lib/outbox";
import { extractPageMeta, type PageMeta } from "../src/lib/page-meta";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { ClipperPanel } from "../src/ui/ClipperPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page: PageMeta = {
  url: "https://a.dev/x",
  title: "Titel",
  description: null,
  image_url: null,
  site_name: null,
  domain: "a.dev",
  reading_minutes: null,
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

const submit = async (result: SubmitResult, onOpenOptions = () => {}) => {
  const send = vi.fn(async () => result);
  act(() => root.render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={send} onClose={() => {}} onOpenOptions={onOpenOptions} />));
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("In Kortex Inbox werfen"));
  act(() => button!.click());
  await act(async () => {});
  return send;
};

describe("clipper and the ingest contract", () => {
  it("shows what was shortened to fit the server limits", async () => {
    await submit({
      ok: true,
      delivered: true,
      response: { ok: true, kind: "web_clip", item_id: "1", type: "bookmark", status: "inbox", folder_path: "00_Inbox", auto_routed: true, duplicate: false },
      notices: ["Titel auf 500 Zeichen gekürzt", "Notiz auf 20.000 Zeichen gekürzt"],
    });
    const notes = [...host.querySelectorAll("[role=note]")].map((n) => n.textContent);
    expect(notes).toEqual(["Hinweis: Titel auf 500 Zeichen gekürzt", "Hinweis: Notiz auf 20.000 Zeichen gekürzt"]);
    expect(host.textContent).toContain("In Kortex Inbox gespeichert");
  });

  it("says when the server is not configured yet and the capture is queued", async () => {
    await submit({ ok: true, delivered: false, queued: true, reason: "x", code: "not_configured" });
    expect(host.textContent).toContain("In Kortex Inbox gespeichert");
    expect(host.textContent).toContain("Der Server ist noch nicht eingerichtet: wird automatisch nachgeliefert.");
  });

  it("offers the options page for a missing setup and names the field for a rejected request", async () => {
    const open = vi.fn();
    await submit({ ok: false, error: { code: "setup_required", message: "fehlt" } }, open);
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Noch nicht verbunden");
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Optionen öffnen")!.click());
    expect(open).toHaveBeenCalled();
  });

  it("limits the note input to the server's 20,000 characters", async () => {
    act(() => root.render(<ClipperPanel page={page} settings={DEFAULT_SETTINGS} send={vi.fn()} onClose={() => {}} />));
    expect(host.querySelector<HTMLInputElement>("#x-note")!.maxLength).toBe(20_000);
  });
});

describe("page metadata", () => {
  it("never reports a non-http(s) og:image", () => {
    document.head.innerHTML = `<title>x</title><meta property="og:image" content="data:image/png;base64,AAAA">`;
    expect(extractPageMeta(document, "https://a.dev/p").image_url).toBeNull();
    document.head.innerHTML = `<title>x</title><meta property="og:image" content="/img/c.png">`;
    expect(extractPageMeta(document, "https://a.dev/p").image_url).toBe("https://a.dev/img/c.png");
    document.head.innerHTML = `<title>x</title><meta property="og:image" content="blob:https://a.dev/1">`;
    expect(extractPageMeta(document, "https://a.dev/p").image_url).toBeNull();
  });
});
