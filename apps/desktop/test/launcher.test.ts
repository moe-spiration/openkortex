import { describe, expect, it } from "vitest";
import { createMockBridge, MOCK_VAULT } from "@/bridge/mock";
import { QC_ACTIONS, QC_ASK, QC_TARGETS } from "@/data";
import {
  autoSelect,
  extractVariables,
  fillVariables,
  missingVariables,
  oneLine,
  parseLauncherInput,
  selectionTitle,
  toPrompt,
  typeIcon,
} from "@/launcher";

describe("launcher prefixes", () => {
  it("> is the prompt catalog, ? the vault search, anything else capture", () => {
    expect(parseLauncherInput(">  mail ")).toEqual({ mode: "prompt", query: "mail" });
    expect(parseLauncherInput(" ?Sync Konflikte")).toEqual({
      mode: "find",
      query: "Sync Konflikte",
    });
    expect(parseLauncherInput("?")).toEqual({ mode: "find", query: "" });
    expect(parseLauncherInput("Milch kaufen ")).toEqual({
      mode: "capture",
      query: "Milch kaufen ",
    });
    expect(parseLauncherInput("Was ist > als 3?").mode).toBe("capture");
  });
});

describe("prompt variables", () => {
  const text = "Mail an {{ name }} über {{thema}}, Gruß an {{name}}";

  it("finds each variable once, in order", () => {
    expect(extractVariables(text)).toEqual(["name", "thema"]);
    expect(extractVariables("ohne")).toEqual([]);
  });

  it("fills given values and keeps empty ones as placeholders", () => {
    expect(fillVariables(text, { name: "Louisa", thema: "Q4" })).toBe(
      "Mail an Louisa über Q4, Gruß an Louisa",
    );
    expect(fillVariables(text, { name: "Louisa", thema: "  " })).toBe(
      "Mail an Louisa über {{thema}}, Gruß an Louisa",
    );
    expect(missingVariables(["name", "thema"], { name: "x", thema: " " })).toEqual(["thema"]);
  });

  it("turns a search hit into a prompt from its content_md", () => {
    const hit = MOCK_VAULT.find((h) => h.type === "prompt")!;
    const p = toPrompt(hit);
    expect(p).toMatchObject({ id: hit.item_id, title: hit.title, variables: ["name", "topic"] });
    expect(p.text).toBe(hit.content_md);
    // Without content (search without content=1) the snippet is the fallback.
    const { content_md: _drop, ...bare } = hit;
    void _drop;
    expect(toPrompt(bare).text).toBe(hit.snippet);
  });
});

describe("launcher helpers", () => {
  it("names selection captures after their window and picks type icons", () => {
    expect(selectionTitle(" Q4 – Word ")).toBe("Markierung aus Q4 – Word");
    expect(selectionTitle(null)).toBeUndefined();
    expect(selectionTitle("  ")).toBeUndefined();
    expect(typeIcon("meeting")).toBe("cal");
    expect(typeIcon("prompt")).toBe("sparkles");
    expect(typeIcon("whatever")).toBe("file");
    expect(oneLine("a\n\nb   c")).toBe("a b c");
    expect(oneLine("x".repeat(200), 10)).toHaveLength(10);
  });

  it("puts ask right after the capture targets (incl. scratchpad), then search, prompts and the selection grab", () => {
    expect(QC_TARGETS).toEqual(["note", "inbox", "task", "scratchpad"]);
    expect(QC_ACTIONS[QC_ASK]!.label).toBe("Second Brain fragen");
    expect(QC_ACTIONS.slice(QC_ASK).map((a) => a.key)).toEqual(["Tab", "?", ">", null]);
  });
});

describe("mock bridge launcher commands", () => {
  it("searches by type with content, lists recent ones for an empty query", async () => {
    const b = createMockBridge();
    const prompts = await b.invoke("launcher_search", { q: "", kind: "prompt", content: true });
    expect(prompts.mode).toBe("recent");
    expect(prompts.results.every((r) => r.type === "prompt" && r.content_md)).toBe(true);
    const hits = await b.invoke("launcher_search", { q: "sync" });
    expect(hits.results.map((r) => r.title)).toEqual(["Vault sync conflicts"]);
    expect(hits.results[0]!.content_md).toBeUndefined();
    b.dispose();
  });

  it("answers with numbered sources and pastes / copies", async () => {
    const b = createMockBridge();
    const a = await b.invoke("launcher_ask", { question: "Wie löse ich Konflikte?" });
    expect(a.sources.map((s) => s.n)).toEqual([1, 2]);
    await expect(b.invoke("launcher_ask", { question: " " })).rejects.toThrow(/question/);
    expect(await b.invoke("paste_text", { text: "x", mode: "paste" })).toBe(true);
    expect(await b.invoke("paste_text", { text: "x", mode: "copy" })).toBe(false);
    expect((await b.invoke("grab_selection")).text).toContain("SHA-256");
    b.dispose();
  });
});

describe("Festhalten/Fragen follows the text (detectIntent, like the web Orbit-Bar)", () => {
  const ASK = QC_ASK;
  it("switches to Fragen for a question and back to the last capture target", () => {
    expect(autoSelect("Was steht im Q4-Protokoll zur Migration?", 0, 0, ASK)).toBe(ASK);
    expect(autoSelect("wie funktioniert der md-sync", 2, 2, ASK)).toBe(ASK);
    expect(autoSelect("Milch kaufen", ASK, 2, ASK)).toBe(2);
    expect(autoSelect("https://example.com/artikel", ASK, 1, ASK)).toBe(1);
    expect(autoSelect("Milch kaufen", 3, 3, ASK)).toBe(3);
  });
  it("leaves an empty field and the launcher rows alone", () => {
    expect(autoSelect("", ASK, 0, ASK)).toBe(ASK);
    expect(autoSelect("Was ist das?", ASK + 2, 0, ASK)).toBe(ASK + 2);
  });
});

describe("connect by deep link (mock core)", () => {
  it("parks the link from the web app and connects only on confirm", async () => {
    const b = createMockBridge();
    const events: unknown[] = [];
    b.listen("connect:pending", (p) => events.push(p));
    expect(await b.invoke("pending_connect")).toBeNull();
    await b.invoke("open_connect");
    await new Promise((r) => setTimeout(r, 350));
    expect(events).toEqual([{ web: null, error: null }]);
    expect(await b.invoke("pending_connect")).not.toBeNull();
    expect((await b.invoke("account_status")).connected).toBe(false);
    const acc = await b.invoke("confirm_connect");
    expect(acc.connected).toBe(true);
    expect(await b.invoke("pending_connect")).toBeNull();
    await expect(b.invoke("confirm_connect")).rejects.toThrow();
    b.dispose();
  });
  it("remembers the reminders switch", async () => {
    const b = createMockBridge();
    expect(await b.invoke("get_reminders")).toBe(true);
    expect(await b.invoke("set_reminders", { enabled: false })).toBe(false);
    expect(await b.invoke("get_reminders")).toBe(false);
    b.dispose();
  });
});
