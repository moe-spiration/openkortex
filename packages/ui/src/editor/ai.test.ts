import { describe, expect, it, vi } from "vitest";
import { runEditorAiAction, type EditorAiRequest } from "./ai";
import { getBridge } from "./bridge";
import type { KortexEditorInstance } from "./schema";

// The editor surface runEditorAiAction uses, over a flat list of blocks (no BlockNote needed).
interface FakeBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: FakeBlock[];
}

function fakeEditor(blocks: FakeBlock[], sel: { ids: string[]; text: string; cut?: FakeBlock[] }) {
  let doc = blocks.map((b) => ({ children: [], ...b }));
  let n = 0;
  const calls: string[] = [];
  const at = (id: string) => doc.findIndex((b) => b.id === id);
  const withIds = (bs: FakeBlock[]) =>
    bs.map((b) => ({ children: [], ...b, id: b.id ?? `new${++n}` }));
  const editor = {
    get document() {
      return doc;
    },
    getSelectedText: () => sel.text,
    getSelection: () =>
      sel.ids.length ? { blocks: sel.ids.map((id) => doc[at(id)]!) } : undefined,
    getTextCursorPosition: () => ({ block: doc[at(sel.ids[0] ?? doc[0]!.id)]! }),
    getSelectionCutBlocks: () => ({ blocks: sel.cut ?? [] }),
    getBlock: (id: string) => doc[at(id)],
    insertBlocks: (bs: FakeBlock[], ref: { id: string }, where: "after" | "before") => {
      const added = withIds(bs);
      const i = at(ref.id) + (where === "after" ? 1 : 0);
      doc = [...doc.slice(0, i), ...added, ...doc.slice(i)];
      calls.push(`insert:${added.map((b) => b.type).join(",")}`);
      return added;
    },
    replaceBlocks: (old: { id: string }[], bs: FakeBlock[]) => {
      const i = at(old[0]!.id);
      doc = [
        ...doc.slice(0, i),
        ...withIds(bs),
        ...doc.filter((b, j) => j > i && !old.some((o) => o.id === b.id)),
      ];
      calls.push("replace");
    },
    insertInlineContent: (content: unknown) => {
      calls.push(`inline:${JSON.stringify(content)}`);
    },
    updateBlock: (id: string, update: Partial<FakeBlock>) => {
      const i = at(id);
      doc[i] = { ...doc[i]!, ...update, props: { ...doc[i]!.props, ...update.props } };
    },
    removeBlocks: (ids: string[]) => {
      doc = doc.filter((b) => !ids.includes(b.id));
    },
  };
  return { editor: editor as unknown as KortexEditorInstance, calls, doc: () => doc };
}

const para = (id: string, text: string): FakeBlock => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
});

const withHost = (editor: KortexEditorInstance, answer: string | Error) => {
  const host = vi.fn<(r: EditorAiRequest) => Promise<string>>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  getBridge(editor).set({ wikiTargets: [], onAiAction: host });
  return host;
};

