// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { KortexEditor } from "./KortexEditor";

/* jsdom has no layout; ProseMirror and floating-ui only need these to exist. */
const rect = () => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
});
beforeAll(() => {
  Object.assign(Element.prototype, {
    getBoundingClientRect: rect,
    getClientRects: () => [rect()],
    scrollIntoView: () => {},
  });
  Object.assign(Range.prototype, { getBoundingClientRect: rect, getClientRects: () => [rect()] });
  Object.assign(document, { elementFromPoint: () => null });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterAll(() => {
  document.body.innerHTML = "";
});

/* Each test mounts its own editor; unmount it so menus and listeners do not leak into the next. */
const roots: Root[] = [];
const mount = (el: HTMLElement) => {
  const r = createRoot(el);
  roots.push(r);
  return r;
};
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

interface PMView {
  dom: HTMLElement;
  state: {
    selection: { from: number; to: number };
    tr: {
      insertText(t: string, f: number, to: number): unknown;
      delete(f: number, to: number): unknown;
    };
  };
  dispatch(tr: unknown): void;
  hasFocus(): boolean;
  someProp(name: string, f: (fn: (...args: unknown[]) => boolean) => boolean): boolean | undefined;
}
interface TiptapLike {
  view: PMView;
  commands: { focus(pos: "end"): void };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (fn: () => unknown) =>
  act(async () => {
    await fn();
    await wait(10);
  });

/**
 * Polls (inside act) until the DOM reflects the async editor/menu updates. It returns as soon as the
 * condition holds, so a generous limit costs nothing on a fast machine; 4 s was too tight while turbo
 * runs other packages' tests next to this one (BlockNote mount, rAF focus, menu render all slow down).
 */
async function until(cond: () => boolean, timeout = 15_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeout) {
      throw new Error(`timed out after ${timeout} ms waiting for the editor: ${cond.toString()}`);
    }
    await act(async () => {
      await wait(20);
    });
  }
}

/**
 * Focuses the editor at the end and waits until it really has focus. Tiptap's focus command calls
 * view.focus() in requestAnimationFrame (~16 ms in jsdom, later under load), longer than a step.
 * A focus event that lands while a query is typed resets the selection and closes the suggestion
 * menu; the test then clicked an item of the menu React had already unmounted, and nothing was
 * inserted (the flaky "slash Aufklappbar", about 1 in 3 full runs).
 */
async function focusEnd(tiptap: TiptapLike) {
  await step(() => tiptap.commands.focus("end"));
  await until(() => tiptap.view.hasFocus());
}

/** Types like a user: through ProseMirror's handleTextInput, so suggestion triggers fire. */
function type(view: PMView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) {
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  }
}

const items = (root: HTMLElement, label: string) => [
  ...root.querySelectorAll<HTMLButtonElement>(`.kx-ed-menu[aria-label="${label}"] .kx-menu-item`),
];
const title = (b: Element) => b.querySelector(".kx-ed-menu-title")?.textContent;
/** Clicks the first menu row; fails right here (not as a later timeout) if the menu closed meanwhile. */
const pick = (root: HTMLElement, label: string) =>
  step(() => {
    const row = items(root, label)[0];
    if (!row) throw new Error(`menu "${label}" closed before its item could be clicked`);
    row.click();
  });

