import { describe, expect, it } from "vitest";
import { applyTool, continueList, stats } from "../src/lib/editing";

describe("editor toolbar", () => {
  it("wraps and unwraps bold", () => {
    const a = applyTool("bold", "hallo welt", { start: 6, end: 10 });
    expect(a).toEqual({ text: "hallo **welt**", sel: { start: 8, end: 12 } });
    expect(applyTool("bold", a.text, a.sel).text).toBe("hallo welt");
    expect(applyTool("bold", "x", { start: 1, end: 1 })).toEqual({ text: "x****", sel: { start: 3, end: 3 } });
  });

  it("prefixes every selected line and toggles back", () => {
    const t = "eins\nzwei\ndrei";
    const b = applyTool("bullet", t, { start: 0, end: 9 });
    expect(b.text).toBe("- eins\n- zwei\ndrei");
    expect(applyTool("bullet", b.text, { start: 0, end: 12 }).text).toBe(t);
    expect(applyTool("check", "- a", { start: 1, end: 1 }).text).toBe("- [ ] a");
    expect(applyTool("number", "a\nb", { start: 0, end: 3 }).text).toBe("1. a\n2. b");
    expect(applyTool("h2", "Titel", { start: 2, end: 2 }).text).toBe("## Titel");
  });

  it("inserts links and rules", () => {
    const l = applyTool("link", "siehe hier", { start: 6, end: 10 });
    expect(l.text).toBe("siehe [hier](https://)");
    expect(l.text.slice(l.sel.start, l.sel.end)).toBe("https://");
    expect(applyTool("rule", "a", { start: 1, end: 1 }).text).toBe("a\n\n---\n");
  });

  it("continues and ends lists on enter", () => {
    expect(continueList("- a", "- a\n", 4)).toEqual({ text: "- a\n- ", sel: { start: 6, end: 6 } });
    expect(continueList("- [x] a", "- [x] a\n", 8)!.text).toBe("- [x] a\n- [ ] ");
    expect(continueList("2. b", "2. b\n", 5)!.text).toBe("2. b\n3. ");
    expect(continueList("- a\n- ", "- a\n- \n", 7)).toEqual({ text: "- a\n", sel: { start: 4, end: 4 } });
    expect(continueList("text", "text\n", 5)).toBeNull();
  });

  it("counts words", () => {
    expect(stats("## Hallo **Welt** eins")).toEqual({ words: 3, minutes: 1 });
  });
});