describe("runEditorAiAction (toolbar KI / slash Fortsetzen)", () => {
  it("without a host: does nothing", async () => {
    const { editor, calls } = fakeEditor([para("a", "Text")], { ids: ["a"], text: "" });
    expect(await runEditorAiAction(editor, "rewrite")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rewrite of a selection: sends the selected Markdown, replaces the selection inline", async () => {
    const { editor, calls } = fakeEditor([para("a", "Ich sollte die App monetarisieren.")], {
      ids: ["a"],
      text: "die App",
      cut: [para("x", "die **App**")],
    });
    const host = withHost(editor, "das *Produkt*");
    await runEditorAiAction(editor, "rewrite");
    expect(host).toHaveBeenCalledWith({ action: "rewrite", markdown: "die \\*\\*App\\*\\*\n" });
    expect(calls).toEqual([
      `inline:${JSON.stringify([
        { type: "text", text: "das ", styles: {} },
        { type: "text", text: "Produkt", styles: { italic: true } },
      ])}`,
    ]);
  });

  it("shorten without a selection replaces the caret's block", async () => {
    const { editor, calls, doc } = fakeEditor([para("a", "Langer Text."), para("b", "Rest")], {
      ids: ["a"],
      text: "",
    });
    const host = withHost(editor, "Kurz.");
    await runEditorAiAction(editor, "shorten");
    expect(host.mock.calls[0]![0]).toEqual({ action: "shorten", markdown: "Langer Text.\n" });
    expect(calls).toEqual(["replace"]);
    expect(doc().map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("a multi-block answer is added below, the original stays", async () => {
    const { editor, calls } = fakeEditor([para("a", "Satz")], {
      ids: ["a"],
      text: "Satz",
      cut: [para("x", "Satz")],
    });
    withHost(editor, "Eins.\n\n- zwei\n");
    await runEditorAiAction(editor, "rewrite");
    expect(calls).toEqual(["insert:paragraph,bulletListItem"]);
  });

  it("custom sends the instruction; on whole blocks a multi-block answer replaces them", async () => {
    const { editor, calls } = fakeEditor([para("a", "Mayer: Hallo"), para("b", "Lea: Hi Mayer")], {
      ids: ["a", "b"],
      text: "Mayer: Hallo\nLea: Hi Mayer",
      cut: [para("a", "Mayer: Hallo"), para("b", "Lea: Hi Mayer")],
    });
    const host = withHost(editor, "Meier: Hallo\n\nLea: Hi Meier\n");
    await runEditorAiAction(editor, "custom", "Ersetze Mayer durch Meier");
    expect(host.mock.calls[0]![0]).toMatchObject({ action: "custom", instruction: "Ersetze Mayer durch Meier" });
    expect(calls).toEqual(["replace"]);
  });

  it("custom without an instruction does nothing", async () => {
    const { editor, calls } = fakeEditor([para("a", "Text")], { ids: ["a"], text: "Text", cut: [para("a", "Text")] });
    const host = withHost(editor, "x");
    expect(await runEditorAiAction(editor, "custom", "  ")).toBe(false);
    expect(host).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("continue sends the text up to the block and inserts the answer after it", async () => {
    const { editor, calls, doc } = fakeEditor(
      [para("a", "Erstens."), para("b", "Zweitens."), para("c", "Danach")],
      {
        ids: ["b"],
        text: "",
      },
    );
    const host = withHost(editor, "Drittens.");
    await runEditorAiAction(editor, "continue");
    expect(host.mock.calls[0]![0]).toEqual({
      action: "continue",
      markdown: "Erstens.\n\nZweitens.\n",
    });
    expect(calls).toEqual(["insert:paragraph"]);
    expect(doc().map((b) => b.id)).toEqual(["a", "b", "new1", "c"]);
  });

  it("summarize adds a pending KI-Zusammenfassung below and fills it", async () => {
    const { editor, doc } = fakeEditor([para("a", "Text")], {
      ids: ["a"],
      text: "Text",
      cut: [para("x", "Text")],
    });
    withHost(editor, "Kern.\n\n- Punkt");
    await runEditorAiAction(editor, "summarize");
    const ai = doc()[1]!;
    expect(ai).toMatchObject({ type: "aiSummary", props: { pending: false } });
    expect(ai.content).toEqual([
      { type: "text", text: "Kern.", styles: {} },
      { type: "text", text: "\n", styles: {} },
      { type: "text", text: "• ", styles: {} },
      { type: "text", text: "Punkt", styles: {} },
    ]);
  });

  it("a failing host removes the pending summary and rethrows (the host shows the error)", async () => {
    const { editor, doc } = fakeEditor([para("a", "Text")], { ids: ["a"], text: "" });
    withHost(editor, new Error("Limit erreicht"));
    await expect(runEditorAiAction(editor, "summarize")).rejects.toThrow("Limit erreicht");
    expect(doc().map((b) => b.type)).toEqual(["paragraph"]);
  });
});
