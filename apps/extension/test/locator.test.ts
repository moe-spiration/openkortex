// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { buildLocator, markRange, nodeFromXPath, removeMarks, resolveLocator, xpathOf } from "../src/lib/highlight/locator";

const PAGE = `
<article id="a">
  <h1>Contextual Retrieval</h1>
  <p id="p1">Wer ein langes Dokument schneidet, verliert die Struktur.</p>
  <p id="p2">Ein Chunk ohne Kapitelbezug ist für das Retrieval oft nur ein Satz <em>ohne Absender</em>. Contextual Retrieval stellt Kontext voran.</p>
  <p id="p3">Ein Chunk ohne Kapitelbezug ist für das Retrieval oft nur ein Satz ohne Absender.</p>
  <script>var hidden = "Ein Chunk ohne Kapitelbezug";</script>
  <div data-kortex-ui="true">Kortex UI text</div>
</article>`;

const rangeIn = (startNode: Node, start: number, endNode: Node, end: number) => {
  const r = document.createRange();
  r.setStart(startNode, start);
  r.setEnd(endNode, end);
  return r;
};
const text = (id: string) => document.getElementById(id)!.firstChild as Text;

beforeEach(() => {
  document.body.innerHTML = PAGE;
});

describe("xpath", () => {
  it("round-trips text nodes", () => {
    const em = document.querySelector("#p2 em")!.firstChild!;
    const path = xpathOf(em, document.body);
    expect(path).toBe("/article[1]/p[2]/em[1]/text()[1]");
    expect(nodeFromXPath(path, document.body)).toBe(em);
    expect(nodeFromXPath("/article[1]/p[9]/text()[1]", document.body)).toBeNull();
    expect(nodeFromXPath("garbage", document.body)).toBeNull();
  });
});

describe("buildLocator", () => {
  it("captures quote, context, offsets and DOM range for a single-node selection", () => {
    const t = text("p1");
    const start = t.data.indexOf("verliert");
    const loc = buildLocator(rangeIn(t, start, t, start + "verliert die Struktur".length), document.body)!;
    expect(loc.v).toBe(1);
    expect(loc.quote.exact).toBe("verliert die Struktur");
    expect(loc.quote.prefix.endsWith("schneidet, ")).toBe(true);
    expect(loc.quote.suffix.startsWith(".")).toBe(true);
    expect(loc.range.startXPath).toBe("/article[1]/p[1]/text()[1]");
    expect(loc.range.startOffset).toBe(start);
    expect(loc.position.end - loc.position.start).toBe("verliert die Struktur".length);
  });

  it("handles selections across elements and trims surrounding whitespace", () => {
    const p2 = text("p2");
    const em = document.querySelector("#p2 em")!.firstChild as Text;
    const from = p2.data.indexOf("nur ein Satz") - 1; // leading space
    const loc = buildLocator(rangeIn(p2, from, em, em.data.length), document.body)!;
    expect(loc.quote.exact).toBe("nur ein Satz ohne Absender");
  });

  it("ignores script text and Kortex UI in the offsets", () => {
    const t = text("p3");
    const loc = buildLocator(rangeIn(t, 0, t, 5), document.body)!;
    expect(loc.quote.exact).toBe("Ein C");
    // the hidden script contains the same words but must not shift positions
    expect(loc.position.start).toBeGreaterThan(0);
  });

  it("rejects empty, collapsed and foreign selections", () => {
    const t = text("p1");
    expect(buildLocator(rangeIn(t, 3, t, 3), document.body)).toBeNull();
    const ui = document.querySelector("[data-kortex-ui]")!.firstChild!;
    expect(buildLocator(rangeIn(ui, 0, ui, 4), document.body)).toBeNull();
    expect(buildLocator(rangeIn(t, 0, t, 1), document.getElementById("p2")!)).toBeNull();
  });
});

describe("resolveLocator", () => {
  const sentence = "Ein Chunk ohne Kapitelbezug ist für das Retrieval oft nur ein Satz";

  it("finds the exact range again on an unchanged page", () => {
    const t = text("p2");
    const loc = buildLocator(rangeIn(t, 0, t, sentence.length), document.body)!;
    document.body.innerHTML = PAGE;
    const r = resolveLocator(loc, document.body)!;
    expect(r.toString()).toBe(sentence);
    expect(r.startContainer).toBe(text("p2"));
  });

  it("falls back to the quote and prefers the occurrence with matching context", () => {
    // p2 and p3 start with the same sentence; the locator was taken in p3.
    const t = text("p3");
    const loc = buildLocator(rangeIn(t, 0, t, sentence.length), document.body)!;
    // Page changed: structure shifted so XPaths no longer match.
    document.body.innerHTML = `<div><section>${PAGE}</section></div>`;
    const r = resolveLocator(loc, document.body)!;
    expect(r.toString()).toBe(sentence);
    expect(r.startContainer.parentElement?.id).toBe("p3");
  });

  it("returns null when the text is gone", () => {
    const t = text("p1");
    const loc = buildLocator(rangeIn(t, 0, t, 10), document.body)!;
    document.body.innerHTML = "<p>nothing here</p>";
    expect(resolveLocator(loc, document.body)).toBeNull();
  });
});

describe("markRange / removeMarks", () => {
  it("wraps each text node of a cross-element range and can undo it", () => {
    const p2 = text("p2");
    const em = document.querySelector("#p2 em")!.firstChild as Text;
    const from = p2.data.indexOf("nur ein Satz");
    const range = rangeIn(p2, from, em, em.data.length);
    const before = document.body.textContent;
    const marks = markRange(range, "h1");
    expect(marks.length).toBe(2);
    expect(marks.map((m) => m.textContent).join("")).toBe("nur ein Satz ohne Absender");
    expect(document.querySelectorAll("mark.kortex-hl[data-kortex-hl='h1']")).toHaveLength(2);
    expect(document.body.textContent).toBe(before);

    // locators still resolve across our own marks
    const t2 = marks[0]!.firstChild as Text;
    const loc = buildLocator(rangeIn(t2, 0, t2, 3), document.body)!;
    expect(loc.quote.exact).toBe("nur");

    removeMarks(document.body, "h1");
    expect(document.querySelectorAll("mark")).toHaveLength(0);
    expect(document.body.textContent).toBe(before);
  });
});