describe("KortexEditor (jsdom)", () => {
  it("renders the prototype menus and runs the custom commands", { timeout: 30_000 }, async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const changes: string[] = [];
    const opened: { id?: string; title: string }[] = [];
    let finishSummary: (text: string) => void = () => undefined;

    await step(() =>
      mount(root).render(
        <KortexEditor
          markdown={"---\nid: n1\n---\nHallo\n"}
          onChange={(md) => changes.push(md)}
          wikiTargets={[
            { id: "1", title: "Projekt Alpha" },
            { id: "2", title: "Alpenblick" },
          ]}
          onOpenWikiLink={(t) => opened.push(t)}
          onAiSummary={() => new Promise<string>((resolve) => (finishSummary = resolve))}
          onCreateSubpage={(t) => ({ id: "9", title: `${t} 1` })}
        />,
      ),
    );
    await until(() => !!root.querySelector(".bn-editor .bn-inline-content"));
    expect(root.querySelector(".bn-root.kx-editor")).not.toBeNull();
    // window.ProseMirror is BlockNote's dev hook (set by useCreateBlockNote).
    const tiptap = (window as unknown as { ProseMirror: TiptapLike }).ProseMirror;
    const view = tiptap.view;

    // Slash menu: prototype markup, order, hints, first row selected.
    await focusEnd(tiptap);
    await step(() => type(view, " /"));
    await until(() => items(root, "Blöcke").length === 18);
    // W8.3: groups Grundlagen, Einbetten, KI (headers in front of their first entry).
    expect(
      [...root.querySelectorAll('.kx-ed-menu[aria-label="Blöcke"] .kx-ed-menu-group')].map(
        (g) => g.textContent,
      ),
    ).toEqual(["Grundlagen", "Einbetten", "KI"]);
    expect(items(root, "Blöcke").map(title)).toEqual([
      "Text",
      "Überschrift 1",
      "Überschrift 2",
      "Überschrift 3",
      "Aufgabe",
      "Liste",
      "Nummerierte Liste",
      "Callout",
      "Aufklappbar",
      "Zitat",
      "Code",
      "Trennlinie",
      "Verknüpfung [[Notiz]]",
      "Objekt erwähnen @",
      "Unterseite",
      "Tabelle",
      "Bild",
      "KI-Zusammenfassung",
    ]);
    expect(items(root, "Blöcke")[0]?.classList.contains("is-selected")).toBe(true);

    // KI-Zusammenfassung: caret while pending, then the host's text.
    // jsdom drops an open menu between act() batches (focus/blur metas), so each query is typed in one go.
    await step(() => {
      const { from } = view.state.selection;
      view.dispatch(view.state.tr.delete(from - 2, from));
    });
    await step(() => type(view, " /zusammen"));
    await until(() => items(root, "Blöcke").length === 1);
    expect(items(root, "Blöcke").map(title)).toEqual(["KI-Zusammenfassung"]);
    await pick(root, "Blöcke");
    await until(() => !!root.querySelector(".kx-ed-ai .kx-caret"));
    await step(() => finishSummary("Zusammenfassung fertig."));
    await until(() => !root.querySelector(".kx-ed-ai .kx-caret"));
    expect(root.querySelector(".kx-ed-ai")?.textContent).toContain("Zusammenfassung fertig.");

    // [[ autocomplete: filtered targets plus a "create" row; inserts a wikiLink node.
    await step(() => {
      tiptap.commands.focus("end");
      type(view, " [[Alp");
    });
    await until(() => items(root, "Verlinken").length === 3);
    expect(items(root, "Verlinken").map((b) => b.textContent)).toEqual([
      "Projekt Alpha",
      "Alpenblick",
      "„Alp“ verlinkenneu",
    ]);
    await pick(root, "Verlinken");
    await until(() => !!root.querySelector(".kx-ed-wikilink"));

    // Unterseite: inserted at once, renamed to the host's title.
    await step(() => type(view, " /unterseite"));
    await until(
      () => items(root, "Blöcke").length === 1 && title(items(root, "Blöcke")[0]!) === "Unterseite",
    );
    await pick(root, "Blöcke");
    await until(() => !!changes.at(-1)?.includes("![[Neue Unterseite 1]]"));

    expect(changes.at(-1)).toBe(
      "---\nid: n1\n---\nHallo\n\n> [!ai] KI-Zusammenfassung\n> Zusammenfassung fertig. [[Projekt Alpha]]\n\n![[Neue Unterseite 1]]\n",
    );

    // Typing a complete `[[Title|alias]]` links without picking from the menu.
    await step(() => {
      tiptap.commands.focus("end");
      type(view, "Siehe [[Neu|hier]]");
    });
    await until(() => !!changes.at(-1)?.endsWith("Siehe [[Neu|hier]]\n"));

    root.querySelector<HTMLElement>(".kx-ed-wikilink")?.click();
    root.querySelector<HTMLElement>(".kx-ed-subpage-link")?.click();
    expect(opened).toEqual([{ id: "1", title: "Projekt Alpha" }, { title: "Neue Unterseite 1" }]);
  });

  it(
    "slash Aufklappbar inserts a toggle, Alt+↑ moves it; toggles and underline load from Markdown",
    { timeout: 30_000 },
    async () => {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const changes: string[] = [];
      const r = mount(root);
      const render = (markdown: string) =>
        step(() =>
          r.render(<KortexEditor markdown={markdown} onChange={(m) => changes.push(m)} />),
        );
      await render("Ein <u>Wort</u> hier.\n");
      await until(() => !!root.querySelector(".bn-editor u"));
      expect(root.querySelector(".bn-editor u")?.textContent).toBe("Wort");
      const tiptap = (window as unknown as { ProseMirror: TiptapLike }).ProseMirror;
      const view = tiptap.view;

      // Slash "Aufklappbar" inserts a toggle, saved as an Obsidian fold callout (closed by default).
      // Focus first, and wait for it: a late focus event closes an open menu (see focusEnd).
      await focusEnd(tiptap);
      await step(() => type(view, " /aufklapp"));
      await until(() => items(root, "Blöcke").length === 1);
      expect(items(root, "Blöcke").map(title)).toEqual(["Aufklappbar"]);
      await pick(root, "Blöcke");
      await until(() => !!root.querySelector(".kx-ed-toggle"));
      // A new, empty toggle starts open, so its body can be written right away.
      expect(
        root.querySelector(".kx-ed-toggle .bn-toggle-button")?.getAttribute("aria-expanded"),
      ).toBe("true");
      await step(() => type(view, "Neu"));
      await until(() => !!changes.at(-1)?.endsWith("> [!toggle]- Neu\n"));
      expect(changes.at(-1)).toBe("Ein <u>Wort</u> hier.\n\n> [!toggle]- Neu\n");

      // Alt+↑ moves the block at the caret (the toggle) above the paragraph.
      await step(() => {
        view.dom.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
        );
      });
      await until(() => changes.at(-1) === "> [!toggle]- Neu\n\nEin <u>Wort</u> hier.\n");

      // External content with a toggle: the frame (chevron) around the title, "-" = closed.
      await render("> [!toggle]- Offene Fragen\n> Wann?\n");
      await until(() => root.querySelector(".kx-ed-toggle-title")?.textContent === "Offene Fragen");
      const button = root.querySelector(".kx-ed-toggle .bn-toggle-button");
      expect(button?.getAttribute("aria-expanded")).toBe("false");
      expect(button?.innerHTML).toContain("m9 18 6-6-6-6"); // thin chevron (W2)
      expect(root.querySelector(".kx-ed-toggle .bn-block-group")?.textContent).toBe("Wann?");
    },
  );

  it("takes external content after local edits, also when it equals an earlier prop (N5 #19)", { timeout: 30_000 }, async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const changes: string[] = [];
    const r = mount(root);
    const render = (markdown: string) =>
      step(() => r.render(<KortexEditor markdown={markdown} onChange={(m) => changes.push(m)} />));
    const text = () => root.querySelector(".bn-editor")?.textContent ?? "";

    await render("Original.\n");
    await until(() => text().includes("Original."));
    const tiptap = (window as unknown as { ProseMirror: TiptapLike }).ProseMirror;
    await focusEnd(tiptap);
    await step(() => type(tiptap.view, " Lokal"));
    await until(() => changes.at(-1) === "Original. Lokal\n");

    // The host echoes the edit back (store update): nothing changes.
    await render("Original. Lokal\n");
    expect(text()).toBe("Original. Lokal");

    // External content equal to the FIRST prop (e.g. a revert from another device): applied.
    await render("Original.\n");
    await until(() => text() === "Original.");

    // A later local edit is emitted relative to the new content and echoed back.
    await focusEnd(tiptap);
    await step(() => type(tiptap.view, "!"));
    await until(() => changes.at(-1) === "Original.!\n");
    await render("Original.!\n");
    const caret = tiptap.view.state.selection.from;

    // The same text in another Markdown spelling (no trailing newline) is no change: no reset, caret stays.
    const emitted = changes.length;
    await render("Original.!");
    expect(text()).toBe("Original.!");
    expect(tiptap.view.state.selection.from).toBe(caret);
    expect(changes.length).toBe(emitted);
  });
  it("never renders javascript: links, from Markdown or created in the editor (N5 #24)", { timeout: 30_000 }, async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const changes: string[] = [];
    const r = mount(root);
    await step(() => r.render(<KortexEditor markdown={"Gut [Doku](https://kortex.app).\n\nHier [Falle](javascript:alert(1)).\n\nZweiter Absatz.\n"} onChange={(m) => changes.push(m)} />));
    await until(() => !!root.querySelector(".bn-editor")?.textContent?.includes("Zweiter Absatz"));
    const hrefs = () => [...root.querySelectorAll(".bn-editor a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs()).toEqual(["https://kortex.app"]);
    expect(root.querySelector(".bn-editor")?.textContent).toContain("[Falle](javascript:alert(1))");

    // A link mark with an unsafe target added in the editor (what the toolbar's Link does) is removed again.
    const view = (window as unknown as { ProseMirror: { view: PMView & { state: { schema: { marks: Record<string, { create(a: object): unknown }> }; doc: { textContent: string }; tr: { addMark(f: number, t: number, m: unknown): unknown } } } } }).ProseMirror.view;
    const text = view.state.doc.textContent;
    const at = text.indexOf("Zweiter");
    expect(at).toBeGreaterThan(0);
    // Find the document position of "Zweiter" by scanning text nodes.
    let pos = -1;
    (view.state.doc as unknown as { descendants(f: (n: { isText: boolean; text?: string }, p: number) => void): void }).descendants((n, p) => {
      if (pos < 0 && n.isText && n.text?.includes("Zweiter")) pos = p + n.text.indexOf("Zweiter");
    });
    expect(pos).toBeGreaterThan(0);
    await step(() => view.dispatch(view.state.tr.addMark(pos, pos + 7, view.state.schema.marks.link!.create({ href: "javascript:alert(2)" }))));
    await until(() => !hrefs().some((h) => h.toLowerCase().startsWith("javascript")));
    // Stripped before anything was emitted: the saved Markdown never held the unsafe link.
    expect(changes.some((c) => c.includes("alert(2)"))).toBe(false);
    expect(root.querySelector(".bn-editor")?.textContent).toContain("Zweiter Absatz.");
    expect(hrefs()).toEqual(["https://kortex.app"]);
  });
});

describe("KortexEditor @-mentions, code blocks and mermaid (jsdom)", () => {
  it("@ links an entity as [[Wiki-Link]]; mid-word @ and e-mail addresses do not trigger", { timeout: 30_000 }, async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const changes: string[] = [];
    await step(() =>
      mount(root).render(
        <KortexEditor
          markdown={"Hallo\n"}
          onChange={(md) => changes.push(md)}
          wikiTargets={[
            { id: "1", title: "Lea Hoffmann", typeLabel: "Person" },
            { id: "2", title: "Leadership", typeLabel: "Konzept" },
          ]}
        />,
      ),
    );
    await until(() => !!root.querySelector(".bn-editor .bn-inline-content"));
    const tiptap = (window as unknown as { ProseMirror: TiptapLike }).ProseMirror;
    const view = tiptap.view;

    await focusEnd(tiptap);
    await step(() => type(view, " mail@le"));
    await act(async () => wait(60));
    expect(items(root, "Erwähnen")).toHaveLength(0);

    await step(() => type(view, " @le"));
    await until(() => items(root, "Erwähnen").length === 2);
    expect(items(root, "Erwähnen").map((b) => b.textContent)).toEqual(["Lea HoffmannPerson", "LeadershipKonzept"]);
    await pick(root, "Erwähnen");
    await until(() => !!root.querySelector(".kx-ed-wikilink"));
    await until(() => !!changes.at(-1)?.includes("[[Lea Hoffmann]]"));
    expect(changes.at(-1)).toMatch(/mail\\?@le/); // the @ inside the word stayed text
  });

  it("code blocks get a copy button; a fence with extra info loads; mermaid has a source/preview switch", { timeout: 30_000 }, async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const written: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void written.push(t) } });
    const md = '```ts title="a.ts"\nconst a = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n';
    const changes: string[] = [];
    await step(() => mount(root).render(<KortexEditor markdown={md} onChange={(m) => changes.push(m)} />));
    await until(() => root.querySelectorAll(".kx-ed-code").length === 2);
    // The fence with extra info is an editable code block (no raw fallback) and keeps its language label.
    expect(root.querySelector(".kx-ed-raw")).toBeNull();
    expect(root.querySelector(".kx-ed-code-lang")?.textContent).toBe("ts");

    const copy = root.querySelector<HTMLButtonElement>('.kx-ed-code-btn[aria-label="Code kopieren"]')!;
    await step(() => copy.click());
    await until(() => written.length === 1);
    expect(written[0]).toBe("const a = 1;");
    await until(() => !!root.querySelector('.kx-ed-code-btn[aria-label="Kopiert"]'));

    // Mermaid: preview by default (rendering may fail in jsdom: then the message shows, no crash).
    const mer = root.querySelector<HTMLElement>('.kx-ed-code[data-mermaid]')!;
    expect(mer.querySelector(".kx-ed-mermaid")).not.toBeNull();
    const toggle = mer.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    await step(() => toggle.click());
    expect(mer.querySelector(".kx-ed-mermaid")).toBeNull();
    expect(mer.querySelector<HTMLElement>(".kx-ed-code-pre")?.hidden).toBe(false);
  });
});
